ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS source_course_instance_key TEXT,
  ADD COLUMN IF NOT EXISTS partner_course_instance_key TEXT,
  ADD COLUMN IF NOT EXISTS section_index INTEGER;

UPDATE sessions
SET source_course_instance_key = coalesce(source_course_instance_key, raw_payload->>'course_instance_id'),
    partner_course_instance_key = coalesce(partner_course_instance_key, raw_payload->>'partner_instance_id'),
    section_index = coalesce(
      section_index,
      CASE
        WHEN semester = 3
         AND coalesce(raw_payload->>'course_instance_id', '') ~ '__s[0-9]+$'
        THEN substring(raw_payload->>'course_instance_id' from '__s([0-9]+)$')::integer
        ELSE NULL
      END
    );

ALTER TABLE sessions
  DROP CONSTRAINT IF EXISTS sessions_section_index_nonnegative,
  ADD CONSTRAINT sessions_section_index_nonnegative CHECK (section_index IS NULL OR section_index >= 0);

CREATE INDEX IF NOT EXISTS idx_sessions_active_section_time
ON sessions (department, semester, section_index, day, start_minute, end_minute)
WHERE status = 'active' AND semester = 3 AND section_index IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_source_instance_key
ON sessions (source_course_instance_key)
WHERE source_course_instance_key IS NOT NULL;
