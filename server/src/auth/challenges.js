import { createHash, randomBytes } from 'node:crypto';
import { recoverMessageAddress } from 'viem';
import { withTransaction } from '../db/transaction.js';
import { normalizeWallet } from '../repositories/organization.js';

const DEFAULT_CHALLENGE_TTL_SECONDS = 300;
const DEFAULT_SESSION_TTL_SECONDS = 900;
const TOKEN = /^[a-f0-9]{64}$/;

function asDate(value, label) {
  const result = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(result.getTime())) throw new TypeError(`${label} must be a valid date`);
  return result;
}

function validateOrigin(origin, allowedOrigins) {
  if (typeof origin !== 'string' || !Array.isArray(allowedOrigins) || !allowedOrigins.includes(origin)) {
    throw new Error('request origin is not allowed');
  }
  let parsed;
  try { parsed = new URL(origin); } catch { throw new Error('request origin is invalid'); }
  if (parsed.origin !== origin || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('request origin is invalid');
  }
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(isLocal && parsed.protocol === 'http:')) {
    throw new Error('request origin must use HTTPS');
  }
  return parsed;
}

function boundedTtl(value, defaultValue, maximum, label) {
  const ttl = value ?? defaultValue;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > maximum) throw new RangeError(`${label} is outside the allowed range`);
  return ttl;
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function issueWalletChallenge(pool, {
  walletAddress,
  origin,
  allowedOrigins,
  now = new Date(),
  ttlSeconds,
}) {
  const wallet = normalizeWallet(walletAddress);
  const parsedOrigin = validateOrigin(origin, allowedOrigins);
  const issuedAt = asDate(now, 'now');
  const ttl = boundedTtl(ttlSeconds, DEFAULT_CHALLENGE_TTL_SECONDS, 600, 'challenge TTL');
  const expiresAt = new Date(issuedAt.getTime() + ttl * 1000);
  const nonce = randomBytes(16).toString('hex');
  const message = [
    'FlowPay wallet sign-in',
    '',
    `Domain: ${parsedOrigin.host}`,
    `Address: ${wallet}`,
    `URI: ${parsedOrigin.origin}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');

  await pool.query(
    `INSERT INTO wallet_challenges (challenge_hash, wallet_address, origin, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [hash(message), wallet, parsedOrigin.origin, expiresAt],
  );
  return { message, expiresAt: expiresAt.toISOString() };
}

export async function verifyWalletChallenge(pool, {
  message,
  signature,
  origin,
  allowedOrigins,
  now = new Date(),
  sessionTtlSeconds,
}) {
  if (typeof message !== 'string' || message.length < 80 || message.length > 2048) {
    throw new Error('invalid or expired wallet challenge');
  }
  const parsedOrigin = validateOrigin(origin, allowedOrigins);
  const verifiedAt = asDate(now, 'now');
  const sessionTtl = boundedTtl(sessionTtlSeconds, DEFAULT_SESSION_TTL_SECONDS, 3600, 'session TTL');
  const challengeHash = hash(message);
  const sessionToken = randomBytes(32).toString('hex');
  const sessionTokenHash = hash(sessionToken);
  let wallet;
  const expiresAt = new Date(verifiedAt.getTime() + sessionTtl * 1000);

  await withTransaction(pool, async (client) => {
    const result = await client.query(
      `SELECT wallet_address, origin, expires_at, consumed_at FROM wallet_challenges
       WHERE challenge_hash = $1 FOR UPDATE`,
      [challengeHash],
    );
    const challenge = result.rows[0];
    if (!challenge || challenge.consumed_at || new Date(challenge.expires_at) <= verifiedAt) {
      throw new Error('invalid or expired wallet challenge');
    }
    if (challenge.origin !== parsedOrigin.origin) throw new Error('wallet challenge origin does not match');

    try {
      const recovered = normalizeWallet(await recoverMessageAddress({ message, signature }));
      wallet = normalizeWallet(challenge.wallet_address);
      if (recovered !== wallet) throw new Error('wallet signature does not match challenge');
    } catch {
      throw new Error('wallet signature is invalid');
    }

    const consumed = await client.query(
      `UPDATE wallet_challenges SET consumed_at = $2
       WHERE challenge_hash = $1 AND consumed_at IS NULL AND expires_at > $2`,
      [challengeHash, verifiedAt],
    );
    if (consumed.rowCount !== 1) throw new Error('invalid or expired wallet challenge');
    await client.query(
      `INSERT INTO wallet_sessions (token_hash, wallet_address, origin, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [sessionTokenHash, wallet, parsedOrigin.origin, expiresAt],
    );
  });

  return { token: sessionToken, walletAddress: wallet, expiresAt: expiresAt.toISOString() };
}

export async function resolveWalletSession(pool, token, { now = new Date() } = {}) {
  if (typeof token !== 'string' || !TOKEN.test(token)) throw new Error('wallet session is invalid or expired');
  const result = await pool.query(
    `SELECT wallet_address, origin, expires_at FROM wallet_sessions
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2`,
    [hash(token), asDate(now, 'now')],
  );
  const session = result.rows[0];
  if (!session) throw new Error('wallet session is invalid or expired');
  return {
    walletAddress: normalizeWallet(session.wallet_address),
    origin: session.origin,
    expiresAt: new Date(session.expires_at).toISOString(),
  };
}

export async function revokeWalletSession(pool, token, { now = new Date() } = {}) {
  if (typeof token !== 'string' || !TOKEN.test(token)) return false;
  const result = await pool.query(
    `UPDATE wallet_sessions SET revoked_at = $2
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hash(token), asDate(now, 'now')],
  );
  return result.rowCount === 1;
}
