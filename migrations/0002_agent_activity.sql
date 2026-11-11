-- Successful authenticated agent operations; separate from exact message receipts.
-- Existing agents stay unknown until their next successful request.
ALTER TABLE actors ADD COLUMN last_active_at timestamptz;
