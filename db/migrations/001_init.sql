CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS working_days (
  day TEXT PRIMARY KEY,
  day_order INTEGER NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS time_slots (
  id BIGSERIAL PRIMARY KEY,
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('theory', 'lab')),
  slot_key TEXT NOT NULL,
  label TEXT NOT NULL,
  slot_index INTEGER,
  start_minute INTEGER NOT NULL CHECK (start_minute >= 0 AND start_minute < 1440),
  end_minute INTEGER NOT NULL CHECK (end_minute > 0 AND end_minute <= 1440),
  source TEXT NOT NULL DEFAULT 'scheduler_yaml',
  UNIQUE (schedule_type, slot_key),
  CHECK (start_minute < end_minute)
);

CREATE TABLE IF NOT EXISTS lab_session_parts (
  session_name TEXT NOT NULL,
  part_index INTEGER NOT NULL,
  label TEXT NOT NULL,
  start_minute INTEGER NOT NULL,
  end_minute INTEGER NOT NULL,
  PRIMARY KEY (session_name, part_index),
  CHECK (start_minute < end_minute)
);

CREATE TABLE IF NOT EXISTS shift_templates (
  shift_id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  theory_slot_indexes INTEGER[] NOT NULL DEFAULT '{}',
  lab_sessions TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS department_policies (
  department TEXT PRIMARY KEY,
  day_pattern TEXT[] NOT NULL,
  lunch_break_slot INTEGER,
  lunch_slot_window INTEGER[] NOT NULL DEFAULT '{}',
  shift_id TEXT REFERENCES shift_templates(shift_id),
  flexible_lunch BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'scheduler_yaml'
);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY,
  room_number TEXT NOT NULL UNIQUE,
  block TEXT,
  description TEXT,
  is_lab BOOLEAN NOT NULL DEFAULT false,
  room_type TEXT,
  min_capacity INTEGER,
  max_capacity INTEGER,
  has_projector BOOLEAN NOT NULL DEFAULT false,
  has_ac BOOLEAN NOT NULL DEFAULT false,
  tech_level TEXT,
  maintained_by_id TEXT,
  green_board BOOLEAN NOT NULL DEFAULT false,
  lcs_available BOOLEAN NOT NULL DEFAULT false,
  smart_board BOOLEAN NOT NULL DEFAULT false,
  allow_conflicts BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'rooms_new.csv',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  staff_code TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS course_instances (
  id BIGINT PRIMARY KEY,
  course_code TEXT,
  course_name TEXT,
  department TEXT,
  semester INTEGER,
  lecture_hours NUMERIC,
  tutorial_hours NUMERIC,
  practical_hours NUMERIC,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS student_groups (
  name TEXT PRIMARY KEY,
  department TEXT,
  semester INTEGER,
  group_index INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id BIGSERIAL PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('theory', 'lab')),
  source_file TEXT NOT NULL,
  source_index INTEGER NOT NULL,
  course_instance_id BIGINT REFERENCES course_instances(id),
  course_code TEXT,
  course_code_display TEXT,
  course_name TEXT,
  session_type TEXT,
  session_number INTEGER,
  practical_hours NUMERIC,
  lecture_hours NUMERIC,
  tutorial_hours NUMERIC,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id),
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  day TEXT NOT NULL,
  slot_key TEXT NOT NULL,
  slot_index INTEGER,
  session_name TEXT,
  time_label TEXT NOT NULL,
  start_minute INTEGER NOT NULL,
  end_minute INTEGER NOT NULL,
  student_count INTEGER,
  total_students INTEGER,
  capacity INTEGER,
  is_batched BOOLEAN NOT NULL DEFAULT false,
  batch_info TEXT,
  num_batches INTEGER,
  batch_number INTEGER,
  batch_label TEXT,
  group_name TEXT REFERENCES student_groups(name),
  group_index INTEGER,
  department TEXT,
  semester INTEGER,
  day_pattern TEXT,
  is_co_scheduled BOOLEAN NOT NULL DEFAULT false,
  co_schedule_id TEXT,
  co_schedule_group_size INTEGER,
  co_schedule_partner_teachers TEXT,
  co_schedule_info TEXT,
  partner_instance_id BIGINT,
  partner_group TEXT,
  capacity_info TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  allow_room_conflicts BOOLEAN NOT NULL DEFAULT false,
  allow_capacity_override BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  CHECK (start_minute < end_minute)
);

CREATE TABLE IF NOT EXISTS edit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id BIGINT REFERENCES sessions(id),
  requested_by TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected', 'failed')),
  payload JSONB NOT NULL,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS session_audit_log (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES sessions(id),
  edit_request_id UUID REFERENCES edit_requests(id),
  changed_by TEXT,
  before_payload JSONB NOT NULL,
  after_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_lookup ON sessions (schedule_type, day, start_minute, end_minute);
CREATE INDEX IF NOT EXISTS idx_sessions_room_time ON sessions (room_id, day, start_minute, end_minute) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_sessions_teacher_time ON sessions (teacher_id, day, start_minute, end_minute) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_sessions_department ON sessions (department, semester, group_name);
CREATE INDEX IF NOT EXISTS idx_sessions_active_order ON sessions (status, day, start_minute, department, course_code);
CREATE INDEX IF NOT EXISTS idx_sessions_active_group_time ON sessions (group_name, day, start_minute, end_minute)
  WHERE status = 'active' AND group_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_search ON sessions USING gin (
  to_tsvector(
    'simple',
    coalesce(course_code, '') || ' ' ||
    coalesce(course_name, '') || ' ' ||
    coalesce(department, '') || ' ' ||
    coalesce(group_name, '')
  )
);
CREATE INDEX IF NOT EXISTS idx_edit_requests_created_at ON edit_requests (created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sessions_set_updated_at ON sessions;
CREATE TRIGGER sessions_set_updated_at
BEFORE UPDATE ON sessions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS rooms_set_updated_at ON rooms;
CREATE TRIGGER rooms_set_updated_at
BEFORE UPDATE ON rooms
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS teachers_set_updated_at ON teachers;
CREATE TRIGGER teachers_set_updated_at
BEFORE UPDATE ON teachers
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

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
    LIMIT 1;

    IF conflict_id IS NOT NULL THEN
      RAISE EXCEPTION 'room_conflict: conflicting session %', conflict_id
        USING ERRCODE = '23P01';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sessions_conflict_guard ON sessions;
CREATE TRIGGER sessions_conflict_guard
BEFORE INSERT OR UPDATE OF teacher_id, room_id, day, start_minute, end_minute, status, allow_room_conflicts
ON sessions
FOR EACH ROW
EXECUTE FUNCTION guard_session_conflicts();
