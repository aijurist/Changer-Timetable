import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { pool, closePool } from '../db.js';

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const migrationsDir = path.join(config.rootDir, 'db', 'migrations');
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();

  for (const file of files) {
    const existing = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
    if (existing.rowCount) {
      console.log(`skip ${file}`);
      continue;
    }

    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await pool.query('COMMIT');
      console.log(`applied ${file}`);
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
