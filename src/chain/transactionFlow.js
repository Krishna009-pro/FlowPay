export async function performWalletAction({
  label, send, waitForReceipt, refresh, errorMessage, onTransaction,
}) {
  let hash;
  onTransaction({ label, status: 'wallet' });
  try {
    hash = await send();
    onTransaction({ label, status: 'pending', hash });
    const receipt = await waitForReceipt(hash);
    if (receipt.status !== 'success') throw new Error('The transaction reverted. No balance was updated.');
    onTransaction({ label, status: 'confirmed', hash });
    await refresh();
    return true;
  } catch (error) {
    onTransaction({ label, status: 'error', hash, message: errorMessage(error) });
    return false;
  }
}
