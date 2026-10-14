export function subscribeWalletEvents(provider, { onAccounts, onChain }) {
  if (!provider?.on) return () => {};

  const handleAccounts = (accounts) => onAccounts(accounts);
  const handleChain = (chainId) => onChain(Number.parseInt(chainId, 16));
  provider.on('accountsChanged', handleAccounts);
  provider.on('chainChanged', handleChain);

  return () => {
    provider.removeListener?.('accountsChanged', handleAccounts);
    provider.removeListener?.('chainChanged', handleChain);
  };
}
