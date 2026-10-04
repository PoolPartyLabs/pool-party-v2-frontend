export function rehearsalSignInAllowed(raw: string, address: string): boolean {
  const message = raw.startsWith("0x") ? Buffer.from(raw.slice(2), "hex").toString("utf8") : raw;
  const legacy = new RegExp(
    `^Welcome to Pool Party!\\n\\nSign this message to prove you have access to this wallet and we'll log you in\\. This won't cost you any gas fees\\.\\n\\nWallet address: ${address}\\n\\nNonce: [A-Za-z0-9-]+$`,
    "i",
  );
  const siwe = new RegExp(
    `^[^\\n]+ wants you to sign in with your Ethereum account:\\n${address}\\n\\n`,
    "i",
  );
  return (
    legacy.test(message) ||
    (siwe.test(message) &&
      /\nURI: https?:\/\/[^\n]+\nVersion: 1\nChain ID: \d+\nNonce: [A-Za-z0-9]+\nIssued At: /.test(
        message,
      ))
  );
}
