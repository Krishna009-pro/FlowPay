import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { buildApp } from '../src/app.js';
import { issueWalletChallenge, verifyWalletChallenge, resolveWalletSession, revokeWalletSession } from '../src/auth/challenges.js';

function memoryPool() {
  const challenges = new Map();
  const sessions = new Map();
  const client = {
    async query(sql, values = []) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (sql.includes('INSERT INTO wallet_challenges')) {
        challenges.set(values[0], { walletAddress: values[1], origin: values[2], expiresAt: new Date(values[3]), consumedAt: null });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('SELECT wallet_address, origin, expires_at, consumed_at FROM wallet_challenges')) {
        const value = challenges.get(values[0]);
        return { rows: value ? [{ wallet_address: value.walletAddress, origin: value.origin, expires_at: value.expiresAt, consumed_at: value.consumedAt }] : [], rowCount: value ? 1 : 0 };
      }
      if (sql.includes('UPDATE wallet_challenges SET consumed_at')) {
        const value = challenges.get(values[0]);
        if (!value || value.consumedAt) return { rows: [], rowCount: 0 };
        value.consumedAt = new Date(values[1]);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO wallet_sessions')) {
        sessions.set(values[0], { walletAddress: values[1], origin: values[2], expiresAt: new Date(values[3]), revokedAt: null });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('SELECT wallet_address, origin, expires_at FROM wallet_sessions')) {
        const value = sessions.get(values[0]);
        const valid = value && !value.revokedAt && value.expiresAt > new Date(values[1]);
        return { rows: valid ? [{ wallet_address: value.walletAddress, origin: value.origin, expires_at: value.expiresAt }] : [], rowCount: valid ? 1 : 0 };
      }
      if (sql.includes('UPDATE wallet_sessions SET revoked_at')) {
        const value = sessions.get(values[0]);
        if (!value || value.revokedAt) return { rows: [], rowCount: 0 };
        value.revokedAt = new Date(values[1]);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO organizations') || sql.includes('INSERT INTO organization_memberships') || sql.includes('INSERT INTO audit_events')) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM organization_memberships')) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {},
  };
  return { connect: async () => client, query: client.query, challenges, sessions };
}

const allowedOrigins = ['http://localhost:5173'];

test('issues an origin-bound challenge and consumes it once into a hashed session', async () => {
  const pool = memoryPool();
  const account = privateKeyToAccount(generatePrivateKey());
  const now = new Date('2026-10-13T10:00:00.000Z');
  const challenge = await issueWalletChallenge(pool, { walletAddress: account.address, origin: allowedOrigins[0], allowedOrigins, now });
  const signature = await account.signMessage({ message: challenge.message });
  const session = await verifyWalletChallenge(pool, { message: challenge.message, signature, origin: allowedOrigins[0], allowedOrigins, now });

  assert.equal(session.walletAddress, account.address.toLowerCase());
  assert.equal(session.token.length, 64);
  assert.equal(pool.sessions.has(session.token), false);
  assert.equal(pool.sessions.size, 1);
  assert.equal((await resolveWalletSession(pool, session.token, { now })).walletAddress, account.address.toLowerCase());
});

test('rejects origin changes, wrong signers, expired challenges, and replay', async () => {
  const pool = memoryPool();
  const account = privateKeyToAccount(generatePrivateKey());
  const other = privateKeyToAccount(generatePrivateKey());
  const now = new Date('2026-10-13T10:00:00.000Z');
  const challenge = await issueWalletChallenge(pool, { walletAddress: account.address, origin: allowedOrigins[0], allowedOrigins, now, ttlSeconds: 30 });
  const signature = await account.signMessage({ message: challenge.message });

  await assert.rejects(verifyWalletChallenge(pool, { message: challenge.message, signature, origin: 'http://evil.example', allowedOrigins, now }), /origin/);
  await assert.rejects(verifyWalletChallenge(pool, { message: challenge.message, signature: await other.signMessage({ message: challenge.message }), origin: allowedOrigins[0], allowedOrigins, now }), /signature/);
  await assert.rejects(verifyWalletChallenge(pool, { message: challenge.message, signature, origin: allowedOrigins[0], allowedOrigins, now: new Date(now.getTime() + 31_000) }), /expired|invalid/i);
  await verifyWalletChallenge(pool, { message: challenge.message, signature, origin: allowedOrigins[0], allowedOrigins, now });
  await assert.rejects(verifyWalletChallenge(pool, { message: challenge.message, signature, origin: allowedOrigins[0], allowedOrigins, now }), /expired|invalid|used/i);
});

test('rejects an unconfigured origin and supports revocable short-lived sessions', async () => {
  const pool = memoryPool();
  const account = privateKeyToAccount(generatePrivateKey());
  await assert.rejects(issueWalletChallenge(pool, { walletAddress: account.address, origin: 'https://attacker.example', allowedOrigins }), /origin/);

  const now = new Date('2026-10-13T10:00:00.000Z');
  const challenge = await issueWalletChallenge(pool, { walletAddress: account.address, origin: allowedOrigins[0], allowedOrigins, now });
  const signature = await account.signMessage({ message: challenge.message });
  const session = await verifyWalletChallenge(pool, { message: challenge.message, signature, origin: allowedOrigins[0], allowedOrigins, now });
  await revokeWalletSession(pool, session.token, { now });
  await assert.rejects(resolveWalletSession(pool, session.token, { now }), /invalid or expired/i);
  await assert.rejects(resolveWalletSession(pool, randomUUID(), { now }), /invalid or expired/i);
});

test('auth routes bind mutations to the allowed browser origin and issue HttpOnly cookies', async () => {
  const pool = memoryPool();
  const app = buildApp({ database: { ping: async () => {}, pool }, allowedOrigins, secureCookies: true });
  const account = privateKeyToAccount(generatePrivateKey());
  try {
    const denied = await app.inject({ method: 'POST', url: '/api/auth/challenge', headers: { origin: 'https://attacker.example' }, payload: { walletAddress: account.address } });
    assert.equal(denied.statusCode, 403);

    const challengeResponse = await app.inject({ method: 'POST', url: '/api/auth/challenge', headers: { origin: allowedOrigins[0] }, payload: { walletAddress: account.address } });
    assert.equal(challengeResponse.statusCode, 200);
    const { message } = challengeResponse.json();
    const signature = await account.signMessage({ message });
    const verifyResponse = await app.inject({ method: 'POST', url: '/api/auth/verify', headers: { origin: allowedOrigins[0] }, payload: { message, signature } });
    assert.equal(verifyResponse.statusCode, 200);
    assert.match(verifyResponse.headers['set-cookie'], /HttpOnly/);
    assert.match(verifyResponse.headers['set-cookie'], /SameSite=Strict/);
    assert.match(verifyResponse.headers['set-cookie'], /Secure/);

    const token = verifyResponse.headers['set-cookie'].match(/flowpay_session=([^;]+)/)[1];
    const sessionResponse = await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: `flowpay_session=${token}` } });
    assert.equal(sessionResponse.statusCode, 200);
    assert.equal(sessionResponse.json().walletAddress, account.address.toLowerCase());
    const organizationDenied = await app.inject({
      method: 'POST', url: '/api/organizations',
      headers: { origin: 'https://attacker.example', cookie: `flowpay_session=${token}` },
      payload: { legalName: 'Synthetic test employer' },
    });
    assert.equal(organizationDenied.statusCode, 403);
    const organizationResponse = await app.inject({
      method: 'POST', url: '/api/organizations',
      headers: { origin: allowedOrigins[0], cookie: `flowpay_session=${token}` },
      payload: { legalName: 'Synthetic test employer' },
    });
    assert.equal(organizationResponse.statusCode, 201, organizationResponse.body);
    assert.equal(organizationResponse.json().ownerWallet, account.address.toLowerCase());
    const logoutDenied = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { origin: 'https://attacker.example', cookie: `flowpay_session=${token}` } });
    assert.equal(logoutDenied.statusCode, 403);
    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { origin: allowedOrigins[0], cookie: `flowpay_session=${token}` } });
    assert.equal(logout.statusCode, 204);
    assert.match(logout.headers['set-cookie'], /Max-Age=0/);
  } finally {
    await app.close();
  }
});
