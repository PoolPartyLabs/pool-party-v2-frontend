import { rehearsalSignInAllowed } from "./rehearsalSignIn";

export type V2LaunchMode = "dry" | "dry-launch" | "signed";

export function v2LaunchMode(dry: string | undefined): V2LaunchMode {
  return dry === "1" ? "dry" : dry === "launch" ? "dry-launch" : "signed";
}

const signingMethods = new Set([
  "eth_sendTransaction",
  "eth_sendRawTransaction",
  "eth_sign",
  "eth_signTypedData",
  "eth_signTypedData_v3",
  "eth_signTypedData_v4",
  "personal_sign",
]);

export function assertV2LaunchSigningAllowed(
  request: { method: string; params?: unknown[] },
  address: string,
  mode: V2LaunchMode,
  armed: boolean,
  optedIn: string | undefined,
): boolean {
  const authentication =
    request.method === "personal_sign" &&
    rehearsalSignInAllowed(String(request.params?.[0] ?? ""), address);
  if (authentication || !signingMethods.has(request.method)) return false;
  if (mode !== "signed" || !armed || optedIn !== "1")
    throw new Error("Launch signing is disarmed (dry mode never signs transactions)");
  if (request.method === "eth_sendRawTransaction")
    throw new Error("Only Node-side eth_sendTransaction signing is permitted");
  return true;
}
