CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  legal_name text NOT NULL CHECK (length(trim(legal_name)) > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  payroll_timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  role text NOT NULL CHECK (role IN ('owner', 'payroll_operator', 'payroll_approver', 'payout_executor')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'revoked')),
  invited_by_wallet text CHECK (invited_by_wallet IS NULL OR invited_by_wallet ~ '^0x[0-9a-f]{40}$'),
  effective_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, wallet_address),
  FOREIGN KEY (organization_id, invited_by_wallet)
    REFERENCES organization_memberships(organization_id, wallet_address),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX one_active_owner_per_organization
  ON organization_memberships(organization_id) WHERE role = 'owner' AND status = 'active';
CREATE INDEX active_membership_wallet_lookup
  ON organization_memberships(wallet_address, organization_id) WHERE status = 'active';

CREATE TABLE employees (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  id uuid NOT NULL,
  employee_ref text NOT NULL,
  display_name text NOT NULL CHECK (length(trim(display_name)) > 0),
  wallet_address text CHECK (wallet_address IS NULL OR wallet_address ~ '^0x[0-9a-f]{40}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'terminated')),
  hired_at date,
  terminated_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, employee_ref),
  CHECK (terminated_at IS NULL OR hired_at IS NULL OR terminated_at >= hired_at)
);
CREATE UNIQUE INDEX employee_wallet_unique_per_org
  ON employees(organization_id, wallet_address) WHERE wallet_address IS NOT NULL;

CREATE TABLE payout_recipient_references (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  employee_id uuid NOT NULL,
  provider_key text NOT NULL,
  provider_recipient_ref text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'verified', 'suspended', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, employee_id, provider_key),
  FOREIGN KEY (organization_id, employee_id) REFERENCES employees(organization_id, id)
);

CREATE TABLE compensation_terms (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  employee_id uuid NOT NULL,
  period_gross_paise bigint NOT NULL CHECK (period_gross_paise >= 0),
  currency char(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  period_kind text NOT NULL CHECK (period_kind IN ('monthly', 'weekly', 'daily', 'custom')),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  status text NOT NULL CHECK (status IN ('pending_approval', 'approved', 'rejected', 'superseded')),
  prepared_by_wallet text NOT NULL CHECK (prepared_by_wallet ~ '^0x[0-9a-f]{40}$'),
  approved_by_wallet text CHECK (approved_by_wallet IS NULL OR approved_by_wallet ~ '^0x[0-9a-f]{40}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, employee_id) REFERENCES employees(organization_id, id),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK (approved_by_wallet IS NULL OR approved_by_wallet <> prepared_by_wallet)
);
CREATE INDEX compensation_effective_lookup
  ON compensation_terms(organization_id, employee_id, effective_from DESC);

CREATE TABLE payroll_periods (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, starts_at, ends_at),
  CHECK (ends_at > starts_at)
);

CREATE TABLE payroll_runs (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  period_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('preview', 'pending_approval', 'approved', 'rejected', 'closed')),
  rules_version text NOT NULL,
  snapshot jsonb NOT NULL,
  snapshot_hash char(64) NOT NULL,
  prepared_by_wallet text NOT NULL CHECK (prepared_by_wallet ~ '^0x[0-9a-f]{40}$'),
  approved_by_wallet text CHECK (approved_by_wallet IS NULL OR approved_by_wallet ~ '^0x[0-9a-f]{40}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, period_id) REFERENCES payroll_periods(organization_id, id),
  CHECK (approved_by_wallet IS NULL OR approved_by_wallet <> prepared_by_wallet),
  CHECK ((status IN ('approved', 'closed')) = (approved_by_wallet IS NOT NULL))
);

CREATE TABLE payroll_approvals (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  run_id uuid NOT NULL,
  snapshot_hash char(64) NOT NULL,
  actor_wallet text NOT NULL CHECK (actor_wallet ~ '^0x[0-9a-f]{40}$'),
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, run_id, snapshot_hash),
  FOREIGN KEY (organization_id, run_id) REFERENCES payroll_runs(organization_id, id)
);

CREATE TABLE earning_ledger_entries (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  employee_id uuid NOT NULL,
  period_id uuid NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('accrual', 'adjustment', 'reservation', 'reservation_release', 'claim_paid', 'reversal')),
  amount_paise bigint NOT NULL CHECK (amount_paise <> 0),
  currency char(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  idempotency_key text NOT NULL,
  effective_at timestamptz NOT NULL,
  source_ref text,
  linked_entry_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, idempotency_key),
  FOREIGN KEY (organization_id, employee_id) REFERENCES employees(organization_id, id),
  FOREIGN KEY (organization_id, period_id) REFERENCES payroll_periods(organization_id, id),
  FOREIGN KEY (organization_id, linked_entry_id) REFERENCES earning_ledger_entries(organization_id, id),
  CHECK (entry_type = 'adjustment' OR amount_paise > 0)
);
CREATE INDEX earning_ledger_employee_period
  ON earning_ledger_entries(organization_id, employee_id, period_id, effective_at, id);

CREATE TABLE claims (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  employee_id uuid NOT NULL,
  period_id uuid NOT NULL,
  requested_paise bigint NOT NULL CHECK (requested_paise > 0),
  reserved_paise bigint NOT NULL CHECK (reserved_paise >= 0),
  policy_version text NOT NULL,
  state text NOT NULL CHECK (state IN ('awaiting_approval', 'queued', 'submitted', 'paid', 'failed', 'returned', 'reversed', 'reconciliation_required')),
  idempotency_key text NOT NULL,
  auto_approval_reason text,
  prepared_by_wallet text,
  approved_by_wallet text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, employee_id, idempotency_key),
  FOREIGN KEY (organization_id, employee_id) REFERENCES employees(organization_id, id),
  FOREIGN KEY (organization_id, period_id) REFERENCES payroll_periods(organization_id, id),
  CHECK (reserved_paise <= requested_paise),
  CHECK (approved_by_wallet IS NULL OR approved_by_wallet <> prepared_by_wallet)
);

CREATE TABLE payout_attempts (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  claim_id uuid NOT NULL,
  provider_key text NOT NULL CHECK (provider_key = 'fake'),
  provider_idempotency_key text NOT NULL,
  provider_reference text,
  state text NOT NULL CHECK (state IN ('queued', 'submitted', 'paid', 'failed', 'returned', 'reconciliation_required')),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, provider_idempotency_key),
  UNIQUE (organization_id, claim_id, attempt_number),
  FOREIGN KEY (organization_id, claim_id) REFERENCES claims(organization_id, id)
);

CREATE TABLE payout_outbox (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  command_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'processing', 'completed', 'held', 'failed')),
  available_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (organization_id, claim_id) REFERENCES claims(organization_id, id)
);
CREATE INDEX payout_outbox_pending ON payout_outbox(available_at, id) WHERE state IN ('pending', 'held');

CREATE TABLE wallet_challenges (
  challenge_hash char(64) PRIMARY KEY,
  wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  origin text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wallet_sessions (
  token_hash char(64) PRIMARY KEY,
  wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  origin text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  id uuid NOT NULL,
  actor_wallet text NOT NULL CHECK (actor_wallet ~ '^0x[0-9a-f]{40}$'),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  request_id text NOT NULL,
  snapshot_ref text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id)
);

CREATE FUNCTION flowpay_reject_append_only_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER earning_ledger_append_only
  BEFORE UPDATE OR DELETE ON earning_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION flowpay_reject_append_only_mutation();
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION flowpay_reject_append_only_mutation();
