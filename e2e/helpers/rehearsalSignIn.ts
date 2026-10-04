export function rehearsalSignInAllowed(raw: string, address: string): boolean {
  if (!/^0x[0-9a-f]{40}$/i.test(address)) return false;
  if (raw.startsWith("0x") && !/^0x(?:[0-9a-f]{2})+$/i.test(raw)) return false;
  const message = raw.startsWith("0x") ? Buffer.from(raw.slice(2), "hex").toString("utf8") : raw;
  const legacy = new RegExp(
    `^Welcome to Pool Party!\\n\\nSign this message to prove you have access to this wallet and we'll log you in\\. This won't cost you any gas fees\\.\\n\\nWallet address: ${address}\\n\\nNonce: [A-Za-z0-9-]+$`,
    "i",
  );
  const local = message.startsWith(
    "localhost:3000 wants you to sign in with your Ethereum account:",
  );
  const domain = local ? "localhost:3000" : "v2\\.dev\\.pool-party\\.xyz";
  const uri = local ? "http://localhost:3000" : "https://v2\\.dev\\.pool-party\\.xyz";
  const siwe = new RegExp(
    `^${domain} wants you to sign in with your Ethereum account:\\n${address}\\n\\nSign in to Pool Party\\n\\nURI: ${uri}\\nVersion: 1\\nChain ID: (?:42161|4663)\\nNonce: [A-Za-z0-9]{8,}\\nIssued At: \\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z\\nExpiration Time: \\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
    "i",
  );
  const privy = new RegExp(
    `^${domain} wants you to sign in with your Ethereum account:\\n${address}\\n\\nBy signing, you are proving you own this wallet and logging in\\. This does not initiate a transaction or cost any fees\\.\\n\\nURI: ${uri}\\nVersion: 1\\nChain ID: (?:42161|4663)\\nNonce: [A-Za-z0-9]{8,}\\nIssued At: \\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z\\nResources:\\n- https://privy\\.io$`,
    "i",
  );
  return legacy.test(message) || siwe.test(message) || privy.test(message);
}
