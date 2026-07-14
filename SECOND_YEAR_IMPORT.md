# Semester 3 section timetable import

Changer stores Semester 3 sections additively. Semester 5 and 7 keep their existing group-based behavior and records.

## Data model

Migration `004_second_year_sections.sql` adds these indexed session fields:

- `source_course_instance_key`: the full CSV identity such as `622__s0`.
- `partner_course_instance_key`: the reciprocal paired identity.
- `section_index`: the numeric `__sN` suffix (`0` = Section A).

The original CSV row remains in `raw_payload`. Existing numeric `course_instance_id` foreign keys retain the base ID (`622`), so the current course table stays compatible.

## Supabase import method

Use the Supabase shared pooler URL through `DATABASE_URL`; never add the password or URL to Git.

```powershell
$env:DATABASE_URL = '<Supabase shared-pooler URL>'
$env:DATABASE_SSL = 'relaxed'
$env:PG_POOL_SIZE = '1'

npm run db:migrate

npm run db:import:second-year -- `
  --department 'Mechanical Engineering' `
  --theory 'C:\path\theory_schedule_second_year.csv' `
  --lab 'C:\path\lab_schedule_second_year.csv' `
  --dry-run

npm run db:import:second-year -- `
  --department 'Mechanical Engineering' `
  --theory 'C:\path\theory_schedule_second_year.csv' `
  --lab 'C:\path\lab_schedule_second_year.csv'
```

The importer is department-scoped and idempotent. It archives only earlier `second_year_csv:*` Semester 3 sessions for the selected department, then upserts the current CSV rows. It does not modify Semester 5 or 7 sessions.

For an explicitly approved full replacement, use one atomic authoritative import:

```powershell
npm run db:import:second-year -- `
  --all-departments `
  --theory 'C:\path\theory_schedule_second_year.csv' `
  --lab 'C:\path\lab_schedule_second_year.csv' `
  --bypass-room-conflicts `
  --authoritative
```

This archives only active CSV-sourced Semester 3 rows, imports every supplied Semester 3 department in one transaction, and leaves Semesters 5 and 7 untouched. Ordinary room overlaps are stored with a visible override marker. Teacher, section, room, and capacity issues remain visible in Changer; normal HTTP edits continue to use strict validation.

Before commit, the same transaction checks:

- teacher overlap against every active semester and department;
- room overlap against every active semester and department;
- section overlap within the Semester 3 section;
- room capacity using half-count for paired 25 + 25 theory rows.

Reciprocal 25 + 25 partners sharing one room are intentional and are excluded only from the room and section overlap checks. A CSV `student_count` of `50` on each reciprocal row is treated as an effective count of `25` for capacity checks.

The shared rooms `ANEW101`, `ANEW102`, `ANEW103`, `ANEW104`, `KSL02`, and `A104/105` allow intentional room overlap. The second-year CSV alias `KS02` is normalized to `KSL02` from `rooms_new.csv`.

Semester 3 DBMS (`CS23332`) and OOPS (`CS23333`) may intentionally overlap for the same staff or room only when they belong to different sections of the same department. This exception does not permit two courses to overlap inside one section, and it does not relax any Semester 5 or 7 conflict rule. Without `--authoritative`, any other clash rolls the whole import back.

## Verification

```sql
SELECT department, semester, section_index, schedule_type, count(*)
FROM sessions
WHERE status = 'active' AND semester = 3
GROUP BY department, semester, section_index, schedule_type
ORDER BY department, section_index, schedule_type;

SELECT key, value
FROM app_settings
WHERE key LIKE 'second_year_import:%';
```

The importer writes a receipt to `app_settings` with section indexes, source filenames, session counts, and import time.
