import {
  issueWalletChallenge,
  resolveWalletSession,
  revokeWalletSession,
  verifyWalletChallenge,
} from '../auth/challenges.js';

const COOKIE_NAME = 'flowpay_session';

export function readSessionCookie(header = '') {
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return rest.join('=');
  }
  return null;
}

function sessionCookie(token, { secure, maxAge }) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function registerAuthRoutes(app, { database, allowedOrigins, secureCookies }) {
  const schemas = {
    challenge: {
      body: {
        type: 'object', additionalProperties: false, required: ['walletAddress'],
        properties: { walletAddress: { type: 'string', minLength: 42, maxLength: 42 } },
      },
      response: { 200: { type: 'object', required: ['message', 'expiresAt'], properties: { message: { type: 'string' }, expiresAt: { type: 'string' } }, additionalProperties: false } },
    },
    verify: {
      body: {
        type: 'object', additionalProperties: false, required: ['message', 'signature'],
        properties: { message: { type: 'string', minLength: 80, maxLength: 2048 }, signature: { type: 'string', minLength: 132, maxLength: 132 } },
      },
      response: { 200: { type: 'object', required: ['walletAddress', 'expiresAt'], properties: { walletAddress: { type: 'string' }, expiresAt: { type: 'string' } }, additionalProperties: false } },
    },
  };

  app.post('/api/auth/challenge', { schema: schemas.challenge }, async (request, reply) => {
    try {
      const result = await issueWalletChallenge(database.pool, {
        walletAddress: request.body.walletAddress,
        origin: request.headers.origin,
        allowedOrigins,
      });
      return result;
    } catch (error) {
      const status = /origin/.test(error.message) ? 403 : 400;
      return reply.code(status).send({ error: status === 403 ? 'origin_not_allowed' : 'invalid_challenge_request' });
    }
  });

  app.post('/api/auth/verify', { schema: schemas.verify }, async (request, reply) => {
    try {
      const result = await verifyWalletChallenge(database.pool, {
        message: request.body.message,
        signature: request.body.signature,
        origin: request.headers.origin,
        allowedOrigins,
      });
      reply.header('set-cookie', sessionCookie(result.token, { secure: secureCookies, maxAge: 900 }));
      return { walletAddress: result.walletAddress, expiresAt: result.expiresAt };
    } catch (error) {
      const status = /origin/.test(error.message) ? 403 : 401;
      return reply.code(status).send({ error: status === 403 ? 'origin_not_allowed' : 'wallet_authentication_failed' });
    }
  });

  app.get('/api/auth/session', async (request, reply) => {
    try {
      const session = await resolveWalletSession(database.pool, readSessionCookie(request.headers.cookie));
      if (request.headers.origin && request.headers.origin !== session.origin) {
        return reply.code(403).send({ error: 'origin_not_allowed' });
      }
      const organizations = await database.pool.query(
        `SELECT m.organization_id AS id, m.role FROM organization_memberships m
         JOIN organizations o ON o.id = m.organization_id
         WHERE m.wallet_address = $1 AND m.status = 'active' AND o.status = 'active'
         ORDER BY m.organization_id`,
        [session.walletAddress],
      );
      return { walletAddress: session.walletAddress, expiresAt: session.expiresAt, organizations: organizations.rows };
    } catch {
      return reply.code(401).send({ error: 'wallet_session_required' });
    }
  });

  app.post('/api/auth/logout', async (request, reply) => {
    if (!allowedOrigins.includes(request.headers.origin)) {
      return reply.code(403).send({ error: 'origin_not_allowed' });
    }
    const token = readSessionCookie(request.headers.cookie);
    if (token) await revokeWalletSession(database.pool, token).catch(() => {});
    reply.header('set-cookie', sessionCookie('', { secure: secureCookies, maxAge: 0 }));
    return reply.code(204).send();
  });
}
