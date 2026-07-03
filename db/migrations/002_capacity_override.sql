ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS allow_capacity_override BOOLEAN NOT NULL DEFAULT false;
