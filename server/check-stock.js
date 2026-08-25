const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function checkStock() {
  try {
    // Check material stock
    const { rows: materials } = await pool.query('SELECT id, name, sku, quantity, unit_cost FROM materials WHERE is_active=true ORDER BY quantity ASC');
    console.log('=== Materials Stock ===');
    materials.forEach(m => console.log(`${m.sku} | ${m.name} | Qty: ${m.quantity} | Unit Cost: ${m.unit_cost} | Value: ${(m.quantity * m.unit_cost).toFixed(2)}`));
    
    // Check transactions per material
    const { rows: txns } = await pool.query(`
      SELECT 
        m.id, m.name, m.sku, m.quantity as current_qty, m.unit_cost,
        COALESCE(SUM(CASE WHEN mt.type = 'in' THEN mt.quantity ELSE 0 END), 0) as total_in,
        COALESCE(SUM(CASE WHEN mt.type = 'out' THEN mt.quantity ELSE 0 END), 0) as total_out
      FROM materials m
      LEFT JOIN material_transactions mt ON mt.material_id = m.id AND mt.status <> 'deleted'
      WHERE m.is_active = true
      GROUP BY m.id, m.name, m.sku, m.quantity, m.unit_cost
      ORDER BY m.quantity ASC
    `);
    console.log('\n=== Transaction Analysis ===');
    txns.forEach(t => {
      const calculated = parseFloat(t.total_in) - parseFloat(t.total_out);
      const diff = parseFloat(t.current_qty) - calculated;
      console.log(`${t.sku} | ${t.name} | Current: ${t.current_qty} | In: ${t.total_in} | Out: ${t.total_out} | Calc: ${calculated.toFixed(2)} | Diff: ${diff.toFixed(2)}`);
    });
    
    // Total inventory value
    const { rows: value } = await pool.query('SELECT SUM(quantity * unit_cost) as total_value FROM materials WHERE is_active=true AND quantity > 0');
    console.log('\n=== Inventory Value (qty > 0) ===', value[0].total_value);
    
    const { rows: valueAll } = await pool.query('SELECT SUM(quantity * unit_cost) as total_value FROM materials WHERE is_active=true');
    console.log('=== Inventory Value (all) ===', valueAll[0].total_value);
    
  } catch (err) { console.error(err); } finally { await pool.end(); }
}
checkStock();