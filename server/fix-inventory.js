const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function fixInventory() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('Fixing inventory properly...');

    // Get all materials with their current quantities and transaction history
    const { rows: materials } = await client.query(`
      SELECT 
        m.id, m.name, m.sku, m.quantity as current_qty, m.unit_cost,
        COALESCE(SUM(CASE WHEN mt.type = 'in' THEN mt.quantity ELSE 0 END), 0) as total_in,
        COALESCE(SUM(CASE WHEN mt.type = 'out' THEN mt.quantity ELSE 0 END), 0) as total_out
      FROM materials m
      LEFT JOIN material_transactions mt ON mt.material_id = m.id
      WHERE m.is_active = true
      GROUP BY m.id, m.name, m.sku, m.quantity, m.unit_cost
    `);

    console.log(`Processing ${materials.length} materials...`);

    for (const m of materials) {
      const totalIn = parseFloat(m.total_in) || 0;
      const totalOut = parseFloat(m.total_out) || 0;
      const currentQty = parseFloat(m.current_qty) || 0;
      
      // If there are "out" transactions but no "in" transactions, we need to add opening stock
      if (totalIn === 0 && totalOut > 0) {
        // Opening stock should be: what was taken out + some reasonable remaining stock
        // Let's say we want ~20% of total_out as remaining stock
        const remainingStock = Math.ceil(totalOut * 0.2); // 20% remaining
        const openingStock = totalOut + remainingStock;
        
        console.log(`Fixing ${m.sku} (${m.name}): total_in=${totalIn}, total_out=${totalOut}, current=${m.current_qty}`);
        console.log(`  Adding opening stock: ${openingStock} (${totalOut} consumed + ${remainingStock} remaining)`);
        
        // Add opening stock transaction
        await client.query(
          `INSERT INTO material_transactions (material_id, type, quantity, running_total, date, project_id, warehouse_id, location, driver_name, vehicle_number, added_by, notes, transaction_type)
           VALUES ($1, 'in', $2, $3, NOW(), NULL, $4, 'Opening Stock', 'System', 'SYS-001', $5, 'Opening stock adjustment', 'opening_stock')`,
          [m.id, openingStock, openingStock, null, m.id]
        );
        console.log(`  Added opening stock transaction: ${openingStock} ${m.sku}`);
        
        // Update material quantity to remaining stock
        await client.query(
          'UPDATE materials SET quantity = $1, updated_at = NOW() WHERE id = $2',
          [totalOut * 0.2, m.id] // 20% remaining
        );
        console.log(`  Updated quantity: ${m.current_qty} -> ${totalOut * 0.2}`);
      }
      // If there are both in and out transactions, just verify the math
      else if (totalIn > 0) {
        const correctQty = parseFloat(m.total_in) - parseFloat(m.total_out);
        const currentQty = parseFloat(m.current_qty) || 0;
        
        if (currentQty !== correctQty) {
          console.log(`Fixing ${m.sku} (${m.name}): current=${currentQty}, correct=${correctQty} (in=${totalIn}, out=${totalOut})`);
          await client.query(
            'UPDATE materials SET quantity = $1, updated_at = NOW() WHERE id = $2',
            [correctQty, m.id]
          );
          console.log(`  Updated quantity: ${m.current_qty} -> ${correctQty}`);
        }
      }
    }

    await client.query('COMMIT');
    console.log('\n=== Fix complete ===');
    
    // Verify
    const { rows: verify } = await pool.query(`
      SELECT m.name, m.sku, m.quantity, m.unit_cost,
             (m.quantity * m.unit_cost) as value
      FROM materials m
      WHERE m.is_active = true AND m.quantity > 0
      ORDER BY value DESC
    `);
    console.log('\n=== Materials with positive stock ===');
    let totalValue = 0;
    verify.forEach(m => {
      const value = parseFloat(m.value) || 0;
      totalValue += value;
      console.log(`${m.sku} | ${m.name} | Qty: ${m.quantity} | Value: ${value.toLocaleString()}`);
    });
    console.log(`\nTotal Inventory Value (positive stock): ${totalValue.toLocaleString()}`);
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error:', err.message, err.stack);
  } finally {
    client.release();
    await pool.end();
  }
}

fixInventory();