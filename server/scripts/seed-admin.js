import { config } from '../config.js';
import { pool, closePool } from '../db.js';
import { hashPassword } from '../auth.js';

async function main() {
  const email = String(process.env.AUTH_ADMIN_EMAIL || 'changeradmin@gmail.com').trim().toLowerCase();
  const password = process.env.AUTH_ADMIN_PASSWORD;
  if (!password) {
    const existing = await pool.query('SELECT 1 FROM app_users WHERE lower(email) = $1 LIMIT 1', [email]);
    if (existing.rowCount) {
      console.log(`admin user already exists: ${email}`);
      return;
    }
    throw new Error('AUTH_ADMIN_PASSWORD is required when the admin user has not been seeded.');
  }

  const { salt, hash } = await hashPassword(password);
  await pool.query(
    `INSERT INTO app_users (email, password_salt, password_hash, role, is_active)
     VALUES ($1, $2, $3, 'admin', true)
     ON CONFLICT ((lower(email))) DO UPDATE SET
       password_salt = excluded.password_salt,
       password_hash = excluded.password_hash,
       role = 'admin',
       is_active = true,
       updated_at = now()`,
    [email, salt, hash]
  );
  console.log(`seeded admin user: ${email} (${config.nodeEnv})`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(closePool);
