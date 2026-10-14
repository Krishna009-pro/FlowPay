import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { registerAuthRoutes } from './routes/auth.js';
import { registerPayrollRoutes } from './routes/payroll.js';

export function buildApp({ database, logger = false, allowedOrigins = ['http://localhost:5173'], secureCookies = false, rulesProvider = null, fakeProvider = null, nodeEnv = 'development' } = {}) {
  if (!database || typeof database.ping !== 'function') {
    throw new TypeError('buildApp requires a database with a ping method');
  }

  const app = Fastify({
    logger: logger ? {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body',
          'res.headers["set-cookie"]',
        ],
        censor: '[REDACTED]',
      },
    } : false,
    genReqId: () => randomUUID(),
  });

  app.get('/health', {
    schema: { response: { 200: { type: 'object', properties: { status: { type: 'string' } }, required: ['status'], additionalProperties: false } } },
  }, async () => ({ status: 'ok' }));

  app.get('/ready', {
    schema: {
      response: {
        200: { type: 'object', properties: { status: { type: 'string' } }, required: ['status'], additionalProperties: false },
        503: { type: 'object', properties: { status: { type: 'string' } }, required: ['status'], additionalProperties: false },
      },
    },
  }, async (_request, reply) => {
    try {
      await database.ping();
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'not_ready' });
    }
  });

  if (database.pool) {
    registerAuthRoutes(app, { database, allowedOrigins, secureCookies });
    registerPayrollRoutes(app, { database, allowedOrigins, rulesProvider, fakeProvider, nodeEnv });
  }

  return app;
}
