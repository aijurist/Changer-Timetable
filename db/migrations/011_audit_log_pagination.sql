CREATE INDEX IF NOT EXISTS idx_session_audit_log_edit_request
ON session_audit_log (edit_request_id, id);
