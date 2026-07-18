-- CSE-A owns Sections A-G (indexes 0-6). Continue CSE-B at H-M (indexes 7-12)
-- before placing both streams under one department identity.
UPDATE sessions
SET department = 'Computer Science & Engineering',
    section_index = section_index + 7,
    source_course_instance_key = regexp_replace(source_course_instance_key, '__s[0-9]+$',
      '__s' || (section_index + 7)),
    partner_course_instance_key = CASE
      WHEN partner_course_instance_key IS NULL THEN NULL
      ELSE regexp_replace(partner_course_instance_key, '__s[0-9]+$',
        '__s' || (section_index + 7))
    END,
    raw_payload = (raw_payload || jsonb_build_object(
      'department', 'Computer Science & Engineering',
      'course_instance_id', regexp_replace(coalesce(raw_payload->>'course_instance_id', source_course_instance_key), '__s[0-9]+$',
        '__s' || (section_index + 7))
    )) || CASE
      WHEN coalesce(raw_payload->>'partner_instance_id', partner_course_instance_key) IS NULL THEN '{}'::jsonb
      ELSE jsonb_build_object(
        'partner_instance_id', regexp_replace(coalesce(raw_payload->>'partner_instance_id', partner_course_instance_key), '__s[0-9]+$',
          '__s' || (section_index + 7))
      )
    END,
    row_version = row_version + 1,
    updated_by = 'migration_combine_cse_sections'
WHERE semester = 3
  AND department = 'Computer Science & Engineering B'
  AND section_index IS NOT NULL;

UPDATE sessions
SET department = 'Computer Science & Engineering',
    raw_payload = raw_payload || jsonb_build_object('department', 'Computer Science & Engineering'),
    row_version = row_version + 1,
    updated_by = 'migration_combine_cse_sections'
WHERE semester = 3
  AND department = 'Computer Science & Engineering A';

UPDATE course_instances
SET department = 'Computer Science & Engineering'
WHERE semester = 3
  AND department IN ('Computer Science & Engineering A', 'Computer Science & Engineering B');

UPDATE student_groups
SET department = 'Computer Science & Engineering'
WHERE semester = 3
  AND department IN ('Computer Science & Engineering A', 'Computer Science & Engineering B');
