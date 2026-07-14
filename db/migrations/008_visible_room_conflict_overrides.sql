ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS room_conflict_override BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_sessions_visible_room_conflicts
  ON sessions (room_id, day, start_minute, end_minute)
  WHERE status = 'active' AND room_conflict_override = true;
