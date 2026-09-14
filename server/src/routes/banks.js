const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize, ROLES } = require('../middleware/auth');
const { logAudit, addActivity } = require('../db/helpers');
const { requireUuid, dbError, isDate, maxLen } = require('../middleware/validate');
const { d, add, sub, round2, toNumber, gt } = require('../utils/decimal');

const router = express.Router();

router.param('id', requireUuid);

// Overdraft rule: banks have no allow_overdraft flag, so a manual debit may never take the
// ledger below zero. Auto-linked debits from finance entries are recorded as-is.
const ALLOW_OVERDRAFT = false;

// Strict amount parser: finite number, >= 0, at most 2 decimals of precision kept.
// Returns null for garbage (NaN/Infinity/negative/non-numeric).
function parseAmount(v) {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n >= 1e13) return null; // DECIMAL(15,2) overflow
  return round2(d(v));
}

// GET /api/banks — list banks with running balance per bank
// Also support /api/bank-accounts as alias for backward compatibility
router.get(['/', '/bank-accounts'], authenticate, authorize(...ROLES.FINANCE), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.*,
              COALESCE(SUM(CASE WHEN bt.status <> 'deleted' THEN bt.amount_in ELSE 0 END), 0)::numeric
            - COALESCE(SUM(CASE WHEN bt.status <> 'deleted' THEN bt.amount_out ELSE 0 END), 0)::numeric as balance
       FROM banks b
       LEFT JOIN bank_transactions bt ON bt.bank_id = b.id
       GROUP BY b.id
       ORDER BY b.created_at DESC`
    );
    const result = rows.map(bank => ({ ...bank, balance: toNumber(bank.balance) }));
    res.json(result);
  } catch (err) { return dbError(res, err); }
});

// POST /api/banks — create a bank (Owner/Admin/Finance only)
router.post('/', authenticate, authorize(...ROLES.FINANCE), async (req, res) => {
  try {
    const { name, account_number } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Bank name required' });
    if (!maxLen(name, 255)) return res.status(400).json({ error: 'Bank name too long (max 255)' });
    if (account_number !== undefined && account_number !== null && (typeof account_number !== 'string' || !maxLen(account_number, 255)))
      return res.status(400).json({ error: 'Account number must be a string (max 255)' });
    const { rows } = await pool.query(
      'INSERT INTO banks (name, account_number) VALUES ($1,$2) RETURNING *',
      [name.trim(), account_number || null]
    );
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'bank', rows[0].id,
      `Created bank: ${name.trim()}`);
    await addActivity(req.user.full_name, 'created', `Added bank: ${name.trim()}`, 'bank', rows[0].id);
    res.status(201).json({ ...rows[0], balance: 0 });
  } catch (err) { return dbError(res, err); }
});

// GET /api/banks/:id/transactions — full ledger with running balance (computed server-side)
router.get('/:id/transactions', authenticate, authorize(...ROLES.FINANCE), async (req, res) => {
  try {
    const bankQ = await pool.query('SELECT * FROM banks WHERE id=$1', [req.params.id]);
    if (bankQ.rows.length === 0) return res.status(404).json({ error: 'Bank not found' });

    const { rows } = await pool.query(
      `SELECT bt.*, u.full_name as created_by_name
       FROM bank_transactions bt LEFT JOIN users u ON bt.created_by = u.id
       WHERE bt.bank_id=$1 ORDER BY bt.date ASC, bt.created_at ASC`,
      [req.params.id]
    );

    // Running balance: apply non-deleted entries in chronological order (date, then created_at)
    let running = d(0);
    const ledger = rows.map((t) => {
      if (t.status === 'deleted') return { ...t, running_balance: null };
      running = round2(add(sub(running, t.amount_out), t.amount_in));
      return { ...t, running_balance: toNumber(running) };
    });

    res.json({ bank: bankQ.rows[0], transactions: ledger });
  } catch (err) { return dbError(res, err); }
});

// POST /api/banks/:id/transactions — add a ledger entry (Owner/Admin/Finance only)
router.post('/:id/transactions', authenticate, authorize(...ROLES.FINANCE), async (req, res) => {
  const { date, payee_name, cheque_no, amount_in, amount_out } = req.body;
  if (!date) return res.status(400).json({ error: 'Date required' });
  if (!isDate(date)) return res.status(400).json({ error: 'Invalid date' });
  if (!payee_name || typeof payee_name !== 'string' || !payee_name.trim()) return res.status(400).json({ error: 'Payee name required' });
  if (!maxLen(payee_name, 255)) return res.status(400).json({ error: 'Payee name too long (max 255)' });
  if (cheque_no !== undefined && cheque_no !== null && (typeof cheque_no !== 'string' || !maxLen(cheque_no, 255)))
    return res.status(400).json({ error: 'Cheque no must be a string (max 255)' });
  const inAmt = amount_in === undefined || amount_in === null ? d(0) : parseAmount(amount_in);
  const outAmt = amount_out === undefined || amount_out === null ? d(0) : parseAmount(amount_out);
  if (inAmt === null || outAmt === null) return res.status(400).json({ error: 'Valid amounts required (finite, >= 0)' });
  if (inAmt.isZero() && outAmt.isZero()) return res.status(400).json({ error: 'Amount in or out required' });
  if (gt(inAmt, 0) && gt(outAmt, 0)) return res.status(400).json({ error: 'Use either amount in or amount out, not both' });

  const client = await pool.connect();
  let released = false;
  try {
    await client.query('BEGIN');
    // Lock the bank row so two concurrent debits cannot both pass the balance check.
    const bankQ = await client.query('SELECT name FROM banks WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (bankQ.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Bank not found' }); }

    if (gt(outAmt, 0) && !ALLOW_OVERDRAFT) {
      const balQ = await client.query(
        `SELECT COALESCE(SUM(amount_in), 0)::numeric - COALESCE(SUM(amount_out), 0)::numeric AS balance
         FROM bank_transactions WHERE bank_id=$1 AND status <> 'deleted'`,
        [req.params.id]
      );
      const balance = round2(balQ.rows[0].balance);
      if (gt(outAmt, balance)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Insufficient balance. Available: PKR ${toNumber(balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` });
      }
    }

    const { rows } = await client.query(
      `INSERT INTO bank_transactions (bank_id, date, payee_name, cheque_no, amount_in, amount_out, created_by, source_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'manual') RETURNING *`,
      [req.params.id, date, payee_name.trim(), cheque_no || null, inAmt.toFixed(2), outAmt.toFixed(2), req.user.id]
    );
    await client.query('COMMIT');
    client.release(); released = true;
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'bank_transaction', rows[0].id,
      `Created bank transaction: ${payee_name.trim()} - ${bankQ.rows[0].name} (in: ${toNumber(inAmt)}, out: ${toNumber(outAmt)})`);
    await addActivity(req.user.full_name, 'created',
      `Added bank transaction for ${payee_name.trim()} on ${bankQ.rows[0].name}`, 'bank_transaction', rows[0].id);
    return res.status(201).json(rows[0]);
  } catch (err) {
    if (!released) { try { await client.query('ROLLBACK'); } catch (_) {} }
    return dbError(res, err);
  } finally {
    if (!released) client.release();
  }
});

module.exports = router;
