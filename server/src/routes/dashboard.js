const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const [inventoryValue, activeProjects, vehiclesActive, toolsCheckedOut,
       lowStock, maintenanceDue, recentActivity, projectBudgets, categoryBreakdown] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(quantity * unit_cost), 0) as total_value FROM materials WHERE is_active=true`),
      pool.query(`SELECT COUNT(*) as count FROM projects WHERE status='active'`),
      pool.query(`SELECT COUNT(*) as count FROM vehicles WHERE current_status='active'`),
      pool.query(`SELECT COUNT(*) as count FROM tools WHERE current_status='checked_out'`),
      pool.query(`SELECT COUNT(*) as count FROM materials WHERE is_active=true AND quantity <= reorder_level`),
      pool.query(`SELECT COUNT(*) as count FROM vehicles WHERE current_status!='retired' AND next_maintenance_date IS NOT NULL AND next_maintenance_date <= NOW() + INTERVAL '30 days'`),
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

    res.json({
      inventory_value: parseFloat(inventoryValue.rows[0].total_value),
      active_projects: parseInt(activeProjects.rows[0].count),
      vehicles_active: parseInt(vehiclesActive.rows[0].count),
      tools_checked_out: parseInt(toolsCheckedOut.rows[0].count),
      low_stock_count: parseInt(lowStock.rows[0].count),
      maintenance_due_count: parseInt(maintenanceDue.rows[0].count),
      recent_activity: recentActivity.rows,
      project_budgets: projectBudgets.rows,
      category_breakdown: categoryBreakdown.rows
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/activity', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM activity_feed ORDER BY created_at DESC LIMIT 50');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;