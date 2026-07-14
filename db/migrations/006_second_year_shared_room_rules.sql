UPDATE rooms
SET allow_conflicts = true
WHERE upper(room_number) IN (
  'A104/105', 'ANEW101', 'ANEW102', 'ANEW103', 'ANEW104', 'KS02', 'KSL02'
);

UPDATE sessions s
SET allow_room_conflicts = true
FROM rooms r
WHERE s.room_id = r.id
  AND s.allow_room_conflicts = false
  AND upper(r.room_number) IN (
    'A104/105', 'ANEW101', 'ANEW102', 'ANEW103', 'ANEW104', 'KS02', 'KSL02'
  );

CREATE OR REPLACE FUNCTION is_approved_sem3_dbms_oops_overlap(
  left_semester INTEGER,
  right_semester INTEGER,
  left_department TEXT,
  right_department TEXT,
  left_section INTEGER,
  right_section INTEGER,
  left_course_code TEXT,
  right_course_code TEXT
)
RETURNS BOOLEAN AS $$
  SELECT
    left_semester = 3
    AND right_semester = 3
    AND left_department = right_department
    AND left_section IS NOT NULL
    AND right_section IS NOT NULL
    AND left_section <> right_section
    AND ARRAY[upper(coalesce(left_course_code, '')), upper(coalesce(right_course_code, ''))]
        @> ARRAY['CS23332', 'CS23333']::text[];
$$ LANGUAGE SQL IMMUTABLE;

CREATE OR REPLACE FUNCTION guard_session_conflicts()
RETURNS TRIGGER AS $$
DECLARE
  conflict_id BIGINT;
BEGIN
  IF current_setting('app.seed_mode', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  SELECT s.id INTO conflict_id
  FROM sessions s
  WHERE s.id <> coalesce(NEW.id, 0)
    AND s.status = 'active'
    AND s.teacher_id = NEW.teacher_id
    AND s.day = NEW.day
    AND int4range(s.start_minute, s.end_minute, '[)') && int4range(NEW.start_minute, NEW.end_minute, '[)')
    AND NOT is_approved_sem3_dbms_oops_overlap(
      NEW.semester, s.semester, NEW.department, s.department,
      NEW.section_index, s.section_index, NEW.course_code, s.course_code
    )
  LIMIT 1;

  IF conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'teacher_conflict: conflicting session %', conflict_id
      USING ERRCODE = '23P01';
  END IF;

  IF NOT NEW.allow_room_conflicts THEN
    SELECT s.id INTO conflict_id
    FROM sessions s
    WHERE s.id <> coalesce(NEW.id, 0)
      AND s.status = 'active'
      AND s.room_id = NEW.room_id
      AND s.day = NEW.day
      AND s.allow_room_conflicts = false
      AND int4range(s.start_minute, s.end_minute, '[)') && int4range(NEW.start_minute, NEW.end_minute, '[)')
      AND NOT is_approved_sem3_dbms_oops_overlap(
        NEW.semester, s.semester, NEW.department, s.department,
        NEW.section_index, s.section_index, NEW.course_code, s.course_code
      )
      AND NOT (
        NEW.semester = 3
        AND s.semester = 3
        AND NEW.department = s.department
        AND NEW.section_index = s.section_index
        AND NEW.section_index IS NOT NULL
        AND NEW.is_co_scheduled = true
        AND s.is_co_scheduled = true
        AND NEW.source_course_instance_key = s.partner_course_instance_key
        AND NEW.partner_course_instance_key = s.source_course_instance_key
      )
    LIMIT 1;

    IF conflict_id IS NOT NULL THEN
      RAISE EXCEPTION 'room_conflict: conflicting session %', conflict_id
        USING ERRCODE = '23P01';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
