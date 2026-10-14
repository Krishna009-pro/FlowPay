CREATE TABLE claim_policies (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  id uuid NOT NULL,
  version text NOT NULL,
  minimum_claim_paise bigint NOT NULL CHECK (minimum_claim_paise > 0),
  maximum_claim_paise bigint NOT NULL CHECK (maximum_claim_paise >= minimum_claim_paise),
  maximum_daily_claims integer NOT NULL CHECK (maximum_daily_claims > 0),
  maximum_monthly_claims integer NOT NULL CHECK (maximum_monthly_claims >= maximum_daily_claims),
  auto_pay_maximum_paise bigint NOT NULL CHECK (auto_pay_maximum_paise >= minimum_claim_paise),
  status text NOT NULL CHECK (status IN ('pending_approval', 'approved', 'rejected', 'superseded')),
  prepared_by_wallet text NOT NULL CHECK (prepared_by_wallet ~ '^0x[0-9a-f]{40}$'),
  approved_by_wallet text CHECK (approved_by_wallet IS NULL OR approved_by_wallet ~ '^0x[0-9a-f]{40}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, version),
  CHECK (approved_by_wallet IS NULL OR approved_by_wallet <> prepared_by_wallet),
  CONSTRAINT claim_policy_approval_state_check
    CHECK ((status = 'pending_approval' AND approved_by_wallet IS NULL AND approved_at IS NULL)
      OR (status IN ('approved', 'superseded') AND approved_by_wallet IS NOT NULL AND approved_at IS NOT NULL)
      OR status = 'rejected'),
  CHECK (auto_pay_maximum_paise <= maximum_claim_paise)
);
CREATE UNIQUE INDEX one_approved_claim_policy_per_org
  ON claim_policies(organization_id) WHERE status = 'approved';

ALTER TABLE payout_recipient_references
  ADD CONSTRAINT payout_recipient_references_fake_only CHECK (provider_key = 'fake');

ALTER TABLE claims
  DROP CONSTRAINT claims_state_check,
  ADD CONSTRAINT claims_state_check CHECK (state IN (
    'awaiting_approval', 'queued', 'submitted', 'paid', 'failed', 'returned',
    'reversed', 'reconciliation_required', 'rejected'
  ));

ALTER TABLE claims
  ADD CONSTRAINT claims_wallet_address_format CHECK (
    (prepared_by_wallet IS NULL OR prepared_by_wallet ~ '^0x[0-9a-f]{40}$')
    AND (approved_by_wallet IS NULL OR approved_by_wallet ~ '^0x[0-9a-f]{40}$')
  );

CREATE INDEX claims_employee_state_time
  ON claims(organization_id, employee_id, state, created_at);
CREATE INDEX payout_attempts_claim_state
  ON payout_attempts(organization_id, claim_id, state);

ALTER TABLE employees
  DROP CONSTRAINT employees_status_check,
  ADD CONSTRAINT employees_status_check CHECK (status IN ('pending_approval', 'active', 'inactive', 'terminated')),
  ADD COLUMN prepared_by_wallet text CHECK (prepared_by_wallet IS NULL OR prepared_by_wallet ~ '^0x[0-9a-f]{40}$'),
  ADD COLUMN approved_by_wallet text CHECK (approved_by_wallet IS NULL OR approved_by_wallet ~ '^0x[0-9a-f]{40}$'),
  ADD CONSTRAINT employees_maker_checker CHECK (
    (status = 'pending_approval') = (approved_by_wallet IS NULL)
  ),
  ADD CONSTRAINT employees_distinct_maker_checker CHECK (
    approved_by_wallet IS NULL OR approved_by_wallet <> prepared_by_wallet
  );

CREATE TABLE employee_approvals (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  employee_id uuid NOT NULL,
  actor_wallet text NOT NULL CHECK (actor_wallet ~ '^0x[0-9a-f]{40}$'),
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, employee_id),
  FOREIGN KEY (organization_id, employee_id) REFERENCES employees(organization_id, id)
);

CREATE FUNCTION flowpay_protect_payroll_run_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.period_id IS DISTINCT FROM OLD.period_id
    OR NEW.rules_version IS DISTINCT FROM OLD.rules_version
    OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
    OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
    OR NEW.prepared_by_wallet IS DISTINCT FROM OLD.prepared_by_wallet
  THEN
    RAISE EXCEPTION 'payroll run snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payroll_run_snapshot_immutable
  BEFORE UPDATE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION flowpay_protect_payroll_run_snapshot();

CREATE FUNCTION flowpay_protect_compensation_term() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
    OR NEW.period_gross_paise IS DISTINCT FROM OLD.period_gross_paise
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.period_kind IS DISTINCT FROM OLD.period_kind
    OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
    OR NEW.effective_to IS DISTINCT FROM OLD.effective_to
    OR NEW.prepared_by_wallet IS DISTINCT FROM OLD.prepared_by_wallet
  THEN
    RAISE EXCEPTION 'compensation term values are immutable';
  END IF;
  IF OLD.status <> 'pending_approval' OR NEW.status <> 'approved' THEN
    RAISE EXCEPTION 'compensation term only permits pending to approved transition';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER compensation_term_protect_values
  BEFORE UPDATE ON compensation_terms
  FOR EACH ROW EXECUTE FUNCTION flowpay_protect_compensation_term();

CREATE FUNCTION flowpay_reject_membership_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'organization membership history is retained';
END;
$$;
CREATE TRIGGER organization_memberships_retain_history
  BEFORE DELETE ON organization_memberships
  FOR EACH ROW EXECUTE FUNCTION flowpay_reject_membership_delete();

CREATE FUNCTION flowpay_protect_employee_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.employee_ref IS DISTINCT FROM OLD.employee_ref
    OR NEW.display_name IS DISTINCT FROM OLD.display_name
    OR NEW.wallet_address IS DISTINCT FROM OLD.wallet_address
    OR NEW.hired_at IS DISTINCT FROM OLD.hired_at
    OR NEW.prepared_by_wallet IS DISTINCT FROM OLD.prepared_by_wallet
  THEN
    RAISE EXCEPTION 'employee change values are immutable';
  END IF;
  IF OLD.status <> 'pending_approval' OR NEW.status NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION 'employee only permits pending approval to active or inactive transition';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER employee_protect_change
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION flowpay_protect_employee_change();

CREATE FUNCTION flowpay_protect_claim_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.minimum_claim_paise IS DISTINCT FROM OLD.minimum_claim_paise
    OR NEW.maximum_claim_paise IS DISTINCT FROM OLD.maximum_claim_paise
    OR NEW.maximum_daily_claims IS DISTINCT FROM OLD.maximum_daily_claims
    OR NEW.maximum_monthly_claims IS DISTINCT FROM OLD.maximum_monthly_claims
    OR NEW.auto_pay_maximum_paise IS DISTINCT FROM OLD.auto_pay_maximum_paise
    OR NEW.prepared_by_wallet IS DISTINCT FROM OLD.prepared_by_wallet
  THEN
    RAISE EXCEPTION 'claim policy values are immutable';
  END IF;
  IF NOT ((OLD.status = 'pending_approval' AND NEW.status IN ('approved', 'rejected'))
    OR (OLD.status = 'approved' AND NEW.status = 'superseded')) THEN
    RAISE EXCEPTION 'invalid claim policy status transition';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER claim_policy_protect_values
  BEFORE UPDATE ON claim_policies
  FOR EACH ROW EXECUTE FUNCTION flowpay_protect_claim_policy();
