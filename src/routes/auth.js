/**
 * AuditPilot — Auth Routes
 * POST /api/auth/register
 * POST /api/auth/login
 * POST /api/auth/logout
 * GET  /api/auth/me
 */

const express    = require('express');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const { query }  = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

const router      = express.Router();
const SALT_ROUNDS = 12;

// Cookie options — secure flag is set in production (Railway sets NODE_ENV=production)
const cookieOpts = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge:   7 * 24 * 60 * 60 * 1000  // 7 days in ms
};

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function safeUser(row) {
  return {
    id:        row.id,
    email:     row.email,
    fullName:  row.full_name,
    createdAt: row.created_at
  };
}

// ── POST /api/auth/register ───────────────────────────────────────────────────

router.post('/register', async (req, res) => {
  const { email, password, fullName } = req.body;

  // ── Validation ──────────────────────────────────────────────────────────────
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    // ── Check for existing account ───────────────────────────────────────────
    const existing = await query(
      'SELECT id FROM users WHERE email = $1',
      [normalizedEmail]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // ── Hash password ────────────────────────────────────────────────────────
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // ── Insert user ──────────────────────────────────────────────────────────
    const { rows } = await query(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, $3)
       RETURNING id, email, full_name, created_at`,
      [normalizedEmail, passwordHash, fullName?.trim() || null]
    );
    const user = rows[0];

    // ── Auto-create free subscription (expires 100 years from now) ───────────
    const farFuture = new Date();
    farFuture.setFullYear(farFuture.getFullYear() + 100);

    await query(
      `INSERT INTO subscriptions
         (user_id, plan, status, current_period_start, current_period_end)
       VALUES ($1, 'free', 'active', NOW(), $2)`,
      [user.id, farFuture]
    );

    const token = signToken(user);
    res.cookie('auditpilot_token', token, cookieOpts);

    return res.status(201).json({
      user: safeUser(user),
      plan:  'free',
      token
    });

  } catch (err) {
    console.error('[auth] Register error:', err.message);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const { rows } = await query(
      `SELECT id, email, full_name, password_hash, created_at
         FROM users WHERE email = $1`,
      [normalizedEmail]
    );

    if (rows.length === 0) {
      // Same message for missing user and wrong password — avoids user enumeration
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user  = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // ── Fetch active subscription ────────────────────────────────────────────
    const subResult = await query(
      `SELECT plan, status, current_period_end
         FROM subscriptions
         WHERE user_id = $1 AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`,
      [user.id]
    );
    const plan = subResult.rows[0]?.plan || 'free';

    const token = signToken(user);
    res.cookie('auditpilot_token', token, cookieOpts);

    return res.json({
      user: safeUser(user),
      plan,
      token
    });

  } catch (err) {
    console.error('[auth] Login error:', err.message);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────

router.post('/logout', (req, res) => {
  res.clearCookie('auditpilot_token', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  });
  return res.json({ success: true });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────

router.get('/me', requireAuth, async (req, res) => {
  try {
    const userResult = await query(
      `SELECT id, email, full_name, created_at
         FROM users WHERE id = $1`,
      [req.user.sub]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const user = userResult.rows[0];

    // ── Active subscription ──────────────────────────────────────────────────
    const subResult = await query(
      `SELECT plan, status, current_period_end
         FROM subscriptions
         WHERE user_id = $1 AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`,
      [user.id]
    );

    // ── Scans used this calendar month ───────────────────────────────────────
    const monthYear = new Date().toISOString().slice(0, 7);   // e.g. '2026-06'
    const usageResult = await query(
      `SELECT COUNT(*) AS count
         FROM scan_usage
         WHERE user_id = $1 AND month_year = $2`,
      [user.id, monthYear]
    );

    return res.json({
      user:           safeUser(user),
      subscription:   subResult.rows[0] ?? { plan: 'free', status: 'active' },
      scansThisMonth: parseInt(usageResult.rows[0].count, 10)
    });

  } catch (err) {
    console.error('[auth] Me error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch user data.' });
  }
});

module.exports = router;
