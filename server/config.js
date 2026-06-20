import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function resolveFromRoot(value, fallback) {
  const raw = value || fallback;
  return path.isAbsolute(raw) ? raw : path.join(rootDir, raw);
}

export const config = {
  rootDir,
  port: Number(process.env.PORT || 8080),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'postgres://changer:changer@localhost:5432/changer',
  databaseSsl: resolveDatabaseSsl(),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  clientDist: path.join(rootDir, 'client', 'dist'),
  importPaths: {
    theorySchedule: resolveFromRoot(process.env.THEORY_SCHEDULE_JSON, 'data/import/theory_schedule.json'),
    labSchedule: resolveFromRoot(process.env.LAB_SCHEDULE_JSON, 'data/import/lab_schedule.json'),
    roomsCsv: resolveFromRoot(process.env.ROOMS_CSV, 'data/import/rooms_new.csv'),
    schedulerYaml: resolveFromRoot(process.env.SCHEDULER_YAML, 'data/import/scheduler.yaml')
  }
};

function resolveDatabaseSsl() {
  const mode = String(process.env.DATABASE_SSL || '').toLowerCase();
  if (!mode) return undefined;
  if (mode === 'false' || mode === 'off' || mode === 'disable') return false;
  if (mode === 'relaxed' || mode === 'no-verify') return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}
