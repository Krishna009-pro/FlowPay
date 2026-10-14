export function loadConfig(env = process.env) {
  const databaseUrl = env.DATABASE_URL;
  if (typeof databaseUrl !== 'string' || databaseUrl.trim() === '') {
    throw new Error('DATABASE_URL is required');
  }

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must use postgres: or postgresql:');
  }

  const rawPort = env.PORT ?? '3001';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }

  const host = env.HOST ?? '127.0.0.1';
  if (typeof host !== 'string' || host.trim() === '') {
    throw new Error('HOST must be a non-empty hostname');
  }

  const allowedOrigins = (env.APP_ORIGINS ?? 'http://localhost:5173')
    .split(',').map((value) => value.trim()).filter(Boolean);
  if (allowedOrigins.length === 0) throw new Error('APP_ORIGINS must contain at least one origin');
  for (const origin of allowedOrigins) {
    let parsedOrigin;
    try { parsedOrigin = new URL(origin); } catch { throw new Error('APP_ORIGINS must contain valid origins'); }
    if (parsedOrigin.origin !== origin || parsedOrigin.pathname !== '/') {
      throw new Error('APP_ORIGINS entries must be origins without paths');
    }
  }

  return {
    databaseUrl,
    host,
    port,
    nodeEnv: env.NODE_ENV ?? 'development',
    allowedOrigins,
    secureCookies: (env.NODE_ENV ?? 'development') === 'production',
  };
}
