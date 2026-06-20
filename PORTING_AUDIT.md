# Legacy Changer Porting Audit

Checked against tracked legacy files:

- `allocation_manager.js`
- `schedule_viewer.js`
- `server.js`
- `performance-optimizer.js`
- `user-state-manager.js`

## Ported Core Logic

- Load theory and lab schedules into one editable model.
- Import rooms from the current scheduler room source, `data/import/rooms_new.csv`.
- Import working days, theory slots, lab sessions, shifts, and department working-day policies from `data/import/scheduler.yaml`.
- Teacher overlap validation across theory and lab.
- Room overlap validation across theory and lab.
- Bypass room handling for `A104/105`, `KSL02`, `KSL03`, `ANEW101`, `ANEW102`, `ANEW103`, `A210/211`, `ANEW201`, `ANEW202`, `ANEW104`.
- Capacity validation with batched-lab effective count.
- Group overlap warnings without blocking saves.
- Room availability and teacher availability lookup.
- Legacy room type and special capacity rules.
- Session quick-edit fields: day, slot, teacher, room, student count, lab batch metadata, practical hours, lecture/tutorial hours, co-schedule info.
- Legacy-shaped JSON/CSV export endpoints for theory and lab schedules.

## Upgraded In The Migration

- Whole-file JSON writes are replaced by row-level PostgreSQL transactions.
- Browser-only validation is replaced by server-side validation.
- Race handling now uses database advisory transaction locks on affected room/day and teacher/day resources.
- Stale edits are rejected through `row_version`.
- Every attempted edit is tracked in `edit_requests`; applied edits get before/after records in `session_audit_log`.
- Scheduler slot definitions now come from `scheduler.yaml`, not hard-coded old `L1-L6` and 11 theory-slot arrays.

## Intentionally Replaced

- Old JSON/CSV backup file generation is replaced by database audit logs and export endpoints.
- Old localStorage UI state is not a data integrity feature and was not recreated.
- Old chunked frontend performance helpers are unnecessary for the smaller server-paginated result set.
- Old drag-and-drop DOM helpers, conflict modals, and Bootstrap-only views were replaced by the React editor flow.
- Old direct `/api/save-schedule` and `/api/save-csv` endpoints were removed because they allow whole-file overwrites and do not support concurrent staff edits.

## Verification Notes

- Local import dry-read parses 151 rooms, 2,130 theory sessions, 1,225 lab sessions, 9 current theory slots, and 5 current lab sessions.
- `rooms_new.csv` requires explicit newline handling in Node; the seed script now sets `record_delimiter` for `CRLF`, `LF`, and `CR`.
- Live DB migration/seed still requires a PostgreSQL server; this workstation has neither Docker nor PostgreSQL listening on port 5432.
