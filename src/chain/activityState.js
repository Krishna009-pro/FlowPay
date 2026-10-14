export function emptyActivityState({ setupError, error, loading }) {
  if (setupError) return { title: 'Fresh contract required', body: setupError };
  if (error) return { title: 'Activity unavailable', body: error };
  if (loading) return { title: 'Reading Monad Testnet', body: 'Loading confirmed events from the deployment block.' };
  return {
    title: 'No contract events yet',
    body: 'Confirmed actions will appear after the first contract transaction.',
  };
}
