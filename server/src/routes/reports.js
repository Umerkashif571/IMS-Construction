const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize, ROLES } = require('../middleware/auth');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { isUuid, isDate, dbError } = require('../middleware/validate');

const router = express.Router();

// Query-string validation shared by every report. Returns an error message or null.
// page/limit must be positive integers when supplied; id filters must be UUIDs; date filters ISO dates.
function validateReportQuery(q, { ids = [], dates = [] } = {}) {
  for (const k of ['page', 'limit']) {
    if (q[k] !== undefined && q[k] !== '' && !/^\d{1,9}$/.test(String(q[k]))) return `Invalid ${k}`;
  }
  if (q.format !== undefined && q.format !== '' && !['json', 'excel', 'pdf'].includes(q.format)) return 'Invalid format (json, excel or pdf)';
  for (const k of ids) {
    if (q[k] !== undefined && q[k] !== '' && !isUuid(q[k])) return `Invalid ${k}`;
  }
  for (const k of dates) {
    if (q[k] !== undefined && q[k] !== '' && !(typeof q[k] === 'string' && /^\d{4}-\d{2}-\d{2}/.test(q[k]) && isDate(q[k]))) return `Invalid ${k} (use YYYY-MM-DD)`;
  }
  if (q.search !== undefined && typeof q.search !== 'string') return 'Invalid search';
  if (typeof q.search === 'string' && q.search.length > 200) return 'Search too long';
  if (q.date_from && q.date_to && new Date(q.date_from) > new Date(q.date_to)) return 'date_from must not be after date_to';
  return null;
}
const paging = (q) => {
  const pageNum = Math.max(1, parseInt(q.page) || 1);
  const limitNum = Math.min(500, Math.max(1, parseInt(q.limit) || 100));
  return { pageNum, limitNum, offset: (pageNum - 1) * limitNum };
};

// Stock Valuation Report
router.get('/stock-valuation', authenticate, authorize(...ROLES.REPORTS), async (req, res) => {
  try {
    const bad = validateReportQuery(req.query, { ids: ['category', 'supplier_id'] });
    if (bad) return res.status(400).json({ error: bad });
    const { format, search, category, supplier_id, low_stock } = req.query;
    const { pageNum, limitNum, offset } = paging(req.query);

    let sql = `
      SELECT m.name, m.sku, m.unit, m.quantity, m.unit_cost, 
        (m.quantity * m.unit_cost) as total_value,
        m.reorder_level, c.name as category_name, v.name as supplier_name
      FROM materials m
      LEFT JOIN categories c ON m.category_id=c.id
      LEFT JOIN vendors v ON m.supplier_id=v.id
      WHERE m.is_active=true
    `;
    const params = [];
    let idx = 1;
    if (search) { sql += ` AND (m.name ILIKE $${idx} OR m.sku ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    if (category) { sql += ` AND m.category_id = $${idx}`; params.push(category); idx++; }
    if (supplier_id) { sql += ` AND m.supplier_id = $${idx}`; params.push(supplier_id); idx++; }
    if (low_stock === 'true') { sql += ` AND m.quantity <= m.reorder_level`; }

    const countSql = `SELECT COUNT(*) FROM (${sql}) as filtered`;
    const { rows: countRows } = await pool.query(countSql, params);
    const total = parseInt(countRows[0]?.count || '0');

    sql += ` ORDER BY total_value DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limitNum, offset);

    const { rows } = await pool.query(sql, params);

    if (format === 'excel' || format === 'pdf') {
      // For exports, get all data without pagination
      const exportSql = sql.replace(`LIMIT $${idx} OFFSET $${idx + 1}`, '');
      const { rows: allRows } = await pool.query(exportSql, params.slice(0, -2));
      const columns = [
        { header: 'Material', key: 'name', width: 26 }, { header: 'SKU', key: 'sku', width: 16 },
        { header: 'Category', key: 'category_name', width: 18 }, { header: 'Unit', key: 'unit', width: 8 },
        { header: 'Quantity', key: 'quantity', width: 12, align: 'right' }, { header: 'Unit Cost (PKR)', key: 'unit_cost', width: 16, align: 'right' },
        { header: 'Total Value (PKR)', key: 'total_value', width: 18, align: 'right' }, { header: 'Reorder Level', key: 'reorder_level', width: 12, align: 'right' }
      ];
      if (format === 'excel') return exportExcel(res, allRows, 'Stock_Valuation', columns);
      return exportPdf(res, 'Stock Valuation Report', allRows, columns);
    }
    res.json({
      data: rows,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) }
    });
  } catch (err) { return dbError(res, err); }
});

// Project-wise Material Usage
router.get('/project-usage', authenticate, authorize(...ROLES.REPORTS), async (req, res) => {
  try {
    const bad = validateReportQuery(req.query, { ids: ['project_id', 'material_id'], dates: ['date_from', 'date_to'] });
    if (bad) return res.status(400).json({ error: bad });
    const { project_id, material_id, date_from, date_to, format } = req.query;
    const { pageNum, limitNum, offset } = paging(req.query);

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
    let idx = 1;
    if (project_id) { sql += ` AND mt.project_id = $${idx}`; params.push(project_id); idx++; }
    if (material_id) { sql += ` AND mt.material_id = $${idx}`; params.push(material_id); idx++; }
    if (date_from) { sql += ` AND mt.created_at >= $${idx}::date`; params.push(date_from.slice(0, 10)); idx++; }
    if (date_to) { sql += ` AND mt.created_at < ($${idx}::date + INTERVAL '1 day')`; params.push(date_to.slice(0, 10)); idx++; }

    const countSql = `SELECT COUNT(*) FROM (${sql}) as filtered`;
    const { rows: countRows } = await pool.query(countSql, params);
    const total = parseInt(countRows[0]?.count || '0');

    sql += ` ORDER BY mt.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limitNum, offset);

    const { rows } = await pool.query(sql, params);

    if (format === 'excel' || format === 'pdf') {
      const exportSql = sql.replace(`LIMIT $${idx} OFFSET $${idx + 1}`, '');
      const { rows: allRows } = await pool.query(exportSql, params.slice(0, -2));
      const columns = [
        { header: 'Project', key: 'project', width: 22 }, { header: 'Item', key: 'entity_name', width: 24 },
        { header: 'Qty', key: 'quantity', width: 10, align: 'right' }, { header: 'Unit', key: 'unit', width: 8 },
        { header: 'Unit Cost', key: 'unit_cost', width: 12, align: 'right' }, { header: 'Total', key: 'total_cost', width: 14, align: 'right' },
        { header: 'Location', key: 'location', width: 16 }, { header: 'Driver', key: 'driver_name', width: 14 },
        { header: 'Vehicle', key: 'vehicle_number', width: 12 }, { header: 'Date', key: 'created_at', width: 18, type: 'date' },
        { header: 'Issued By', key: 'allocated_by', width: 14 }
      ];
      if (format === 'excel') return exportExcel(res, allRows, 'Project_Usage', columns);
      return exportPdf(res, 'Project Material Usage', allRows, columns);
    }
    res.json({
      data: rows,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) }
    });
  } catch (err) { return dbError(res, err); }
});

// Vehicle Utilization
router.get('/vehicle-utilization', authenticate, authorize(...ROLES.REPORTS), async (req, res) => {
  try {
    const bad = validateReportQuery(req.query, { ids: ['project_id'] });
    if (bad) return res.status(400).json({ error: bad });
    const { format, project_id } = req.query;
    const params = [];
    let where = 'WHERE v.is_active = true';
    if (project_id) { params.push(project_id); where += ` AND v.assigned_project_id = $${params.length}`; }
    const { rows } = await pool.query(`
      SELECT v.registration_no, v.type, v.brand, v.current_status, p.name as project,
        v.last_maintenance_date, v.next_maintenance_date, v.insurance_expiry, v.registration_expiry,
        (SELECT SUM(liters) FROM vehicle_fuel_logs WHERE vehicle_id=v.id) as total_fuel_used
      FROM vehicles v LEFT JOIN projects p ON v.assigned_project_id=p.id ${where} ORDER BY v.registration_no
    `, params);
    const columns = [
      { header: 'Reg No', key: 'registration_no', width: 14 }, { header: 'Type', key: 'type', width: 12 },
      { header: 'Brand', key: 'brand', width: 12 }, { header: 'Status', key: 'current_status', width: 12 },
      { header: 'Project', key: 'project', width: 22 }, { header: 'Last Maint', key: 'last_maintenance_date', width: 12, type: 'date' },
      { header: 'Next Maint', key: 'next_maintenance_date', width: 12, type: 'date' }, { header: 'Insurance Exp', key: 'insurance_expiry', width: 12, type: 'date' },
      { header: 'Reg Exp', key: 'registration_expiry', width: 12, type: 'date' }, { header: 'Total Fuel (L)', key: 'total_fuel_used', width: 12, align: 'right' }
    ];
    if (format === 'excel') return exportExcel(res, rows, 'Vehicle_Utilization', columns);
    if (format === 'pdf') return exportPdf(res, 'Vehicle Utilization', rows, columns);
    res.json(rows);
  } catch (err) { return dbError(res, err); }
});

// Tool Checkout History
router.get('/tool-checkout', authenticate, authorize(...ROLES.REPORTS), async (req, res) => {
  try {
    const bad = validateReportQuery(req.query, { ids: ['project_id', 'tool_id'], dates: ['date_from', 'date_to'] });
    if (bad) return res.status(400).json({ error: bad });
    const { format, project_id, tool_id, date_from, date_to } = req.query;
    const params = [];
    // history rows for soft-deleted tools are hidden like the tool itself (FLEET-11)
    let where = 'WHERE (t.id IS NULL OR t.is_active = true)';
    if (project_id) { params.push(project_id); where += ` AND tcl.assigned_project_id = $${params.length}`; }
    if (tool_id) { params.push(tool_id); where += ` AND tcl.tool_id = $${params.length}`; }
    if (date_from) { params.push(date_from.slice(0, 10)); where += ` AND tcl.check_out_date >= $${params.length}::date`; }
    if (date_to) { params.push(date_to.slice(0, 10)); where += ` AND tcl.check_out_date < ($${params.length}::date + INTERVAL '1 day')`; }
    const { rows } = await pool.query(`
      SELECT tcl.*, p.name as project_name FROM tool_checkout_log tcl
      LEFT JOIN tools t ON t.id = tcl.tool_id
      LEFT JOIN projects p ON tcl.assigned_project_id=p.id
      ${where}
      ORDER BY tcl.created_at DESC LIMIT 200
    `, params);
    const columns = [
      { header: 'Tool', key: 'tool_name', width: 24 }, { header: 'Checked Out To', key: 'checked_out_to', width: 18 },
      { header: 'Employee', key: 'employee_name', width: 18 }, { header: 'Project', key: 'project_name', width: 22 },
      { header: 'Check Out', key: 'check_out_date', width: 14, type: 'date' }, { header: 'Due', key: 'expected_return_date', width: 14, type: 'date' },
      { header: 'Returned', key: 'actual_return_date', width: 14, type: 'date' }, { header: 'Condition', key: 'condition_on_return', width: 12 }
    ];
    if (format === 'excel') return exportExcel(res, rows, 'Tool_Checkout_History', columns);
    if (format === 'pdf') return exportPdf(res, 'Tool Checkout History', rows, columns);
    res.json(rows);
  } catch (err) { return dbError(res, err); }
});

// Maintenance Due Report
router.get('/maintenance-due', authenticate, authorize(...ROLES.REPORTS), async (req, res) => {
  try {
    const bad = validateReportQuery(req.query);
    if (bad) return res.status(400).json({ error: bad });
    const { format } = req.query;
    const { rows: vehicle } = await pool.query(`
      SELECT registration_no, type, brand, model, next_maintenance_date, insurance_expiry, registration_expiry
      FROM vehicles WHERE is_active = true AND current_status != 'retired' AND (
        next_maintenance_date <= NOW() + INTERVAL '30 days' OR
        insurance_expiry <= NOW() + INTERVAL '60 days' OR
        registration_expiry <= NOW() + INTERVAL '60 days'
      ) ORDER BY next_maintenance_date
    `);
    const { rows: toolMaintenance } = await pool.query(`
      SELECT name, serial_number, next_maintenance_date, calibration_due_date
      FROM tools WHERE is_active = true AND current_status != 'retired' AND (
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
    if (format === 'pdf') return exportPdf(res, 'Maintenance Due', data, [
      { header: 'Item', key: 'item_name', width: 30 }, { header: 'Type', key: 'item_type', width: 24 },
      { header: 'Next Due', key: 'next_due_date', width: 14, type: 'date' },
      { header: 'Insurance Exp', key: 'insurance_expiry', width: 14, type: 'date' }, { header: 'Reg Exp', key: 'registration_expiry', width: 14, type: 'date' }
    ]);
    res.json(data);
  } catch (err) { return dbError(res, err); }
});

// Vendor Purchase History
router.get('/vendor-purchases', authenticate, authorize(...ROLES.REPORTS), async (req, res) => {
  try {
    const bad = validateReportQuery(req.query, { ids: ['vendor_id', 'project_id'], dates: ['date_from', 'date_to'] });
    if (bad) return res.status(400).json({ error: bad });
    const { vendor_id, project_id, date_from, date_to, format } = req.query;
    const { pageNum, limitNum, offset } = paging(req.query);

    let sql = `SELECT po.po_number, po.order_date, po.total_amount, po.status, po.delivery_status, v.name as vendor
               FROM purchase_orders po JOIN vendors v ON po.vendor_id=v.id WHERE po.status NOT IN ('draft', 'cancelled', 'rejected')`;
    const params = [];
    let idx = 1;
    if (vendor_id) { sql += ` AND po.vendor_id = $${idx}`; params.push(vendor_id); idx++; }
    if (project_id) { sql += ` AND po.project_id = $${idx}`; params.push(project_id); idx++; }
    if (date_from) { sql += ` AND po.order_date >= $${idx}::date`; params.push(date_from.slice(0, 10)); idx++; }
    if (date_to) { sql += ` AND po.order_date < ($${idx}::date + INTERVAL '1 day')`; params.push(date_to.slice(0, 10)); idx++; }

    const countSql = `SELECT COUNT(*) FROM (${sql}) as filtered`;
    const { rows: countRows } = await pool.query(countSql, params);
    const total = parseInt(countRows[0]?.count || '0');

    sql += ` ORDER BY po.order_date DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limitNum, offset);

    const { rows } = await pool.query(sql, params);

    if (format === 'excel' || format === 'pdf') {
      const exportSql = sql.replace(`LIMIT $${idx} OFFSET $${idx + 1}`, '');
      const { rows: allRows } = await pool.query(exportSql, params.slice(0, -2));
      const columns = [
        { header: 'PO Number', key: 'po_number', width: 16 }, { header: 'Vendor', key: 'vendor', width: 28 },
        { header: 'Order Date', key: 'order_date', width: 14, type: 'date' }, { header: 'Total (PKR)', key: 'total_amount', width: 16, align: 'right' },
        { header: 'Status', key: 'status', width: 14 }, { header: 'Delivery', key: 'delivery_status', width: 12 }
      ];
      if (format === 'excel') return exportExcel(res, allRows, 'Vendor_Purchases', columns);
      return exportPdf(res, 'Vendor Purchases', allRows, columns);
    }
    res.json({
      data: rows,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) }
    });
  } catch (err) { return dbError(res, err); }
});

// Low Stock Alert
router.get('/low-stock', authenticate, authorize(...ROLES.REPORTS), async (req, res) => {
  try {
    const bad = validateReportQuery(req.query);
    if (bad) return res.status(400).json({ error: bad });
    const { format } = req.query;
    const { rows } = await pool.query(
      `SELECT m.*, c.name AS category_name FROM materials m LEFT JOIN categories c ON c.id = m.category_id
       WHERE m.is_active=true AND m.reorder_level IS NOT NULL AND m.quantity <= m.reorder_level
       ORDER BY (m.reorder_level - m.quantity) DESC`
    );
    if (format === 'excel' || format === 'pdf') {
      const columns = [
        { header: 'Material', key: 'name', width: 26 }, { header: 'SKU', key: 'sku', width: 16 },
        { header: 'Category', key: 'category_name', width: 18 }, { header: 'Unit', key: 'unit', width: 8 },
        { header: 'Quantity', key: 'quantity', width: 12, align: 'right' }, { header: 'Reorder Level', key: 'reorder_level', width: 12, align: 'right' }
      ];
      if (format === 'excel') return exportExcel(res, rows, 'Low_Stock', columns);
      return exportPdf(res, 'Low Stock Alert', rows, columns);
    }
    res.json(rows);
  } catch (err) { return dbError(res, err); }
});

async function exportExcel(res, data, filename, columns) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(filename);
  // ExcelJS needs `header`; accept legacy `name` too so no export ships without a header row
  ws.columns = columns.map(c => ({ header: c.header || c.name, key: c.key, width: c.width || 16 }));
  ws.getRow(1).font = { bold: true };
  data.forEach(r => ws.addRow(r));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}.xlsx`);
  await wb.xlsx.write(res);
  return res.end();
}

// Tabular PDF: landscape A4, header row repeated on every page, page numbers.
// `columns` is the same {header,key,width,align,type} list used for Excel.
function exportPdf(res, title, data, columns) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, info: { Title: title, Author: 'Al Shafi Enterprises' } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${title.replace(/\s+/g, '_')}.pdf"`);
  doc.pipe(res);

  const navy = '#0f172a', slate = '#475569', line = '#e2e8f0';
  const left = doc.page.margins.left, right = doc.page.width - doc.page.margins.right, width = right - left;
  const totalW = columns.reduce((a, c) => a + (c.width || 16), 0);
  const colW = columns.map(c => (c.width || 16) / totalW * width);
  const fmt = (c, v) => {
    if (v === null || v === undefined || v === '') return '-';
    if (c.type === 'date') { const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' }); }
    if (c.align === 'right' && !isNaN(Number(v))) return Number(v).toLocaleString('en-PK', { maximumFractionDigits: 2 });
    return String(v);
  };
  let page = 0;
  const header = () => {
    page += 1;
    doc.font('Helvetica-Bold').fontSize(14).fillColor(navy).text('Al Shafi Enterprises', left, 28);
    doc.font('Helvetica').fontSize(9).fillColor(slate).text(`Generated ${new Date().toLocaleString('en-PK')}  ·  ${data.length} row${data.length === 1 ? '' : 's'}`, left, 30, { width, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(12).fillColor(navy).text(title, left, 48);
    let y = 72;
    doc.rect(left, y, width, 20).fill(navy);
    let x = left;
    columns.forEach((c, i) => { doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff').text(c.header, x + 4, y + 6, { width: colW[i] - 8, align: c.align || 'left', lineBreak: false }); x += colW[i]; });
    return y + 20;
  };
  const footer = () => {
    // Writing inside the bottom margin would make PDFKit start a new page; lift the margin while we draw.
    const keep = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text(`Page ${page}`, left, doc.page.height - 24, { width, align: 'center', lineBreak: false });
    doc.page.margins.bottom = keep;
  };
  let y = header();
  const bottom = doc.page.height - 44;
  if (data.length === 0) doc.font('Helvetica').fontSize(10).fillColor(slate).text('No records.', left, y + 12);
  data.forEach((row, r) => {
    const cells = columns.map(c => fmt(c, row[c.key]));
    doc.font('Helvetica').fontSize(8);
    const h = Math.max(18, ...cells.map((t, i) => doc.heightOfString(t, { width: colW[i] - 8 }) + 8));
    if (y + h > bottom) { footer(); doc.addPage(); y = header(); doc.font('Helvetica').fontSize(8); }
    if (r % 2 === 1) doc.rect(left, y, width, h).fill('#f8fafc');
    let x = left;
    cells.forEach((t, i) => { doc.fillColor(navy).text(t, x + 4, y + 4, { width: colW[i] - 8, align: columns[i].align || 'left' }); x += colW[i]; });
    doc.moveTo(left, y + h).lineTo(right, y + h).strokeColor(line).lineWidth(0.5).stroke();
    y += h;
  });
  footer();
  doc.end();
}

module.exports = router;