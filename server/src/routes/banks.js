const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logAudit, addActivity } = require('../db/helpers');

const router = express.Router();

const FULL_ACCESS = ['owner', 'admin', 'finance'];

function parseAmount(v) {
  const n = parseFloat(v);
  return isNaN(n) || n < 0 ? null : n;
}

// GET /api/banks — list banks with running balance per bank
router.get('/', authenticate, authorize('owner', 'admin', 'finance'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.*,
              COALESCE(SUM(CASE WHEN bt.status <> 'deleted' THEN bt.amount_in ELSE 0 END), 0)::float
                - COALESCE(SUM(CASE WHEN bt.status <> 'deleted' THEN bt.amount_out ELSE 0 END), 0)::float as balance
       FROM banks b
       LEFT JOIN bank_transactions bt ON bt.bank_id = b.id
       GROUP BY b.id
       ORDER BY b.created_at DESC`
    );
    const result = rows.map(bank => ({ ...bank, balance: parseFloat(bank.balance) || 0 }));
    res.json(result);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// POST /api/banks — create a bank (Owner/Admin/Finance only)
router.post('/', authenticate, authorize('owner', 'admin', 'finance'), async (req, res) => {
  try {
    const { name, account_number } = req.body;
    if (!name) return res.status(400).json({ error: 'Bank name required' });
    const { rows } = await pool.query(
      'INSERT INTO banks (name, account_number) VALUES ($1,$2) RETURNING *',
      [name, account_number || null]
    );
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'bank', rows[0].id,
      `Created bank: ${name}`);
    await addActivity(req.user.full_name, 'created', `Added bank: ${name}`, 'bank', rows[0].id);
    res.status(201).json({ ...rows[0], balance: 0 });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// GET /api/banks/:id/transactions — full ledger with running balance (computed server-side)
router.get('/:id/transactions', authenticate, authorize('owner', 'admin', 'finance'), async (req, res) => {
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
    let running = 0;
    const ledger = rows.map((t) => {
      if (t.status === 'deleted') return { ...t, running_balance: null };
      const amountIn = parseFloat(t.amount_in) || 0;
      const amountOut = parseFloat(t.amount_out) || 0;
      running = running + amountIn - amountOut;
      return { ...t, running_balance: Math.round(running * 100) / 100 };
    });

    res.json({ bank: bankQ.rows[0], transactions: ledger });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// POST /api/banks/:id/transactions — add a ledger entry (Owner/Admin/Finance only)
router.post('/:id/transactions', authenticate, authorize('owner', 'admin', 'finance'), async (req, res) => {
  try {
    const { date, payee_name, cheque_no, amount_in, amount_out } = req.body;
    if (!date) return res.status(400).json({ error: 'Date required' });
    if (!payee_name) return res.status(400).json({ error: 'Payee name required' });
    const inAmt = amount_in === undefined || amount_in === null || amount_in === '' ? 0 : parseAmount(amount_in);
    const outAmt = amount_out === undefined || amount_out === null || amount_out === '' ? 0 : parseAmount(amount_out);
    if (inAmt === null || outAmt === null) return res.status(400).json({ error: 'Valid amounts required' });
    if (inAmt === 0 && outAmt === 0) return res.status(400).json({ error: 'Amount in or out required' });
    if (inAmt > 0 && outAmt > 0) return res.status(400).json({ error: 'Use either amount in or amount out, not both' });

    const bankQ = await pool.query('SELECT name FROM banks WHERE id=$1', [req.params.id]);
    if (bankQ.rows.length === 0) return res.status(404).json({ error: 'Bank not found' });

    const { rows } = await pool.query(
      `INSERT INTO bank_transactions (bank_id, date, payee_name, cheque_no, amount_in, amount_out, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, date, payee_name, cheque_no || null, inAmt, outAmt, req.user.id]
    );
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'bank_transaction', rows[0].id,
      `Created bank transaction: ${payee_name} - ${bankQ.rows[0].name} (in: ${inAmt}, out: ${outAmt})`);
    await addActivity(req.user.full_name, 'created',
      `Added bank transaction for ${payee_name} on ${bankQ.rows[0].name}`, 'bank_transaction', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;