async function readJson(response) {
  let body = {};
  try { body = await response.json(); } catch { /* keep the generic HTTP fallback */ }
  if (!response.ok) throw new Error(body.error || `Payroll API request failed (${response.status})`);
  return body;
}

export function createPayrollAuthClient({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch is required');

  return {
    async signIn({ walletAddress, signMessage }) {
      if (typeof signMessage !== 'function') throw new TypeError('signMessage is required');
      const challenge = await readJson(await fetchImpl('/api/auth/challenge', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ walletAddress }),
      }));
      const signature = await signMessage(challenge.message);
      return readJson(await fetchImpl('/api/auth/verify', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: challenge.message, signature }),
      }));
    },

    async getSession() {
      const response = await fetchImpl('/api/auth/session', { credentials: 'same-origin' });
      if (response.status === 401) return null;
      return readJson(response);
    },

    async signOut() {
      const response = await fetchImpl('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`Payroll API request failed (${response.status})`);
    },
  };
}
