import { randomUUID } from 'node:crypto';
import { withTransaction } from '../db/transaction.js';

const WALLET_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

function normalizeWallet(walletAddress) {
  if (typeof walletAddress !== 'string' || !WALLET_ADDRESS.test(walletAddress)) {
    throw new TypeError('walletAddress must be a valid EVM address');
  }
  return walletAddress.toLowerCase();
}

export async function createOrganization(pool, { legalName, ownerWallet, requestId }) {
  if (typeof legalName !== 'string' || legalName.trim().length === 0) throw new TypeError('legalName is required');
  if (typeof requestId !== 'string' || requestId.length === 0) throw new TypeError('requestId is required');
  const wallet = normalizeWallet(ownerWallet);
  const organizationId = randomUUID();

  await withTransaction(pool, async (client) => {
    await client.query(
      'INSERT INTO organizations (id, legal_name) VALUES ($1, $2)',
      [organizationId, legalName.trim()],
    );
    await client.query(
      `INSERT INTO organization_memberships (organization_id, wallet_address, role, status)
       VALUES ($1, $2, 'owner', 'active')`,
      [organizationId, wallet],
    );
    await client.query(
      `INSERT INTO audit_events
       (organization_id, id, actor_wallet, action, target_type, target_id, request_id)
       VALUES ($1, $2, $3, 'organization.created', 'organization', $1, $4)`,
      [organizationId, randomUUID(), wallet, requestId],
    );
  });

  return { id: organizationId, legalName: legalName.trim(), ownerWallet: wallet };
}

export async function getOrganizationAccess(pool, { organizationId, walletAddress }) {
  const wallet = normalizeWallet(walletAddress);
  const result = await pool.query(
    `SELECT o.id, o.legal_name AS "legalName", o.status, o.payroll_timezone AS "payrollTimezone", m.role
     FROM organizations o
     JOIN organization_memberships m ON m.organization_id = o.id
     WHERE o.id = $1 AND m.wallet_address = $2 AND m.status = 'active' AND o.status = 'active'`,
    [organizationId, wallet],
  );
  return result.rows[0] ?? null;
}

export { normalizeWallet };
