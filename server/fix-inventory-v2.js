const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function fixInventory() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('Fixing inventory (v2 - proper positive stock)...');

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
      const calculated = totalIn - totalOut;
      
      // Target: positive stock of at least 1000 units (or 2x totalOut, whichever is larger)
      const targetQty = Math.max(1000, totalOut * 2);
      
      // We need: total_in - total_out = targetQty
      // So: total_in = targetQty + totalOut
      // Since we can only add "in" transactions, we need:
      // new_total_in = targetQty + totalOut
      // additional_in = new_total_in - totalIn
      const neededTotalIn = totalOut + Math.max(1000, totalOut * 2);
      const additionalIn = neededTotalIn - totalIn;
      
      if (additionalIn > 0) {
        console.log(`Fixing ${m.sku} (${m.name}): in=${totalIn}, out=${totalOut}, target=${totalOut + Math.max(1000, totalOut * 2)}, adding ${additionalIn.toFixed(2)}`);
        
        // Add opening stock transaction
        await client.query(
          `INSERT INTO material_transactions (material_id, type, quantity, running_total, date, project_id, warehouse_id, location, driver_name, vehicle_number, added_by, notes, transaction_type)
           VALUES ($1, 'in', $2, $3, NOW(), NULL, $4, 'Opening Stock - System Adjustment', 'System', 'SYS-001', $5, 'Opening stock adjustment for realistic inventory', 'opening_stock')`,
          [m.id, additionalIn, totalIn + additionalIn, null, m.id]
        );
        
        // Update material quantity to correct value
        const newQty = (totalIn + additionalIn) - totalOut;
        await client.query(
          'UPDATE materials SET quantity = $1, updated_at = NOW() WHERE id = $2',
          [newQty, m.id]
        );
        console.log(`  ${m.sku}: ${m.quantity} -> ${newQty} (added ${additionalIn.toFixed(2)} opening stock)`);
      } else if (currentQty < 0) {
        // Material has negative stock but no "out" transactions - just fix to positive
        const targetQty = 1000;
        const additionalIn = 1000 - totalIn;
        
        console.log(`Fixing ${m.sku} (${m.name}): negative stock ${currentQty}, adding ${additionalIn} to reach ${targetQty}`);
        
        await client.query(
          `INSERT INTO material_transactions (material_id, type, quantity, running_total, date, project_id, warehouse_id, location, driver_name, vehicle_number, added_by, notes, transaction_type)
           VALUES ($1, 'in', $2, $3, NOW(), NULL, NULL, 'Opening Stock - System Adjustment', 'System', 'SYS-001', $4, 'Opening stock adjustment for realistic inventory', 'opening_stock')`,
          [m.id, additionalIn, totalIn + additionalIn, m.id]
        );
        
        await client.query(
          'UPDATE materials SET quantity = $1, updated_at = NOW() WHERE id = $2',
          [targetQty, m.id]
        );
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