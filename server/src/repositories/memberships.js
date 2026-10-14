import { randomUUID } from 'node:crypto';
import { withTransaction } from '../db/transaction.js';
import { normalizeWallet } from './organization.js';

const INVITABLE_ROLES = new Set(['payroll_operator', 'payroll_approver', 'payout_executor']);
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function validNow(value) {
  if (value === null || value === undefined || value === '') throw new TypeError('now must be a valid timestamp');
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('now must be a valid timestamp');
  return date;
}

async function requireOwner(client, organizationId, actor) {
  const result = await client.query(
    `SELECT 1 FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
     WHERE m.organization_id = $1 AND m.wallet_address = $2 AND m.status = 'active'
       AND o.status = 'active' AND m.role = 'owner' FOR SHARE`,
    [organizationId, actor],
  );
  if (result.rowCount !== 1) throw new Error('active organization owner membership required');
}

export async function createMemberInvitation(pool, {
  organizationId, actorWallet, inviteeWallet, role, requestId, now = new Date(),
}) {
  const actor = normalizeWallet(actorWallet);
  const invitee = normalizeWallet(inviteeWallet);
  const at = validNow(now);
  if (actor === invitee) throw new Error('owner cannot invite the same wallet as a second member');
  if (!INVITABLE_ROLES.has(role)) throw new TypeError('role is not available for invitation');
  if (typeof requestId !== 'string' || requestId.length === 0) throw new TypeError('requestId is required');
  const expiresAt = new Date(at.getTime() + INVITATION_TTL_MS);

  await withTransaction(pool, async (client) => {
    await requireOwner(client, organizationId, actor);
    const organization = await client.query(
      `SELECT id FROM organizations WHERE id = $1 AND status = 'active' FOR UPDATE`, [organizationId],
    );
    if (organization.rowCount !== 1) throw new Error('active organization not found');
    const existing = await client.query(
      `SELECT status, invitation_expires_at FROM organization_memberships
       WHERE organization_id = $1 AND wallet_address = $2 FOR UPDATE`,
      [organizationId, invitee],
    );
    if (existing.rows[0]?.status === 'active') throw new Error('wallet is already an active organization member');
    if (existing.rows[0]?.status === 'revoked') throw new Error('revoked membership cannot be re-invited');
    if (existing.rows[0]?.status === 'invited' && new Date(existing.rows[0].invitation_expires_at) > at) {
      throw new Error('wallet already has a pending organization invitation');
    }

    if (existing.rows[0]) {
      await client.query(
        `UPDATE organization_memberships
         SET role = $3, invited_by_wallet = $4, invitation_expires_at = $5, effective_at = $6
         WHERE organization_id = $1 AND wallet_address = $2 AND status = 'invited'`,
        [organizationId, invitee, role, actor, expiresAt, at],
      );
    } else {
      await client.query(
        `INSERT INTO organization_memberships
         (organization_id, wallet_address, role, status, invited_by_wallet, effective_at, invitation_expires_at)
         VALUES ($1, $2, $3, 'invited', $4, $5, $6)`,
        [organizationId, invitee, role, actor, at, expiresAt],
      );
    }
    await client.query(
      `INSERT INTO audit_events (organization_id, id, actor_wallet, action, target_type, target_id, request_id)
       VALUES ($1, $2, $3, 'organization_member.invited', 'organization_member', $4, $5)`,
      [organizationId, randomUUID(), actor, invitee, requestId],
    );
  });
  return { organizationId, walletAddress: invitee, role, status: 'invited', expiresAt: expiresAt.toISOString() };
}

export async function acceptMemberInvitation(pool, { organizationId, walletAddress, requestId, now = new Date() }) {
  const wallet = normalizeWallet(walletAddress);
  const at = validNow(now);
  if (typeof requestId !== 'string' || requestId.length === 0) throw new TypeError('requestId is required');
  let membership;
  await withTransaction(pool, async (client) => {
    const found = await client.query(
      `SELECT m.role, m.status, m.invitation_expires_at FROM organization_memberships m
       JOIN organizations o ON o.id = m.organization_id
       WHERE m.organization_id = $1 AND m.wallet_address = $2 AND o.status = 'active' FOR UPDATE OF m`,
      [organizationId, wallet],
    );
    const invitation = found.rows[0];
    if (!invitation || invitation.status !== 'invited') throw new Error('pending invitation for this wallet not found');
    if (validNow(invitation.invitation_expires_at) <= at) throw new Error('organization invitation has expired');
    const updated = await client.query(
      `UPDATE organization_memberships SET status = 'active', effective_at = $3, invitation_expires_at = NULL
       WHERE organization_id = $1 AND wallet_address = $2 AND status = 'invited'`,
      [organizationId, wallet, at],
    );
    if (updated.rowCount !== 1) throw new Error('organization invitation changed before acceptance');
    await client.query(
      `INSERT INTO audit_events (organization_id, id, actor_wallet, action, target_type, target_id, request_id)
       VALUES ($1, $2, $3, 'organization_member.accepted', 'organization_member', $4, $5)`,
      [organizationId, randomUUID(), wallet, wallet, requestId],
    );
    membership = { organizationId, walletAddress: wallet, role: invitation.role, status: 'active' };
  });
  return membership;
}

export async function revokeMember(pool, { organizationId, targetWallet, actorWallet, requestId, now = new Date() }) {
  const actor = normalizeWallet(actorWallet);
  const target = normalizeWallet(targetWallet);
  const at = validNow(now);
  if (typeof requestId !== 'string' || requestId.length === 0) throw new TypeError('requestId is required');
  if (actor === target) throw new Error('owner cannot revoke their own organization membership');
  let result;
  await withTransaction(pool, async (client) => {
    await requireOwner(client, organizationId, actor);
    const member = await client.query(
      `SELECT role, status FROM organization_memberships
       WHERE organization_id = $1 AND wallet_address = $2 FOR UPDATE`, [organizationId, target],
    );
    if (!member.rows[0] || member.rows[0].status === 'revoked' || member.rows[0].role === 'owner') {
      throw new Error('revocable organization member not found');
    }
    const updated = await client.query(
      `UPDATE organization_memberships
       SET status = 'revoked', revoked_at = $3, invitation_expires_at = NULL
       WHERE organization_id = $1 AND wallet_address = $2 AND status IN ('invited', 'active')`,
      [organizationId, target, at],
    );
    if (updated.rowCount !== 1) throw new Error('organization membership changed before revocation');
    await client.query(
      `INSERT INTO audit_events (organization_id, id, actor_wallet, action, target_type, target_id, request_id)
       VALUES ($1, $2, $3, 'organization_member.revoked', 'organization_member', $4, $5)`,
      [organizationId, randomUUID(), actor, target, requestId],
    );
    result = { organizationId, walletAddress: target, role: member.rows[0].role, status: 'revoked' };
  });
  return result;
}

export async function listOrganizationMembers(pool, { organizationId, actorWallet }) {
  const actor = normalizeWallet(actorWallet);
  const access = await pool.query(
    `SELECT 1 FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
     WHERE m.organization_id = $1 AND m.wallet_address = $2 AND m.status = 'active'
       AND o.status = 'active' AND m.role = 'owner'`, [organizationId, actor],
  );
  if (access.rowCount !== 1) throw new Error('active organization owner membership required');
  const result = await pool.query(
    `SELECT wallet_address AS "walletAddress", role, status, effective_at AS "effectiveAt",
            invitation_expires_at AS "invitationExpiresAt", revoked_at AS "revokedAt"
     FROM organization_memberships WHERE organization_id = $1 ORDER BY created_at, wallet_address`,
    [organizationId],
  );
  return result.rows;
}
