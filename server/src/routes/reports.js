const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const router = express.Router();

// Stock Valuation Report
router.get('/stock-valuation', authenticate, async (req, res) => {
  try {
    const { format } = req.query;
    const { rows } = await pool.query(`
      SELECT m.name, m.sku, m.unit, m.quantity, m.unit_cost, 
        (m.quantity * m.unit_cost) as total_value,
        m.reorder_level, c.name as category_name, v.name as supplier_name
      FROM materials m
      LEFT JOIN categories c ON m.category_id=c.id
      LEFT JOIN vendors v ON m.supplier_id=v.id
      WHERE m.is_active=true
      ORDER BY total_value DESC
    `);
    if (format === 'excel') return await exportExcel(res, rows, 'Stock_Valuation', [
      { header: 'Material', key: 'name' }, { header: 'SKU', key: 'sku' },
      { header: 'Category', key: 'category_name' }, { header: 'Unit', key: 'unit' },
      { header: 'Quantity', key: 'quantity' }, { header: 'Unit Cost (PKR)', key: 'unit_cost' },
      { header: 'Total Value (PKR)', key: 'total_value' }, { header: 'Reorder Level', key: 'reorder_level' }
    ]);
    if (format === 'pdf') return exportPdf(res, 'Stock Valuation Report', rows, [
      'Name', 'SKU', 'Category', 'Unit', 'Qty', 'Unit Cost', 'Total Value'
    ]);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Project-wise Material Usage
router.get('/project-usage', authenticate, async (req, res) => {
  try {
    const { project_id, format } = req.query;
    let sql = `SELECT p.name as project, m.name as entity_name, 'material' as allocation_type,
                      mt.quantity, m.unit, m.unit_cost,
                      (mt.quantity * m.unit_cost) as total_cost,
                      mt.created_at, mt.added_by as allocated_by,
                      mt.location, mt.driver_name, mt.vehicle_number
               FROM material_transactions mt
               JOIN materials m ON mt.material_id = m.id
               JOIN projects p ON mt.project_id = p.id
               WHERE mt.type = 'out'`;
    const params = [];
    if (project_id) { sql += ' AND mt.project_id=$1'; params.push(project_id); }
    sql += ' ORDER BY mt.created_at DESC';
    const { rows } = await pool.query(sql, params);
    if (format === 'excel') return exportExcel(res, rows, 'Project_Usage', [
      { name: 'Project', key: 'project' }, { name: 'Item', key: 'entity_name' },
      { name: 'Qty', key: 'quantity' }, { name: 'Unit', key: 'unit' },
      { name: 'Unit Cost', key: 'unit_cost' }, { name: 'Total', key: 'total_cost' },
      { name: 'Location', key: 'location' }, { name: 'Driver', key: 'driver_name' },
      { name: 'Vehicle', key: 'vehicle_number' }, { name: 'Date', key: 'created_at' },
      { name: 'Issued By', key: 'allocated_by' }
    ]);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Vehicle Utilization
router.get('/vehicle-utilization', authenticate, async (req, res) => {
  try {
    const { format } = req.query;
    const { rows } = await pool.query(`
      SELECT v.registration_no, v.type, v.brand, v.current_status, p.name as project,
        v.last_maintenance_date, v.next_maintenance_date, v.insurance_expiry, v.registration_expiry,
        (SELECT SUM(liters) FROM vehicle_fuel_logs WHERE vehicle_id=v.id) as total_fuel_used
      FROM vehicles v LEFT JOIN projects p ON v.assigned_project_id=p.id ORDER BY v.registration_no
    `);
    if (format === 'excel') return exportExcel(res, rows, 'Vehicle_Utilization', [
      { name: 'Reg No', key: 'registration_no' }, { name: 'Type', key: 'type' },
      { name: 'Brand', key: 'brand' }, { name: 'Status', key: 'current_status' },
      { name: 'Project', key: 'project' }, { name: 'Last Maint', key: 'last_maintenance_date' },
      { name: 'Next Maint', key: 'next_maintenance_date' }, { name: 'Insurance Exp', key: 'insurance_expiry' },
      { name: 'Reg Exp', key: 'registration_expiry' }, { name: 'Total Fuel (L)', key: 'total_fuel_used' }
    ]);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Tool Checkout History
router.get('/tool-checkout', authenticate, async (req, res) => {
  try {
    const { format } = req.query;
    const { rows } = await pool.query(`
      SELECT tcl.*, p.name as project_name FROM tool_checkout_log tcl
      LEFT JOIN projects p ON tcl.assigned_project_id=p.id
      ORDER BY tcl.created_at DESC LIMIT 200
    `);
    if (format === 'excel') return exportExcel(res, rows, 'Tool_Checkout_History', [
      { name: 'Tool', key: 'tool_name' }, { name: 'Checked Out To', key: 'checked_out_to' },
      { name: 'Employee', key: 'employee_name' }, { name: 'Project', key: 'project_name' },
      { name: 'Check Out', key: 'check_out_date' }, { name: 'Due', key: 'expected_return_date' },
      { name: 'Returned', key: 'actual_return_date' }, { name: 'Condition', key: 'condition_on_return' }
    ]);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Maintenance Due Report
router.get('/maintenance-due', authenticate, async (req, res) => {
  try {
    const { format } = req.query;
    const { rows: vehicle } = await pool.query(`
      SELECT registration_no, type, brand, model, next_maintenance_date, insurance_expiry, registration_expiry
      FROM vehicles WHERE current_status != 'retired' AND (
        next_maintenance_date <= NOW() + INTERVAL '30 days' OR
        insurance_expiry <= NOW() + INTERVAL '60 days' OR
        registration_expiry <= NOW() + INTERVAL '60 days'
      ) ORDER BY next_maintenance_date
    `);
    const { rows: toolMaintenance } = await pool.query(`
      SELECT name, serial_number, next_maintenance_date, calibration_due_date
      FROM tools WHERE current_status != 'retired' AND (
        next_maintenance_date <= NOW() + INTERVAL '30 days' OR
        calibration_due_date <= NOW() + INTERVAL '30 days'
      ) ORDER BY next_maintenance_date
    `);
    const flatData = [
      ...vehicle.map(v => ({ item_name: v.registration_no, item_type: 'Vehicle - ' + v.type, next_due_date: v.next_maintenance_date, insurance_expiry: v.insurance_expiry, registration_expiry: v.registration_expiry })),
      ...toolMaintenance.map(t => ({ item_name: t.name, item_type: 'Tool - ' + (t.serial_number || ''), next_due_date: t.next_maintenance_date, insurance_expiry: null, registration_expiry: null }))
    ];
    const data = flatData;
    if (format === 'excel') {
      const wb = new ExcelJS.Workbook();
      const ws1 = wb.addWorksheet('Vehicle Maintenance');
      ws1.columns = [{ header: 'Reg No', key: 'registration_no' }, { header: 'Type', key: 'type' }, { header: 'Next Maint', key: 'next_maintenance_date' }];
      vehicle.forEach(r => ws1.addRow(r));
      const ws2 = wb.addWorksheet('Tool Maintenance');
      ws2.columns = [{ header: 'Tool', key: 'name' }, { header: 'Serial', key: 'serial_number' }, { header: 'Next Maint', key: 'next_maintenance_date' }];
      toolMaintenance.forEach(r => ws2.addRow(r));
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=maintenance_due.xlsx');
      await wb.xlsx.write(res);
      return res.end();
    }
    res.json(data);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Vendor Purchase History
router.get('/vendor-purchases', authenticate, async (req, res) => {
  try {
    const { vendor_id, format } = req.query;
    let sql = `SELECT po.po_number, po.order_date, po.total_amount, po.status, po.delivery_status, v.name as vendor
               FROM purchase_orders po JOIN vendors v ON po.vendor_id=v.id WHERE po.status NOT IN ('draft', 'cancelled', 'rejected')`;
    const params = [];
    if (vendor_id) { sql += ' AND po.vendor_id=$1'; params.push(vendor_id); }
    sql += ' ORDER BY po.order_date DESC';
    const { rows } = await pool.query(sql, params);
    if (format === 'excel') return exportExcel(res, rows, 'Vendor_Purchases', [
      { name: 'PO Number', key: 'po_number' }, { name: 'Vendor', key: 'vendor' },
      { name: 'Order Date', key: 'order_date' }, { name: 'Total (PKR)', key: 'total_amount' },
      { name: 'Status', key: 'status' }, { name: 'Delivery', key: 'delivery_status' }
    ]);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Low Stock Alert
router.get('/low-stock', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM materials WHERE is_active=true AND quantity <= reorder_level ORDER BY (reorder_level - quantity) DESC`
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

async function exportExcel(res, data, filename, columns) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(filename);
  ws.columns = columns;
  data.forEach(r => ws.addRow(r));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}.xlsx`);
  await wb.xlsx.write(res);
  return res.end();
}

function exportPdf(res, title, data, columns) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=${title.replace(/\s+/g, '_')}.pdf`);
  doc.pipe(res);
  doc.fontSize(16).text(title, { align: 'center' }).moveDown();
  data.forEach((row, i) => {
    doc.fontSize(8).text(columns.map(c => row[c.replace(/\s+/g, '_').toLowerCase()] || row[c.toLowerCase()] || '').join(' | '));
    if (i > 0 && i % 50 === 0) doc.addPage();
  });
  doc.end();
}

module.exports = router;