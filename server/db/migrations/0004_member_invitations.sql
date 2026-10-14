ALTER TABLE organization_memberships
  ADD COLUMN invitation_expires_at timestamptz,
  ADD CONSTRAINT organization_membership_invitation_state_check CHECK (
    (status = 'invited' AND invitation_expires_at IS NOT NULL)
    OR (status = 'active' AND invitation_expires_at IS NULL)
    OR (status = 'revoked' AND invitation_expires_at IS NULL)
  );

CREATE INDEX organization_invitation_expiry
  ON organization_memberships(organization_id, invitation_expires_at)
  WHERE status = 'invited';
