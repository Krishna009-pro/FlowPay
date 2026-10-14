import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptMemberInvitation, createMemberInvitation, revokeMember } from '../src/repositories/memberships.js';

const ORG = '9f8fe30a-a367-4f88-a385-ed6724fc8311';
const OWNER = `0x${'1'.repeat(40)}`;
const MEMBER = `0x${'2'.repeat(40)}`;
const NOW = new Date('2026-10-14T00:00:00Z');

function mockPool({ existing = null, invitation = { role: 'payroll_approver', status: 'invited', invitation_expires_at: '2026-10-20T00:00:00Z' }, member = { role: 'payroll_operator', status: 'active' } } = {}) {
  const queries = [];
  const client = { async query(sql, values = []) {
    const text = sql.replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rows: [], rowCount: 0 };
    if (text.startsWith('SELECT 1 FROM organization_memberships')) return { rows: [{ ok: 1 }], rowCount: 1 };
    if (text.startsWith('SELECT id FROM organizations')) return { rows: [{ id: ORG }], rowCount: 1 };
    if (text.includes('SELECT status, invitation_expires_at')) return { rows: existing ? [existing] : [], rowCount: existing ? 1 : 0 };
    if (text.includes('SELECT m.role, m.status, m.invitation_expires_at')) return { rows: invitation ? [invitation] : [], rowCount: invitation ? 1 : 0 };
    if (text.includes('SELECT role, status FROM organization_memberships')) return { rows: member ? [member] : [], rowCount: member ? 1 : 0 };
    if (text.startsWith('UPDATE organization_memberships')) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  }, release() {} };
  return { pool: { connect: async () => client }, queries };
}

test('owner invitations bind role to an explicit wallet and expire after seven days', async () => {
  const { pool, queries } = mockPool();
  const result = await createMemberInvitation(pool, {
    organizationId: ORG, actorWallet: OWNER, inviteeWallet: MEMBER, role: 'payroll_approver', requestId: 'invite-1', now: NOW,
  });
  assert.equal(result.status, 'invited');
  assert.equal(result.expiresAt, new Date(NOW.getTime() + 7 * 86400_000).toISOString());
  const insert = queries.find(({ text }) => text.startsWith('INSERT INTO organization_memberships'));
  assert.deepEqual(insert.values.slice(0, 4), [ORG, MEMBER, 'payroll_approver', OWNER]);
  await assert.rejects(createMemberInvitation(pool, {
    organizationId: ORG, actorWallet: OWNER, inviteeWallet: MEMBER, role: 'owner', requestId: 'invite-owner', now: NOW,
  }), /not available/);
});

test('invitation acceptance is bound to the authenticated wallet and rejects expired invitations', async () => {
  const { pool, queries } = mockPool();
  const accepted = await acceptMemberInvitation(pool, { organizationId: ORG, walletAddress: MEMBER, requestId: 'accept-1', now: NOW });
  assert.equal(accepted.walletAddress, MEMBER);
  assert.equal(accepted.role, 'payroll_approver');
  assert.ok(queries.some(({ text }) => text.includes("status = 'active'")));
  await assert.rejects(acceptMemberInvitation(mockPool({ invitation: { ...accepted, status: 'invited', invitation_expires_at: '2026-10-13T23:00:00Z' } }).pool, {
    organizationId: ORG, walletAddress: MEMBER, requestId: 'accept-expired', now: NOW,
  }), /expired/);
});

test('owner can revoke another member but cannot revoke self or another owner', async () => {
  const { pool, queries } = mockPool();
  const result = await revokeMember(pool, { organizationId: ORG, targetWallet: MEMBER, actorWallet: OWNER, requestId: 'revoke-1', now: NOW });
  assert.equal(result.status, 'revoked');
  assert.ok(queries.some(({ text }) => text.includes("status = 'revoked'")));
  await assert.rejects(revokeMember(pool, { organizationId: ORG, targetWallet: OWNER, actorWallet: OWNER, requestId: 'revoke-self', now: NOW }), /cannot revoke their own/);
  await assert.rejects(revokeMember(mockPool({ member: { role: 'owner', status: 'active' } }).pool, {
    organizationId: ORG, targetWallet: MEMBER, actorWallet: OWNER, requestId: 'revoke-owner', now: NOW,
  }), /not found/);
});
