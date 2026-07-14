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
