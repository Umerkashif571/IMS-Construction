const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { addActivity } = require('../db/helpers');
require('dotenv').config();

const router = express.Router();

const MAX_ATTEMPTS = 8;
const LOCK_MS = 15 * 60 * 1000;
const attempts = new Map();

// Helper: promise with timeout
function withTimeout(promise, ms, timeoutError) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(timeoutError), ms))
  ]);
}

// Helper: retry with exponential backoff for cold starts
async function withRetry(fn, retries = 2, baseDelay = 500) {
  try {
    return await fn();
  } catch (err) {
    if (retries === 0) throw err;
    const delay = baseDelay * Math.pow(2, 2 - retries);
    await new Promise(r => setTimeout(r, delay));
    return withRetry(fn, retries - 1, baseDelay);
  }
}

function throttleKey(email, ip) {
  return `${(email || '').toLowerCase().trim()}|${ip}`;
}

function isLocked(email, ip) {
  const rec = attempts.get(throttleKey(email, ip));
  if (!rec) return false;
  if (rec.lockedUntil && Date.now() < rec.lockedUntil) return true;
  if (Date.now() - rec.firstAt > LOCK_MS) { attempts.delete(throttleKey(email, ip)); return false; }
  return false;
}

function recordFailure(email, ip) {
  const key = throttleKey(email, ip);
  const rec = attempts.get(key) || { count: 0, firstAt: Date.now() };
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) rec.lockedUntil = Date.now() + LOCK_MS;
  attempts.set(key, rec);
}

function recordSuccess(email, ip) { attempts.delete(throttleKey(email, ip)); }

router.post('/login', async (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  if (isLocked(email, ip)) return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });

  console.log('Login attempt:', { email: email.trim().toLowerCase(), ip });
  
  try {
    console.log('Querying database for user...');
    const { rows } = await withRetry(async () => {
      return withTimeout(
        pool.query('SELECT * FROM users WHERE email = $1 AND is_active = true', [email.trim().toLowerCase()]),
        15000,
        new Error('Database query timeout')
      );
    }, 2, 1000);
    console.log('Database query completed, rows:', rows.length);
    
    if (rows.length === 0) { recordFailure(email, ip); return res.status(401).json({ error: 'Invalid credentials' }); }

    const user = rows[0];
    console.log('User found, verifying password...');
    
    const valid = await withTimeout(
      bcrypt.compare(password, user.password_hash),
      5000,
      new Error('Password verification timeout')
    );
    console.log('Password verification completed, valid:', valid);
    
    if (!valid) { recordFailure(email, ip); return res.status(401).json({ error: 'Invalid credentials' }); }

    recordSuccess(email, ip);

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, full_name: user.full_name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    await addActivity(user.full_name, 'logged_in', `User ${user.full_name} logged in`, 'auth', user.id);

    res.json({
      token,
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, phone: user.phone }
    });
  } catch (err) {
    console.error('Login error:', err?.message || err, err?.stack);
    const status = err?.message?.includes('timeout') ? 504 : 500;
    const message = err?.message?.includes('timeout') ? 'Request timeout. Please try again.' : 'Server error';
    res.status(status).json({ error: message });
  }
});

router.get('/me', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, email, full_name, role, phone, created_at FROM users WHERE id = $1', [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
