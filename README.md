# Changer

Changer is now a PostgreSQL-backed timetable editor for post-scheduler manual changes.

## What changed

- `theory_schedule.json`, `lab_schedule.json`, `rooms_new.csv`, and `scheduler.yaml` seed the database from `data/import/`.
- Staff edits go through HTTP APIs instead of overwriting whole JSON files.
- Each edit is handled in a database transaction with advisory locks for the affected room/day and teacher/day.
- Room, teacher, capacity, and department working-day checks run before commit.
- Group overlap remains a warning, matching the old bypassed grouping behavior.

## Database structure

- `rooms`: room inventory from `rooms_new.csv`, with imported fallback rooms when an old schedule row references a room missing from the CSV.
- `teachers`: staff referenced by the imported timetable.
- `course_instances`: course metadata from the schedule files.
- `student_groups`: department/semester/group rows.
- `working_days`, `time_slots`, `lab_session_parts`, `shift_templates`, `department_policies`: scheduler config from `scheduler.yaml`.
- `sessions`: one row per timetable activity, including normalized day/time, room, teacher, capacity, and the original JSON payload.
- `edit_requests`: synchronous request queue/audit envelope for every attempted edit.
- `session_audit_log`: before/after payloads for applied edits.

## Local run

```powershell
copy .env.example .env
docker compose up -d postgres
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Frontend: `http://localhost:5173`

API: `http://localhost:8080`

## Production run

```powershell
npm install
npm run db:migrate
npm run db:seed:if-empty
npm run build
npm start
```

Serve the built frontend and API from the same Node process on `PORT`.

## Free Hosting: Render + Supabase

Recommended free setup:

- Supabase: PostgreSQL database.
- Render: Node web service that serves both the API and the built React frontend.

### 1. Create the database

1. Create a Supabase project.
2. Copy the PostgreSQL connection string.
3. Use the pooled/session connection string if Supabase offers one, and keep `sslmode=require` in the URL when provided.

### 2. Deploy the web service

1. Push this repository to GitHub.
2. In Render, create a new Blueprint or Web Service from the repo.
3. If using `render.yaml`, Render will use:
   - Build command: `npm ci && npm run build`
   - Pre-deploy command: `npm run deploy:init`
   - Start command: `npm start`
   - Health check: `/api/health`
4. Add the `DATABASE_URL` environment variable from Supabase.
5. Add `DATABASE_SSL=relaxed` when using the Supabase shared pooler URL.

`npm run deploy:init` runs migrations and then `db:seed:if-empty`. This seeds the imported timetable only when the `sessions` table is empty. It will not wipe staff edits on later deploys.

### Required production environment variables

```text
NODE_ENV=production
DATABASE_URL=postgresql://...
DATABASE_SSL=relaxed
```

For Supabase pooler passwords with special characters, URL-encode the password before pasting it into `DATABASE_URL`. For example, `@` becomes `%40`. Do not include `?sslmode=require`; SSL is controlled by `DATABASE_SSL`.

Optional seed path overrides are already defaulted to `data/import/`:

```text
THEORY_SCHEDULE_JSON=data/import/theory_schedule.json
LAB_SCHEDULE_JSON=data/import/lab_schedule.json
ROOMS_CSV=data/import/rooms_new.csv
SCHEDULER_YAML=data/import/scheduler.yaml
```

### Important

Do not run `npm run db:seed` against production after staff start editing. It truncates and re-imports the timetable. Use `npm run db:seed:if-empty` for hosting/deploy initialization.
