/**
 * @id PP-E2E-V2-003
 * @name v2 launch signing boundary
 * @implements-rules-version v3 (POO-2192)
 */
import { z } from "zod";
import { loadJournal } from "../../src/features/manager/fund/launch/journal";
import { rehearsalSignInAllowed } from "./rehearsalSignIn";

export type V2LaunchMode = "dry" | "dry-launch" | "signed";

export function v2LaunchResumePath(journeyId: string, manager: string): string {
  const match = /^(0x[\da-f]{40}):([\w-]+)$/i.exec(journeyId);
  if (!match?.[1] || match[1].toLowerCase() !== manager.toLowerCase())
    throw new Error("V2_LAUNCH_INVALID_RESUME");
  return `/en/manager/fund-launch/${encodeURIComponent(journeyId)}`;
}

export function v2LaunchResumeState(
  state: unknown,
  origin: string,
  manager: string,
): {
  path: string;
  journeyId: string;
  draftId: string;
  name: string;
  seed: string;
  failed: boolean;
} {
  try {
    const parsed = z
      .object({
        origins: z.array(
          z.object({
            origin: z.string(),
            localStorage: z.array(z.object({ name: z.string(), value: z.string() })),
          }),
        ),
      })
      .parse(state);
    const origins = parsed.origins.filter((entry) => entry.origin === new URL(origin).origin);
    const selectedOrigin = origins[0];
    if (origins.length !== 1 || !selectedOrigin) throw new Error();
    const entries = selectedOrigin.localStorage;
    const storage = new Map(entries.map((entry) => [entry.name, entry.value]));
    if (storage.size !== entries.length) throw new Error();
    const prefix = `pp:v2:journey:1:${manager.toLowerCase()}:`;
    const candidates = [];
    for (const entry of entries.filter((entry) => entry.name.startsWith(prefix))) {
      const journey = z
        .object({
          version: z.literal(1),
          journeyId: z.string(),
          draftId: z.string(),
          manager: z.string(),
          createdAt: z.string(),
          draft: z.object({
            id: z.string(),
            review: z.object({
              name: z.string().trim().min(10).max(50),
              seed: z.string().regex(/^\d+(\.\d{1,6})?$/),
            }),
          }),
        })
        .parse(JSON.parse(entry.value));
      const path = v2LaunchResumePath(journey.journeyId, manager);
      if (
        entry.name !== `pp:v2:journey:1:${journey.journeyId}` ||
        journey.journeyId !== `${manager.toLowerCase()}:${journey.draftId}` ||
        journey.manager.toLowerCase() !== manager.toLowerCase() ||
        journey.draft.id !== journey.draftId
      )
        throw new Error();
      const journal = loadJournal(
        {
          getItem: (key) => storage.get(key) ?? null,
          setItem: () => {
            throw new Error();
          },
        },
        journey.draftId,
        manager,
      );
      if (!journal) throw new Error();
      if (journal.steps.every((step) => journal.checkpoints[step.id]?.status === "confirmed"))
        continue;
      candidates.push({
        path,
        journeyId: journey.journeyId,
        draftId: journey.draftId,
        name: journey.draft.review.name,
        seed: journey.draft.review.seed,
        failed: journal.steps.some((step) => journal.checkpoints[step.id]?.status === "failed"),
      });
    }
    if (candidates.length > 1) throw new Error("V2_LAUNCH_AMBIGUOUS_RESUME");
    const selected = candidates[0];
    if (candidates.length !== 1 || !selected) throw new Error();
    return selected;
  } catch (error) {
    if (error instanceof Error && error.message === "V2_LAUNCH_AMBIGUOUS_RESUME") throw error;
    throw new Error("V2_LAUNCH_INVALID_RESUME");
  }
}

export function v2LaunchStepLabel(title: string, chainId: number): string {
  if (chainId !== 42161 && chainId !== 4663) throw new Error("V2_LAUNCH_UNKNOWN_CHAIN");
  return `${title} · ${chainId === 42161 ? "Arbitrum" : "Robinhood Chain"}`;
}

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

const readMethods = new Set([
  "eth_accounts",
  "eth_requestAccounts",
  "eth_chainId",
  "net_version",
  "wallet_requestPermissions",
  "wallet_getPermissions",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
  "wallet_watchAsset",
  "eth_call",
  "eth_getBalance",
  "eth_getTransactionReceipt",
  "eth_getTransactionCount",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getLogs",
]);

export async function safeV2WalletCall<Result>(callback: () => Promise<Result>): Promise<Result> {
  try {
    return await callback();
  } catch {
    throw new Error("V2_WALLET_REQUEST_FAILED");
  }
}

export function v2LaunchFailure(hasUiError: boolean): { error: string; uiError?: string } {
  return hasUiError
    ? { error: "V2_LAUNCH_FAILED", uiError: "V2_LAUNCH_UI_ERROR" }
    : { error: "V2_LAUNCH_FAILED" };
}

export function assertV2LaunchSigningAllowed(
  request: { method: string; params?: unknown[] },
  address: string,
  mode: V2LaunchMode,
  armed: boolean,
  optedIn: string | undefined,
  noSign: string | undefined = undefined,
): boolean {
  if (!signingMethods.has(request.method)) {
    if (!readMethods.has(request.method)) throw new Error("Wallet method is not allowlisted");
    return false;
  }
  if (mode === "dry-launch" || noSign === "1")
    throw new Error("Launch signing is disarmed (launch-dry never signs, including SIWE)");
  const authentication =
    request.method === "personal_sign" &&
    rehearsalSignInAllowed(String(request.params?.[0] ?? ""), address);
  if (authentication) {
    if (String(request.params?.[1] ?? "").toLowerCase() !== address.toLowerCase())
      throw new Error("Unauthorized personal_sign signer");
    return false;
  }
  if (mode !== "signed" || !armed || optedIn !== "1")
    throw new Error("Launch signing is disarmed (dry mode never signs transactions)");
  if (request.method === "eth_sendRawTransaction")
    throw new Error("Only Node-side eth_sendTransaction signing is permitted");
  if (
    request.method === "personal_sign" &&
    String(request.params?.[1] ?? "").toLowerCase() !== address.toLowerCase()
  )
    throw new Error("Unauthorized personal_sign signer");
  return true;
}
