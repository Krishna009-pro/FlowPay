ALTER TABLE payout_outbox
  ADD COLUMN locked_by text,
  ADD COLUMN lease_expires_at timestamptz;

ALTER TABLE payout_attempts
  DROP CONSTRAINT payout_attempts_state_check,
  ADD CONSTRAINT payout_attempts_state_check CHECK (state IN (
    'queued', 'submitted', 'paid', 'failed', 'returned', 'reversed', 'reconciliation_required'
  ));

CREATE INDEX payout_outbox_lease_recovery
  ON payout_outbox(lease_expires_at, id) WHERE state = 'processing';
