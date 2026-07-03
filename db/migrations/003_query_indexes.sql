CREATE INDEX IF NOT EXISTS idx_sessions_active_order
ON sessions (status, day, start_minute, department, course_code);

CREATE INDEX IF NOT EXISTS idx_sessions_active_group_time
ON sessions (group_name, day, start_minute, end_minute)
WHERE status = 'active' AND group_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_edit_requests_created_at
ON edit_requests (created_at DESC);
