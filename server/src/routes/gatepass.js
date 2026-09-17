const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../db/pool');
const { authenticate, authorize, ROLES } = require('../middleware/auth');
const { logAudit, addActivity, notifyRoles, nextGatePassNo } = require('../db/helpers');
const { requireUuid, isUuid, dbError, toNumber, maxLen } = require('../middleware/validate');

const router = express.Router();
router.param('id', requireUuid);

router.get('/', authenticate, authorize(...ROLES.GATEPASS), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM gate_passes ORDER BY created_at DESC LIMIT 200');
    res.json(rows);
  } catch (err) { return dbError(res, err); }
});

router.get('/:id', authenticate, authorize(...ROLES.INVENTORY), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM gate_passes WHERE id=$1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Gate pass not found' });
    res.json(rows[0]);
  } catch (err) { return dbError(res, err); }
});

// Printable gate pass (A4 portrait). Same roles as the detail view — the Materials issue
// flow downloads this right after issuing stock, so INVENTORY roles need it too.
router.get('/:id/pdf', authenticate, authorize(...ROLES.INVENTORY), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM gate_passes WHERE id=$1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Gate pass not found' });
    const gp = rows[0];
    const fmtDate = (d) => d ? new Date(d).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
    const val = (v) => (v === null || v === undefined || v === '') ? '-' : String(v);

    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Gate Pass ${gp.gate_pass_no}`, Author: 'Al Shafi Enterprises' } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="GatePass_${gp.gate_pass_no}.pdf"`);
    doc.pipe(res);

    const navy = '#0f172a', amber = '#d97706', slate = '#475569', line = '#cbd5e1';
    const left = doc.page.margins.left, right = doc.page.width - doc.page.margins.right, width = right - left;

    // Header band
    doc.rect(0, 0, doc.page.width, 92).fill(navy);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text('Al Shafi Enterprises', left, 26);
    doc.font('Helvetica').fontSize(9).fillColor('#fbbf24').text('BUILDERS, CONTRACTORS & INTERIOR DECORATORS', left, 52, { characterSpacing: 1 });
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#ffffff').text('MATERIAL GATE PASS', left, 30, { width, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor('#e2e8f0').text(gp.gate_pass_no, left, 54, { width, align: 'right' });

    // Meta row
    let y = 116;
    doc.fillColor(slate).font('Helvetica').fontSize(9).text('ISSUED ON', left, y).text('ISSUED BY', left + width / 2, y);
    doc.fillColor(navy).font('Helvetica-Bold').fontSize(11).text(fmtDate(gp.created_at), left, y + 13).text(val(gp.issued_by), left + width / 2, y + 13);

    // Details table
    y = 168;
    const rowsData = [
      ['Material', val(gp.material_name)],
      ['Quantity', `${val(gp.quantity)} ${val(gp.unit) === '-' ? '' : gp.unit}`.trim()],
      ['Project / Site', val(gp.project_name)],
      ['Destination', val(gp.destination)],
      ['Vehicle number', val(gp.vehicle_number)],
      ['Driver name', val(gp.driver_name)],
      ['Authorized by', val(gp.authorized_by)],
      ['Notes', val(gp.notes)],
    ];
    doc.lineWidth(0.8).strokeColor(line);
    for (const [label, value] of rowsData) {
      const h = Math.max(28, doc.heightOfString(value, { width: width - 170, font: 'Helvetica', size: 11 }) + 14);
      doc.rect(left, y, width, h).stroke();
      doc.rect(left, y, 160, h).fillAndStroke('#f8fafc', line);
      doc.fillColor(slate).font('Helvetica-Bold').fontSize(9).text(label.toUpperCase(), left + 10, y + 9, { width: 140 });
      doc.fillColor(navy).font('Helvetica').fontSize(11).text(value, left + 170, y + 8, { width: width - 180 });
      y += h;
    }

    // Signatures
    y += 56;
    const sigW = (width - 40) / 3;
    ['Issued By', 'Authorized Signature', 'Security Officer'].forEach((label, i) => {
      const x = left + i * (sigW + 20);
      doc.moveTo(x, y).lineTo(x + sigW, y).strokeColor(navy).lineWidth(1).stroke();
      doc.fillColor(slate).font('Helvetica').fontSize(9).text(label, x, y + 6, { width: sigW, align: 'center' });
    });

    // Footer
    doc.fontSize(8).fillColor('#94a3b8').text(
      'Computer-generated document. Present this pass at the gate; the security officer must verify vehicle and quantity before release.',
      left, doc.page.height - 70, { width, align: 'center' });
    doc.end();
  } catch (err) { console.error(err); if (!res.headersSent) res.status(500).json({ error: 'Server error' }); }
});

// Manual gate pass = a guarded stock-out: same checks and side effects as
// POST /materials/:id/stock-out (qty <= stock, decrement, material_transactions + stock_movements),
// all inside one transaction. Denormalised names are looked up server-side, never trusted from the body.
router.post('/', authenticate, authorize('owner', 'admin', 'store_manager'), async (req, res) => {
  const { material_id, quantity, project_id, notes } = req.body;
  const str = (v) => (typeof v === 'string' ? v.trim() || null : null);
  const vehicle_number = str(req.body.vehicle_number), driver_name = str(req.body.driver_name);
  const destination = str(req.body.destination), authorized_by = str(req.body.authorized_by);
  if (!material_id || quantity == null || !vehicle_number || !driver_name) return res.status(400).json({ error: 'Missing required fields' });
  if (!isUuid(material_id)) return res.status(400).json({ error: 'Invalid material id' });
  if (project_id != null && !isUuid(project_id)) return res.status(400).json({ error: 'Invalid project id' });
  const qty = toNumber(quantity);
  if (qty === null || Number.isNaN(qty) || qty <= 0 || qty > 9999999999) return res.status(400).json({ error: 'Quantity must be a positive number' });
  for (const [v, label] of [[vehicle_number, 'Vehicle number'], [driver_name, 'Driver name'], [destination, 'Destination'], [authorized_by, 'Authorized by']]) {
    if (!maxLen(v, 255)) return res.status(400).json({ error: `${label} too long (max 255)` });
  }

  const client = await pool.connect();
  let released = false;
  try {
    await client.query('BEGIN');
    const { rows: material } = await client.query('SELECT id, name, unit, quantity, unit_cost FROM materials WHERE id=$1 AND is_active = true FOR UPDATE', [material_id]);
    if (material.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Material not found' }); }
    const mat = material[0];
    const prevQty = parseFloat(mat.quantity || 0);
    if (qty > prevQty) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Insufficient stock. Available: ${prevQty} ${mat.unit || ''}`.trim() });
    }
    const newQty = Math.round((prevQty - qty) * 100) / 100;

    let projectName = null;
    if (project_id) {
      const { rows: proj } = await client.query('SELECT name FROM projects WHERE id=$1', [project_id]);
      if (proj.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Project not found' }); }
      projectName = proj[0].name;
    }

    await client.query('UPDATE materials SET quantity = quantity - $1, updated_at = NOW() WHERE id = $2', [qty, material_id]);

    const gpNo = await nextGatePassNo(client);
    const { rows } = await client.query(
      `INSERT INTO gate_passes (gate_pass_no, material_id, material_name, quantity, unit, project_id, project_name, vehicle_number, driver_name, destination, issued_by, authorized_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [gpNo, material_id, mat.name, qty, mat.unit, project_id || null, projectName, vehicle_number, driver_name, destination, req.user.full_name, authorized_by, notes ?? null]
    );
    const gp = rows[0];

    await client.query(
      `INSERT INTO material_transactions (material_id, type, quantity, running_total, project_id, location, driver_name, vehicle_number, added_by, notes, transaction_type, date, unit_cost)
       VALUES ($1, 'out', $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11)`,
      [material_id, qty, newQty, project_id || null, destination, driver_name, vehicle_number, req.user.full_name, notes ?? null, 'gate_pass', Number(mat.unit_cost) || 0]
    );
    await client.query(
      `INSERT INTO stock_movements (material_id, material_name, movement_type, quantity, unit, reference_type, reference_id, notes, user_id, user_name)
       VALUES ($1,$2,'out',$3,$4,'gate_pass',$5,$6,$7,$8)`,
      [material_id, mat.name, qty, mat.unit, gp.id, notes ?? `Gate pass ${gpNo}`, req.user.id, req.user.full_name]
    );
    await client.query('COMMIT');
    client.release(); released = true;

    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'gate_pass', gp.id,
      `Gate pass ${gpNo} issued for ${qty} ${mat.unit || ''} of ${mat.name} (vehicle: ${vehicle_number}). Remaining: ${newQty}`);
    await addActivity(req.user.full_name, 'gate_pass', `Gate pass ${gpNo} issued for ${mat.name}`, 'gate_pass', gp.id);
    await notifyRoles(['owner', 'admin'], 'gate_pass',
      `Gate pass ${gpNo} issued`,
      `${req.user.full_name} issued gate pass ${gpNo} for ${qty} ${mat.unit || ''} of ${mat.name} (vehicle: ${vehicle_number})`,
      `/gatepass/${gp.id}`, 'gate_pass', gp.id);
    res.status(201).json(gp);
  } catch (err) {
    if (!released) { try { await client.query('ROLLBACK'); } catch (_) {} }
    return dbError(res, err);
  } finally {
    if (!released) client.release();
  }
});

module.exports = router;
