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
npm run db:seed
npm run build
npm start
```

Serve the built frontend and API from the same Node process on `PORT`.
