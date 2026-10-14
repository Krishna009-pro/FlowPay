export function readDeploymentPrivateKey(env = process.env) {
  const privateKey = env.PRIVATE_KEY;
  if (!privateKey) throw new Error('PRIVATE_KEY environment variable is required.');
  return privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
}
