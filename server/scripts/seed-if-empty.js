import { pool, closePool } from '../db.js';

async function main() {
  const table = await pool.query("SELECT to_regclass('public.sessions') AS table_name");
  if (!table.rows[0].table_name) {
    await closePool();
    await import('./seed.js');
    return;
  }

  const result = await pool.query("SELECT count(*)::int AS count FROM sessions WHERE status = 'active'");
  if (result.rows[0].count > 0) {
    console.log(`seed skipped: ${result.rows[0].count} active sessions already exist`);
    return;
  }

  await closePool();
  await import('./seed.js');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closePool();
    } catch {
      // The full seed script owns pool shutdown when it is imported above.
    }
  });
