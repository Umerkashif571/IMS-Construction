const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logAudit, addActivity } = require('../db/helpers');

// Pure JS decimal implementation - no external dependency
class PureDecimal {
  constructor(v) {
    if (v === null || v === undefined || v === '') { this.value = 0; return; }
    try { this.value = parseFloat(v); } catch (e) { this.value = NaN; }
    if (isNaN(this.value)) this.value = 0;
  }
  plus(other) { return new PureDecimal(this.value + other.value); }
  minus(other) { return new PureDecimal(this.value - other.value); }
  times(other) { return new PureDecimal(this.value * other.value); }
  div(other) { return new PureDecimal(this.value / other.value); }
  toDecimalPlaces(dp) { return new PureDecimal(Math.round(this.value * Math.pow(10, dp)) / Math.pow(10, dp)); }
  toNumber() { return this.value; }
  toFixed(dp) { return this.value.toFixed(dp); }
  equals(other) { return Math.abs(this.value - other.value) < 1e-10; }
  gt(other) { return this.value > other.value; }
  gte(other) { return this.value >= other.value; }
  lt(other) { return this.value < other.value; }
  lte(other) { return this.value <= other.value; }
  isNaN() { return isNaN(this.value); }
}

function d(v) { return new PureDecimal(v); }
function add(a, b) { return d(a).plus(d(b)); }
function sub(a, b) { return d(a).minus(d(b)); }
function mul(a, b) { return d(a).times(d(b)); }
function div(a, b) { return d(a).div(d(b)); }
function round2(v) { return d(v).toDecimalPlaces(2); }
function toNumber(v) { return round2(v).toNumber(); }
function toFixed(v, dp = 2) { return round2(v).toFixed(dp); }
function eq(a, b) { return d(a).equals(d(b)); }
function gt(a, b) { return d(a).gt(d(b)); }
function gte(a, b) { return d(a).gte(d(b)); }
function lt(a, b) { return d(a).lt(d(b)); }
function lte(a, b) { return d(a).lte(d(b)); }

const router = express.Router();

const FULL_ACCESS = ['owner', 'admin', 'finance'];

function parseAmount(v) {
  const dec = d(v);
  return dec.isNaN() || dec.lt(0) ? null : dec;
}

// GET /api/banks — list banks with running balance per bank
// Also support /api/bank-accounts as alias for backward compatibility
router.get(['/', '/bank-accounts'], authenticate, authorize('owner', 'admin', 'finance'), async (req, res) => {
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
    const result = rows.map(bank => ({ ...bank, balance: toNumber(d(bank.balance)) }));
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
    let running = d(0);
    const ledger = rows.map((t) => {
      if (t.status === 'deleted') return { ...t, running_balance: null };
      const amountIn = d(t.amount_in);
      const amountOut = d(t.amount_out);
      running = round2(add(sub(running, amountOut), amountIn));
      return { ...t, running_balance: toNumber(running) };
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
    const inAmt = amount_in === undefined || amount_in === null || amount_in === '' ? d(0) : parseAmount(amount_in);
    const outAmt = amount_out === undefined || amount_out === null || amount_out === '' ? d(0) : parseAmount(amount_out);
    if (inAmt === null || outAmt === null) return res.status(400).json({ error: 'Valid amounts required' });
    if (inAmt.eq(0) && outAmt.eq(0)) return res.status(400).json({ error: 'Amount in or out required' });
    if (gt(inAmt, 0) && gt(outAmt, 0)) return res.status(400).json({ error: 'Use either amount in or amount out, not both' });

    const bankQ = await pool.query('SELECT name FROM banks WHERE id=$1', [req.params.id]);
    if (bankQ.rows.length === 0) return res.status(404).json({ error: 'Bank not found' });

    const { rows } = await pool.query(
      `INSERT INTO bank_transactions (bank_id, date, payee_name, cheque_no, amount_in, amount_out, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, date, payee_name, cheque_no || null, toNumber(inAmt), toNumber(outAmt), req.user.id]
    );
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'bank_transaction', rows[0].id,
      `Created bank transaction: ${payee_name} - ${bankQ.rows[0].name} (in: ${toNumber(inAmt)}, out: ${toNumber(outAmt)})`);
    await addActivity(req.user.full_name, 'created',
      `Added bank transaction for ${payee_name} on ${bankQ.rows[0].name}`, 'bank_transaction', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;