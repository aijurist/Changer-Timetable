import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import express from 'express';

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = 'changer_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const loginAttempts = new Map();

export async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const derived = await scrypt(String(password), salt, 64, SCRYPT_OPTIONS);
  return { salt, hash: Buffer.from(derived).toString('hex') };
}

export async function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const actual = await hashPassword(password, salt);
  const expected = Buffer.from(expectedHash, 'hex');
  const received = Buffer.from(actual.hash, 'hex');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function createAuthRouter(pool, { secureCookies = false } = {}) {
  const router = express.Router();

  router.post('/login', async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const attemptKey = req.ip || req.socket.remoteAddress || 'unknown';
      const retryAfter = loginRetryAfter(attemptKey);
      if (retryAfter > 0) {
        res.setHeader('Retry-After', String(retryAfter));
        return res.status(429).json({ success: false, message: 'Too many login attempts. Try again shortly.' });
      }
      if (!email || password.length < 1 || password.length > 256) {
        recordLoginFailure(attemptKey);
        return res.status(401).json({ success: false, message: 'Invalid email or password.' });
      }

      const result = await pool.query(
        `SELECT id, email, password_salt, password_hash, role, is_active
         FROM app_users WHERE lower(email) = $1 LIMIT 1`,
        [email]
      );
      const user = result.rows[0];
      const valid = user?.is_active
        ? await verifyPassword(password, user.password_salt, user.password_hash)
        : await verifyPassword(password, '00000000000000000000000000000000', '0'.repeat(128));
      if (!valid) {
        recordLoginFailure(attemptKey);
        return res.status(401).json({ success: false, message: 'Invalid email or password.' });
      }

      loginAttempts.delete(attemptKey);
      const token = randomBytes(32).toString('base64url');
      const tokenHash = hashToken(token);
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await pool.query('DELETE FROM auth_sessions WHERE expires_at <= now()');
      await pool.query(
        `INSERT INTO auth_sessions (token_hash, user_id, expires_at, user_agent, ip_address)
         VALUES ($1, $2, $3, $4, $5)`,
        [tokenHash, user.id, expiresAt, String(req.get('user-agent') || '').slice(0, 500), String(req.ip || '').slice(0, 100)]
      );
      setSessionCookie(res, token, secureCookies);
      return res.json({ success: true, user: publicUser(user), expiresAt: expiresAt.toISOString() });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/me', requireAuth(pool), (req, res) => {
    res.json({ authenticated: true, user: req.auth.user, expiresAt: req.auth.expiresAt });
  });

  router.post('/logout', async (req, res, next) => {
    try {
      const token = readCookie(req, COOKIE_NAME);
      if (token) await pool.query('DELETE FROM auth_sessions WHERE token_hash = $1', [hashToken(token)]);
      clearSessionCookie(res, secureCookies);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function requireAuth(pool) {
  return async (req, res, next) => {
    try {
      const token = readCookie(req, COOKIE_NAME);
      if (!token) return unauthorized(res);
      const result = await pool.query(
        `SELECT u.id, u.email, u.role, a.expires_at
         FROM auth_sessions a
         JOIN app_users u ON u.id = a.user_id
         WHERE a.token_hash = $1 AND a.expires_at > now() AND u.is_active = true`,
        [hashToken(token)]
      );
      if (!result.rowCount) return unauthorized(res);
      const row = result.rows[0];
      req.auth = {
        user: publicUser(row),
        expiresAt: row.expires_at.toISOString()
      };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function publicUser(user) {
  return { id: user.id, email: user.email, role: user.role };
}

function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return null;
}

function setSessionCookie(res, token, secure) {
  const attributes = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  ];
  if (secure) attributes.push('Secure');
  res.setHeader('Set-Cookie', attributes.join('; '));
}

function clearSessionCookie(res, secure) {
  const attributes = [`${COOKIE_NAME}=`, 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) attributes.push('Secure');
  res.setHeader('Set-Cookie', attributes.join('; '));
}

function unauthorized(res) {
  return res.status(401).json({ success: false, message: 'Authentication required.' });
}

function loginRetryAfter(key) {
  const attempt = loginAttempts.get(key);
  if (!attempt || attempt.resetAt <= Date.now()) {
    loginAttempts.delete(key);
    return 0;
  }
  return attempt.count >= 8 ? Math.ceil((attempt.resetAt - Date.now()) / 1000) : 0;
}

function recordLoginFailure(key) {
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
  } else {
    current.count += 1;
  }
}
