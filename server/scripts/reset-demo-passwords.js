const pool = require('../src/db/pool');
const bcrypt = require('bcryptjs');

const DEMO_ACCOUNTS = [
  { email: 'owner@ims.com', role: 'Owner' },
  { email: 'admin@ims.com', role: 'Admin' },
  { email: 'finance@ims.com', role: 'Finance' },
  { email: 'manager@ims.com', role: 'Manager' },
  { email: 'procurement@ims.com', role: 'Procurement' },
  { email: 'store@ims.com', role: 'StoreManager' },
  { email: 'engineer@ims.com', role: 'SiteEngineer' },
  { email: 'staff@ims.com', role: 'Staff' },
];

const PASSWORD_PATTERN = 'IMS2024!';

async function resetPasswords() {
  const client = await pool.connect();
  try {
    for (const { email, role } of DEMO_ACCOUNTS) {
      const password = `IMS2024!${role}`;
      const hashed = await bcrypt.hash(password, 10);
      const result = await client.query(
        'UPDATE users SET password_hash=$1 WHERE email=$2 AND is_active=true',
        [hashed, email]
      );
      console.log(`Updated ${email} (${role}): ${result.rowCount > 0 ? 'OK' : 'NOT FOUND'} -> Password: ${password}`);
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

resetPasswords();