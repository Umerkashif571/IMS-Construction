const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { dbError } = require('../middleware/validate');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const [kpis, recentActivity, projectBudgets, categoryBreakdown] = await Promise.all([
      pool.query(`SELECT
        (SELECT COALESCE(SUM(quantity * unit_cost), 0)::float FROM materials WHERE is_active=true) as inventory_value,
        (SELECT COUNT(*)::int FROM projects WHERE status='active') as active_projects,
        (SELECT COUNT(*)::int FROM vehicles WHERE is_active=true AND current_status='active') as vehicles_active,
        (SELECT COUNT(*)::int FROM tools WHERE is_active=true AND current_status='checked_out') as tools_checked_out,
        (SELECT COUNT(*)::int FROM materials WHERE is_active=true AND quantity <= reorder_level) as low_stock_count,
        (SELECT COUNT(*)::int FROM vehicles WHERE is_active=true AND current_status!='retired' AND next_maintenance_date IS NOT NULL AND next_maintenance_date <= NOW() + INTERVAL '30 days') as maintenance_due_count`),
      pool.query(`SELECT * FROM activity_feed ORDER BY created_at DESC LIMIT 20`),
      pool.query(
        `SELECT p.id, p.name,
          COALESCE(SUM(mt.quantity * m.unit_cost), 0) as total_material_cost
         FROM projects p
         LEFT JOIN material_transactions mt ON mt.project_id = p.id AND mt.type = 'out'
         LEFT JOIN materials m ON mt.material_id = m.id
         WHERE p.status IN ('active', 'planning')
         GROUP BY p.id, p.name
         ORDER BY total_material_cost DESC`
      ),
      pool.query(
        `SELECT c.name, COALESCE(SUM(m.quantity * m.unit_cost), 0) as total_value
         FROM categories c LEFT JOIN materials m ON c.id=m.category_id AND m.is_active=true
         GROUP BY c.name ORDER BY total_value DESC`
      )
    ]);
    const k = kpis.rows[0];

    res.json({
      inventory_value: parseFloat(k.inventory_value),
      active_projects: parseInt(k.active_projects),
      vehicles_active: parseInt(k.vehicles_active),
      tools_checked_out: parseInt(k.tools_checked_out),
      low_stock_count: parseInt(k.low_stock_count),
      maintenance_due_count: parseInt(k.maintenance_due_count),
      recent_activity: recentActivity.rows,
      project_budgets: projectBudgets.rows,
      category_breakdown: categoryBreakdown.rows
    });
  } catch (err) { return dbError(res, err); }
});

router.get('/activity', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM activity_feed ORDER BY created_at DESC LIMIT 50');
    res.json(rows);
  } catch (err) { return dbError(res, err); }
});

module.exports = router;