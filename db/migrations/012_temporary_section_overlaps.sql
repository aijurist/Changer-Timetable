CREATE TABLE IF NOT EXISTS temporary_section_overlaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_edit_request_id UUID NOT NULL UNIQUE REFERENCES edit_requests(id) ON DELETE CASCADE,
  session_ids BIGINT[] NOT NULL,
  conflict_session_ids BIGINT[] NOT NULL,
  expected_row_versions JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'resolved', 'reverted', 'failed')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  resolved_at TIMESTAMPTZ,
  reverted_at TIMESTAMPTZ,
  resolution_edit_request_id UUID REFERENCES edit_requests(id),
  failure_reason TEXT,
  CHECK (cardinality(session_ids) > 0),
  CHECK (cardinality(conflict_session_ids) > 0)
);

CREATE INDEX IF NOT EXISTS idx_temporary_section_overlaps_active_expiry
  ON temporary_section_overlaps (expires_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_temporary_section_overlaps_sessions
  ON temporary_section_overlaps USING GIN (session_ids);

CREATE INDEX IF NOT EXISTS idx_temporary_section_overlaps_conflicts
  ON temporary_section_overlaps USING GIN (conflict_session_ids);
