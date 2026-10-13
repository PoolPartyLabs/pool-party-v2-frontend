/**
 * @id PP-MGR-HOK-025 (POO-2262)
 * @name useSolanaV6Launch
 * @implements-rules-version DEC-188, DEC-190, DEC-191, DEC-195, DEC-203, DEC-204 (founder rulings, unversioned)
 * @analytics-events builder_launch_completed, builder_launch_failed
 *
 * Runs the v6 launch journal (`solanaV6Launch.ts`) against the dev API through the server actions
 * of `solanaLaunchActions.ts`. The Manager's EVM wallet signs the two EIP-712 consents and sends the
 * Arbitrum/Robinhood transactions with the API's `gas`; the Manager's Solana wallet (Phantom through
 * Privy) signs the API-built Solana transactions, which go through the sign -> persist -> broadcast
 * helper. A step that sent something resumes from its persisted hash or signature and never sends
 * twice; a step that provably sent nothing is retried.
 */
"use client";
import { useWallets } from "@privy-io/react-auth";
import {
  generateKeyPairSigner,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
} from "@solana/kit";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPublicClient, createWalletClient, custom, type Hex, http } from "viem";
import { arbitrum } from "viem/chains";
import { getSessionAction } from "@/features/auth/siweActions";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import {
  buildSendToSolanaAction,
  buildSolanaBootstrapAction,
  buildSolanaCreationAction,
  buildSolanaManagerAction,
  buildSolanaReceiveAction,
  discoverSolanaFundAction,
  quoteSolanaSwapAction,
  readSolanaBalancesAction,
  readSolanaFundAction,
  readSolanaRaydiumPoolAction,
  readSolanaTransitAction,
  readSolanaVenuesAction,
  refreshSolanaLaunchReportAction,
  trackSolanaTransitAction,
} from "@/lib/api/v2/solanaLaunchActions";
import type { BuildCreation, EvmBuild, UnsignedSolanaBuild } from "@/lib/api/v2/solanaSchemas";
import { getChainById, transportMap } from "@/lib/chains";
import { createManagerSolanaRpc, readSolanaConfirmation } from "@/lib/solana/rpc";
import { validateSolanaApiQuote } from "@/lib/solana/swap";
import { isSolanaNotSubmitted, sendSolanaTransaction } from "@/lib/solana/transaction";
import { useManagerSolanaWallet } from "@/lib/solana/useManagerSolanaWallet";
import { isUserRejection, sendBuiltTransaction } from "@/lib/tx/sendTransaction";
import { useEnsureWalletChain } from "@/lib/tx/useEnsureWalletChain";
import { planOf } from "../build/plan/buildPlan";
import type { MandateDraft } from "../mandateDraft";
import { getDraft, subscribe } from "../mandateDraftStore";
import {
  ARBITRUM_USDC,
  creationLanded,
  initialSolanaLaunch,
  isSolanaV6Plan,
  loadSolanaLaunch,
  RAYDIUM_SOL_USDC_POOL,
  raydiumRange,
  SOLANA_CREATION_STEPS,
  SOLANA_OPERATION_STEPS,
  SOLANA_USDC_MINT,
  SOLANA_WSOL_MINT,
  type SolanaCreationAmounts,
  type SolanaLaunchState,
  type SolanaLaunchStepId,
  type SolanaLaunchStepRecord,
  saveSolanaLaunch,
  solanaBuildToSign,
  solanaLaunchKey,
  verifyCreationPlan,
} from "./solanaV6Launch";

/** A refusal the journey waits out instead of failing (API contract §1, §3, §4). */
const WAIT_CODES = new Set([
  "V2_RATE_LIMITED",
  "SYSTEM_RATE_LIMITED",
  "V2_DISCOVERY_PENDING",
  "SOLANA_STATE_NOT_FINALIZED",
  "SOLANA_LOOKUP_TABLE_WARMING",
  "SOLANA_REPORT_REFRESHING",
  "SPOKE_REPORT_STALE",
  "V2_UNAVAILABLE",
]);
class Wait extends Error {
  constructor(readonly seconds: number) {
    super("WAIT");
  }
}
class StepFailure extends Error {}
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; status?: number; retryAfterSeconds?: number } };
/** Unwrap a server action result: wait on the transient codes, fail on everything else. */
function unwrap<T>(result: ActionResult<T>, waitOn: string[] = []): T {
  if (result.ok) return result.data;
  const { code, retryAfterSeconds } = result.error;
  if (WAIT_CODES.has(code) || waitOn.includes(code))
    throw new Wait(Math.min(Math.max(retryAfterSeconds ?? 10, 2), 120));
  throw new StepFailure(code);
}
/** sendBuiltTransaction refusals raised before the wallet could broadcast anything. */
const UNSENT_EVM_CODES = new Set([
  "WRONG_CHAIN",
  "WRONG_ACCOUNT",
  "CHAIN_UNAVAILABLE",
  "BUILD_TARGET_MISMATCH",
]);
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
const codeOf = (error: unknown) =>
  error instanceof Error && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.message)
    ? error.message
    : "LAUNCH_STEP_FAILED";

export interface SolanaV6LaunchView {
  draft: MandateDraft | null;
  supported: boolean;
  manager: string | null;
  state: SolanaLaunchState | null;
  solanaAddress: string | null;
  /** Connected Solana wallets when more than one could be the Manager's key. */
  solanaCandidates: string[];
  chooseSolana: (address: string) => void;
  solanaBalanceLamports: bigint | null;
  solanaReady: boolean;
  connectSolana: () => void;
  start: (amounts: SolanaCreationAmounts) => void;
  runCreation: () => void;
  runOperations: () => void;
  stop: () => void;
  restartCreation: () => void;
  setAmount: (key: keyof SolanaLaunchState["amounts"], raw: string) => void;
  busy: boolean;
  /** Arbitrum/Robinhood position blocks in the plan that this launch does not open. */
  evmBlocks: number;
  activeStep: SolanaLaunchStepId | null;
  error: string | null;
}

export function useSolanaV6Launch(draftId: string): SolanaV6LaunchView {
  const { track } = useAnalytics();
  const [draft, setDraft] = useState<MandateDraft | null>(null);
  const [manager, setManager] = useState<string | null>(null);
  const [state, setState] = useState<SolanaLaunchState | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeStep, setActiveStep] = useState<SolanaLaunchStepId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef<SolanaLaunchState | null>(null);
  const planRef = useRef<BuildCreation | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { wallets } = useWallets();
  const ensureChain = useEnsureWalletChain();
  const [chosenSolana, setChosenSolana] = useState<string | undefined>(undefined);
  const solana = useManagerSolanaWallet(state?.solanaKey ?? chosenSolana);

  useEffect(() => {
    const read = () => setDraft(getDraft(draftId));
    read();
    return subscribe(read);
  }, [draftId]);
  useEffect(() => {
    let active = true;
    void getSessionAction().then((wallet) => {
      if (active) setManager(wallet ? wallet.toLowerCase() : null);
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!manager) return;
    try {
      const stored = loadSolanaLaunch(localStorage, manager, draftId);
      stateRef.current = stored;
      setState(stored);
    } catch {
      setError("SOLANA_LAUNCH_STORAGE_INVALID");
    }
  }, [manager, draftId]);

  const commit = useCallback((mutate: (next: SolanaLaunchState) => void) => {
    const current = stateRef.current;
    if (!current) throw new StepFailure("SOLANA_LAUNCH_STATE_MISSING");
    const next = structuredClone(current);
    mutate(next);
    saveSolanaLaunch(localStorage, next);
    stateRef.current = next;
    setState(next);
    return next;
  }, []);
  const setStep = useCallback(
    (step: SolanaLaunchStepId, patch: Partial<SolanaLaunchStepRecord>) =>
      commit((next) => {
        next.steps[step] = {
          ...next.steps[step],
          ...patch,
          at: Date.now(),
        } as SolanaLaunchStepRecord;
        if (patch.status && patch.status !== "failed") delete next.steps[step]?.error;
      }),
    [commit],
  );

  const plan = draft ? planOf(draft) : null;
  const supported = !!plan && isSolanaV6Plan(plan);
  // Arbitrum and Robinhood position blocks are sealed in the Mandate but not run by this journey.
  const evmBlocks = plan
    ? [
        ...plan.hub.chains,
        ...plan.spokes
          .filter((spoke) => spoke.network !== "solana")
          .flatMap((spoke) => spoke.chains),
      ].flatMap((chain) => chain.steps.filter((step) => step.family === "position")).length
    : 0;

  // ---- wallets -------------------------------------------------------------------------------
  const evmWallet = () => {
    const wallet = wallets.find(
      (candidate) => candidate.address.toLowerCase() === stateRef.current?.manager,
    );
    if (!wallet) throw new StepFailure("V2_WALLET_REQUIRED");
    return { wallet };
  };
  const signTypedData = async (typedData: BuildCreation["binding"]["typedData"]) => {
    const { wallet } = evmWallet();
    const provider = await ensureChain(wallet, 42161);
    const client = createWalletClient({
      account: wallet.address as Hex,
      chain: arbitrum,
      transport: custom(provider),
    });
    try {
      return await client.signTypedData({
        account: wallet.address as Hex,
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      } as Parameters<typeof client.signTypedData>[0]);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "";
      throw new StepFailure(
        /reject|denied|cancel/i.test(message) ? "USER_REJECTED" : "SIGNATURE_FAILED",
      );
    }
  };
  const publicClient = (chainId: number) => {
    const chain = getChainById(chainId);
    if (!chain) throw new StepFailure("V2_UNAVAILABLE");
    return createPublicClient({ chain, transport: transportMap[chainId] ?? http() });
  };
  /**
   * An earlier wallet prompt ended without a hash (an ambiguous failure or a reload mid-prompt).
   * Never resend before knowing: nothing pending from the persisted nonce means provably unsent;
   * a consumed nonce asks the step's own evidence (`landed`), else the Manager must check.
   */
  const reconcileAttempt = async (
    step: SolanaLaunchStepId,
    chainId: number,
    landed?: () => Promise<boolean>,
  ): Promise<"landed" | "unsent"> => {
    const record = stateRef.current?.steps[step];
    const manager = stateRef.current?.manager as Hex;
    const client = publicClient(chainId);
    const [mined, pending] = await Promise.all([
      client.getTransactionCount({ address: manager, blockTag: "latest" }),
      client.getTransactionCount({ address: manager, blockTag: "pending" }),
    ]);
    const nonce = record?.nonce ? Number(record.nonce) : null;
    if (landed && (await landed())) return "landed";
    if (nonce !== null && pending <= nonce) return "unsent";
    if (nonce !== null && mined <= nonce) throw new Wait(10); // still in the mempool
    if (landed) return "unsent"; // the nonce went to another transaction and this one did not land
    throw new StepFailure("SUBMISSION_RECONCILIATION_REQUIRED");
  };
  /**
   * Send an API-built EVM transaction with its `gas` from the Manager wallet, persist the attempt
   * and the hash, wait for the receipt. Resumes from a persisted hash; never sends twice.
   */
  const sendEvm = async (
    step: SolanaLaunchStepId,
    tx: EvmBuild,
    signal: AbortSignal,
    landed?: () => Promise<boolean>,
  ): Promise<"sent" | "landed"> => {
    const record = stateRef.current?.steps[step];
    let hash = record?.chain !== "solana" ? record?.txHash : undefined;
    if (!hash && record?.attempted) {
      if ((await reconcileAttempt(step, tx.chainId, landed)) === "landed") {
        setStep(step, { attempted: undefined, nonce: undefined });
        return "landed";
      }
      setStep(step, { attempted: undefined, nonce: undefined });
    }
    if (!hash) {
      if (signal.aborted) throw new StepFailure("LAUNCH_CANCELLED");
      // Every API build carries its padded gas limit (§3.10, §3.13): never let the wallet guess it.
      if (!tx.gas) throw new StepFailure("V2_INVALID_RESPONSE");
      // The exact Manager wallet, never `wallets[0]`: an embedded wallet may sit first in the list.
      const { wallet } = evmWallet();
      const provider = await ensureChain(wallet, tx.chainId);
      const nonce = await publicClient(tx.chainId).getTransactionCount({
        address: wallet.address as Hex,
        blockTag: "pending",
      });
      setStep(step, { attempted: true, nonce: String(nonce) });
      try {
        hash = await sendBuiltTransaction(
          provider,
          {
            tx: { from: tx.from, to: tx.to, data: tx.data, value: tx.value, gas: tx.gas },
            chainId: tx.chainId,
          },
          wallet.address,
          tx.chainId,
        );
      } catch (failure) {
        const code = (failure as { cause?: { code?: unknown } }).cause?.code;
        if (isUserRejection(failure) || (typeof code === "string" && UNSENT_EVM_CODES.has(code))) {
          setStep(step, { attempted: undefined, nonce: undefined });
          throw new StepFailure(isUserRejection(failure) ? "USER_REJECTED" : String(code));
        }
        // Unknown outcome: keep the attempt; the next run reconciles before any resend.
        throw new StepFailure("SUBMISSION_RECONCILIATION_REQUIRED");
      }
      setStep(step, {
        status: "submitted",
        txHash: hash,
        chain: tx.chainId,
        attempted: undefined,
      });
    }
    const client = publicClient(tx.chainId);
    for (let attempt = 0; attempt < 200 && !signal.aborted; attempt += 1) {
      const receipt = await client.getTransactionReceipt({ hash: hash as Hex }).catch(() => null);
      if (receipt?.status === "success") return "sent";
      if (receipt?.status === "reverted") {
        // Proven failure: nothing moved, so the step can be rebuilt.
        setStep(step, { status: "failed", txHash: undefined, nonce: undefined });
        throw new StepFailure("TRANSACTION_REVERTED");
      }
      await sleep(3000, signal);
    }
    throw new Wait(5);
  };
  const solanaRpc = createManagerSolanaRpc();
  /** Wait until the step's last persisted Solana signature is final; `expired` lets it be rebuilt. */
  const settleSolana = async (step: SolanaLaunchStepId, signal: AbortSignal) => {
    const record = stateRef.current?.steps[step];
    const last = record?.txHash;
    if (!last || record?.chain !== "solana") return "none" as const;
    for (let attempt = 0; attempt < 120 && !signal.aborted; attempt += 1) {
      const status = await readSolanaConfirmation(last).catch(() => "unknown" as const);
      if (status === "finalized") return "final" as const;
      if (status === "failed") {
        // Proven on-chain failure: forget the signature so the step can be rebuilt.
        setStep(step, { status: "failed", txHash: undefined, lastValid: undefined });
        throw new StepFailure("SOLANA_TRANSACTION_FAILED");
      }
      if (status === "unknown" && record.lastValid) {
        // Past the blockhash's last valid height an unseen signature can never land: rebuild.
        const height = await solanaRpc.blockHeight().catch(() => null);
        if (height !== null && height > BigInt(record.lastValid)) {
          setStep(step, { txHash: undefined, lastValid: undefined });
          return "expired" as const;
        }
      }
      await sleep(2500, signal);
    }
    throw new Wait(5);
  };
  /** Sign an API-built Solana transaction with the Manager's key, persist, broadcast, finalize. */
  const sendSolana = async (
    step: SolanaLaunchStepId,
    build: UnsignedSolanaBuild,
    signal: AbortSignal,
    cosign?: (bytes: Uint8Array) => Promise<Uint8Array>,
  ) => {
    const key = stateRef.current?.solanaKey;
    if (!key || solana.address !== key) throw new StepFailure("SOLANA_WALLET_REQUIRED");
    const built = solanaBuildToSign(build, key);
    try {
      await sendSolanaTransaction({
        walletAddress: key,
        rpc: solanaRpc,
        build: async () => built,
        sign: solana.signTransaction,
        cosign,
        persist: (signature) =>
          commit((next) => {
            const record = next.steps[step] ?? { status: "running" };
            next.steps[step] = {
              ...record,
              status: "submitted",
              chain: "solana",
              txHash: signature,
              signatures: [...(record.signatures ?? []), signature],
              lastValid: built.lifetime.lastValidBlockHeight.toString(),
            };
          }),
        signal,
      });
    } catch (failure) {
      if (isSolanaNotSubmitted(failure)) {
        // Provably unsent (F5): forget the signature so the step can be rebuilt and retried.
        commit((next) => {
          const record = next.steps[step];
          if (record) {
            record.txHash = undefined;
            record.lastValid = undefined;
            record.status = "running";
          }
        });
        throw new StepFailure(codeOf(failure));
      }
      throw failure;
    }
    if ((await settleSolana(step, signal)) !== "final") throw new Wait(2);
  };

  // ---- steps ---------------------------------------------------------------------------------
  const core = () => {
    const value = stateRef.current?.plan?.core;
    if (!value) throw new StepFailure("SOLANA_PLAN_REQUIRED");
    return value;
  };
  const signedRequest = () => {
    const current = stateRef.current;
    if (!current?.plan || !current.signatures.binding || !current.signatures.swapPolicy)
      throw new StepFailure("SOLANA_SIGNATURES_REQUIRED");
    return {
      manager: current.manager,
      managerSolanaKey: current.solanaKey,
      ...current.request,
      spokes: ["robinhood", "solana"],
      creationNumber: current.plan.creationNumber,
      bindingNonce: current.plan.bindingNonce,
      bindingExpiry: current.plan.bindingExpiry,
      bindingSignature: current.signatures.binding,
      swapPolicySignature: current.signatures.swapPolicy,
    };
  };
  const rebuildSigned = async () => {
    const current = stateRef.current;
    if (!current) throw new StepFailure("SOLANA_LAUNCH_STATE_MISSING");
    const result = await buildSolanaCreationAction(signedRequest());
    const built = unwrap(result);
    verifyCreationPlan(built, {
      manager: current.manager,
      solanaKey: current.solanaKey,
      core: core(),
      seedAmount: current.request.seedAmount,
    });
    if (built.status !== "awaiting-signatures")
      commit((next) => {
        next.bootstrapBody = built.nextRequests.solanaBootstrap.body;
      });
    return built;
  };
  const solanaVenues = () => stateRef.current?.request.venues ?? [];

  const handlers: Record<SolanaLaunchStepId, (signal: AbortSignal) => Promise<"done" | "skipped">> =
    {
      async plan() {
        const current = stateRef.current;
        if (!current) throw new StepFailure("SOLANA_LAUNCH_STATE_MISSING");
        if (!solana.address || solana.address !== current.solanaKey)
          throw new StepFailure("SOLANA_WALLET_REQUIRED");
        const built = unwrap(
          await buildSolanaCreationAction({
            manager: current.manager,
            managerSolanaKey: current.solanaKey,
            ...current.request,
          }),
        );
        verifyCreationPlan(built, {
          manager: current.manager,
          solanaKey: current.solanaKey,
          seedAmount: current.request.seedAmount,
        });
        planRef.current = built;
        commit((next) => {
          next.plan = {
            core: built.core,
            fundId: built.fundId,
            creationNumber: built.creationNumber,
            bindingNonce: built.binding.nonce,
            bindingExpiry: built.binding.expiry,
            expiresAt: built.binding.expiresAt,
            fundPda: built.solana.fundPda,
            vault: built.solana.vault,
            usdcAta: built.solana.usdcAta,
            robinhoodSpokeVault: built.predicted.robinhood.spokeVault,
          };
          next.signatures = {};
          next.steps["sign-binding"] = { status: "idle" };
          next.steps["sign-policy"] = { status: "idle" };
        });
        return "done";
      },
      async "sign-binding"() {
        const built = planRef.current;
        if (!built || built.core !== stateRef.current?.plan?.core)
          throw new StepFailure("SOLANA_PLAN_EXPIRED");
        const signature = await signTypedData(built.binding.typedData);
        commit((next) => {
          next.signatures.binding = signature;
        });
        return "done";
      },
      async "sign-policy"() {
        const built = planRef.current;
        if (!built || built.core !== stateRef.current?.plan?.core)
          throw new StepFailure("SOLANA_PLAN_EXPIRED");
        const signature = await signTypedData(built.swapPolicy.typedData);
        commit((next) => {
          next.signatures.swapPolicy = signature;
        });
        return "done";
      },
      async "approve-seed"(signal) {
        const record = stateRef.current?.steps["approve-seed"];
        const resuming = !!record?.txHash || !!record?.attempted;
        // The signed rebuild proves both consents before any transaction and reads the live seed.
        const built = await rebuildSigned();
        if (built.status === "created") return resuming ? "done" : "skipped";
        const approve = built.transactions.approve;
        if (!resuming) {
          if (!built.seed.balanceSufficient) throw new StepFailure("SOLANA_SEED_BALANCE_LOW");
          if (!approve || !built.seed.approveRequired) return "skipped";
        }
        if (approve && approve.to.toLowerCase() !== ARBITRUM_USDC.toLowerCase())
          throw new StepFailure("SOLANA_PLAN_MISMATCH");
        await sendEvm(
          "approve-seed",
          approve ?? ({ chainId: 42161 } as EvmBuild),
          signal,
          async () => !(await rebuildSigned()).seed.approveRequired,
        );
        return "done";
      },
      async "create-fund"(signal) {
        const record = stateRef.current?.steps["create-fund"];
        const built = await rebuildSigned();
        // The API answers `created` once this binding's Fund exists: the creation landed.
        if (built.status === "created") return "done";
        const createFund = built.transactions.createFund;
        if (!record?.txHash && !createFund?.gas) throw new Wait(5); // the approve is not mined yet
        await sendEvm(
          "create-fund",
          createFund ?? ({ chainId: 42161 } as EvmBuild),
          signal,
          async () => (await rebuildSigned()).status === "created",
        );
        return "done";
      },
      async "create-spoke"(signal) {
        const record = stateRef.current?.steps["create-spoke"];
        const built = await rebuildSigned();
        const spoke = built.transactions.createSpoke;
        if (!record?.txHash && !spoke) {
          if (built.robinhoodSpokeCreated) return "done";
          throw new Wait(5);
        }
        await sendEvm(
          "create-spoke",
          spoke ?? ({ chainId: 4663 } as EvmBuild),
          signal,
          async () => {
            const again = await rebuildSigned();
            return again.robinhoodSpokeCreated && !again.transactions.createSpoke;
          },
        );
        return "done";
      },
      async discover() {
        unwrap(await discoverSolanaFundAction(core()), ["NOT_FOUND", "BAD_REQUEST"]);
        return "done";
      },
      async bootstrap(signal) {
        for (let round = 0; round < 16 && !signal.aborted; round += 1) {
          // Each chunk must be final before the API (reading finalized state) returns the next one.
          await settleSolana("bootstrap", signal);
          const body = stateRef.current?.bootstrapBody;
          if (!body) throw new StepFailure("SOLANA_BOOTSTRAP_REQUIRED");
          const result = await buildSolanaBootstrapAction(core(), body);
          const built = result.ok ? result.data : null;
          if (!built || built.transactions.length === 0) {
            if (!result.ok && result.error.code !== "BAD_REQUEST") unwrap(result);
            // "Fund already exists" (400) or nothing left: confirm through discovery, never assume.
            unwrap(await discoverSolanaFundAction(core()), ["NOT_FOUND", "BAD_REQUEST"]);
            const fund = unwrap(await readSolanaFundAction(core()));
            if (fund.chains.some((chain) => chain.chainId === "1" && chain.status === "created"))
              return "done";
            if (!result.ok) throw new StepFailure("SOLANA_BOOTSTRAP_REFUSED");
            throw new Wait(10);
          }
          const [next] = built.transactions;
          if (!next) throw new Wait(5);
          await sendSolana("bootstrap", next, signal);
        }
        throw new Wait(5);
      },
      async verify() {
        unwrap(await discoverSolanaFundAction(core()), ["NOT_FOUND", "BAD_REQUEST"]);
        const fund = unwrap(await readSolanaFundAction(core()));
        const chains = new Map(fund.chains.map((chain) => [chain.chainId, chain.status]));
        if (chains.get("42161") && chains.get("4663") && chains.get("1") === "created")
          return "done";
        throw new Wait(15);
      },
      async "solana-report"() {
        const fresh = unwrap(await refreshSolanaLaunchReportAction(core()));
        if (fresh.usable) return "done";
        throw new Wait(fresh.retryAfterSeconds ?? 15);
      },
      async "send-to-solana"(signal) {
        const record = stateRef.current?.steps["send-to-solana"];
        // A send that already left: the Hub knows its transit (stage `sent` even before tracking).
        const previous = stateRef.current?.transit?.transitId;
        const transitExists = async () =>
          !!previous && (await readSolanaTransitAction(core(), previous)).ok;
        if (record?.txHash) {
          await sendEvm("send-to-solana", { chainId: 42161 } as EvmBuild, signal);
          return "done";
        }
        if (record?.attempted && (await transitExists())) {
          setStep("send-to-solana", { attempted: undefined, nonce: undefined });
          return "done";
        }
        const amount = stateRef.current?.amounts.send ?? "0";
        const built = unwrap(await buildSendToSolanaAction(core(), { amount }));
        const [transaction] = built.transactions;
        if (!transaction) throw new StepFailure("V2_INVALID_RESPONSE");
        // Persist the preview transit before the prompt: a reload mid-prompt reconciles against it.
        commit((next) => {
          next.transit = {
            transitId: built.preview.transitId,
            amountToArrive: built.preview.amountToArrive,
          };
        });
        await sendEvm("send-to-solana", transaction, signal, transitExists);
        return "done";
      },
      async arrival(signal) {
        // A manual receive this step already signed must settle before anything is rebuilt.
        await settleSolana("arrival", signal);
        const sent = stateRef.current?.steps["send-to-solana"]?.txHash;
        let transitId = stateRef.current?.transit?.transitId;
        if (sent) {
          // Register the mined send so the keeper relays it before Arbitrum finality (§3.11).
          const tracked = unwrap(await trackSolanaTransitAction(core(), sent), ["NOT_FOUND"]);
          transitId = tracked.transits[0]?.transitId;
          if (!transitId) throw new Wait(5);
          const confirmed = transitId;
          commit((next) => {
            next.transit = {
              transitId: confirmed,
              amountToArrive: next.transit?.amountToArrive ?? "0",
            };
          });
        }
        if (!transitId) throw new StepFailure("SOLANA_SEND_REQUIRED");
        for (let attempt = 0; attempt < 400 && !signal.aborted; attempt += 1) {
          const transit = unwrap(await readSolanaTransitAction(core(), transitId), ["NOT_FOUND"]);
          if (transit.stage === "credited" || transit.stage === "acknowledged") return "done";
          if (transit.relay.mode !== "keeper" && transit.relay.manualReceive.available) {
            const key = stateRef.current?.solanaKey ?? "";
            const receive = unwrap(await buildSolanaReceiveAction(core(), transitId, key));
            await sendSolana("arrival", receive, signal);
            continue;
          }
          await sleep(Math.max(2, transit.retryAfterSeconds ?? 5) * 1000, signal);
        }
        throw new Wait(5);
      },
      async adapters(signal) {
        if ((await settleSolana("adapters", signal)) === "expired") throw new Wait(1);
        for (let round = 0; round < 6 && !signal.aborted; round += 1) {
          const venues = unwrap(await readSolanaVenuesAction(core()));
          const pending = venues.venues.find((venue) => !venue.adapterInitialized);
          if (!pending) return "done";
          const manager = stateRef.current?.solanaKey ?? "";
          const built = unwrap(
            await buildSolanaManagerAction(
              core(),
              "initialize-adapter",
              pending.kind === "kamino"
                ? { manager, reserve: pending.reserve }
                : { manager, pool: pending.pool },
            ),
          );
          await sendSolana("adapters", built, signal);
        }
        throw new Wait(5);
      },
      async "kamino-supply"(signal) {
        if (!solanaVenues().some((venue) => venue.kind === "kamino")) return "skipped";
        if ((await settleSolana("kamino-supply", signal)) === "final") return "done";
        const balances = unwrap(await readSolanaBalancesAction(core()));
        const usdc = balances.tokens.find((token) => token.token === SOLANA_USDC_MINT);
        const wanted = BigInt(stateRef.current?.amounts.kamino ?? "0");
        const available = BigInt(usdc?.unallocatedBalance ?? "0");
        const amount = wanted < available ? wanted : available;
        if (amount <= BigInt(0)) throw new StepFailure("SOLANA_BALANCE_EMPTY");
        const built = unwrap(
          await buildSolanaManagerAction(core(), "kamino-supply", {
            manager: stateRef.current?.solanaKey ?? "",
            amount: amount.toString(),
          }),
        );
        await sendSolana("kamino-supply", built, signal);
        return "done";
      },
      async swap(signal) {
        if (!solanaVenues().some((venue) => venue.kind === "raydium")) return "skipped";
        if ((await settleSolana("swap", signal)) === "final") return "done";
        const amount = stateRef.current?.amounts.swap ?? "0";
        if (BigInt(amount) <= BigInt(0)) return "skipped";
        const request = {
          inputMint: SOLANA_USDC_MINT,
          outputMint: SOLANA_WSOL_MINT,
          amount,
          slippageBps: 100,
          maxPriceImpactBps: 100,
          poolId: RAYDIUM_SOL_USDC_POOL,
        };
        const quote = unwrap(await quoteSolanaSwapAction(core(), request));
        validateSolanaApiQuote(quote.envelope, {
          poolId: RAYDIUM_SOL_USDC_POOL,
          fund: core(),
          solanaAddress: stateRef.current?.solanaKey ?? "",
          maxPriceImpactBps: 100,
        });
        await sendSolana("swap", quote.transaction, signal);
        return "done";
      },
      async "raydium-open"(signal) {
        if (!solanaVenues().some((venue) => venue.kind === "raydium")) return "skipped";
        if ((await settleSolana("raydium-open", signal)) === "final") return "done";
        const pool = unwrap(await readSolanaRaydiumPoolAction(core(), RAYDIUM_SOL_USDC_POOL));
        const balances = unwrap(await readSolanaBalancesAction(core()));
        const balanceOf = (mint: string) =>
          BigInt(balances.tokens.find((token) => token.token === mint)?.unallocatedBalance ?? "0");
        const wsol = balanceOf(SOLANA_WSOL_MINT);
        const usdcWanted = BigInt(stateRef.current?.amounts.raydiumUsdc ?? "0");
        const usdcAvailable = balanceOf(SOLANA_USDC_MINT);
        const usdc = usdcWanted < usdcAvailable ? usdcWanted : usdcAvailable;
        if (wsol <= BigInt(0) && usdc <= BigInt(0)) throw new StepFailure("SOLANA_BALANCE_EMPTY");
        const range = raydiumRange(pool.tickCurrent, pool.tickSpacing);
        const nftMint = await generateKeyPairSigner();
        const built = unwrap(
          await buildSolanaManagerAction(core(), "raydium-open", {
            manager: stateRef.current?.solanaKey ?? "",
            pool: RAYDIUM_SOL_USDC_POOL,
            nftMint: nftMint.address,
            ...range,
            amount0: (pool.mint0 === SOLANA_WSOL_MINT ? wsol : usdc).toString(),
            amount1: (pool.mint0 === SOLANA_WSOL_MINT ? usdc : wsol).toString(),
            slippageBps: 100,
          }),
        );
        await sendSolana("raydium-open", built, signal, async (bytes) => {
          const transaction = getTransactionDecoder().decode(bytes) as Parameters<
            typeof partiallySignTransaction
          >[1];
          const signed = await partiallySignTransaction([nftMint.keyPair], transaction);
          return new Uint8Array(getTransactionEncoder().encode(signed));
        });
        return "done";
      },
      async "final-report"() {
        const fresh = unwrap(await refreshSolanaLaunchReportAction(core()));
        if (fresh.usable) return "done";
        throw new Wait(fresh.retryAfterSeconds ?? 15);
      },
    };

  // The run outlives renders: always call the latest handlers (wallets connect mid-run).
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const runSteps = useCallback(
    async (steps: readonly SolanaLaunchStepId[]) => {
      if (abortRef.current) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      setError(null);
      try {
        for (const step of steps) {
          for (let attempt = 0; !controller.signal.aborted; attempt += 1) {
            const record = stateRef.current?.steps[step];
            if (record?.status === "done" || record?.status === "skipped") break;
            setActiveStep(step);
            if (record?.status !== "submitted") setStep(step, { status: "running" });
            try {
              const outcome = await handlersRef.current[step](controller.signal);
              if (controller.signal.aborted) return;
              setStep(step, { status: outcome, retryAt: undefined });
              if (step === "verify" || step === "final-report") track("builder_launch_completed");
              break;
            } catch (failure) {
              if (failure instanceof Wait && attempt < 400) {
                const status = stateRef.current?.steps[step]?.status;
                if (status !== "submitted") setStep(step, { status: "waiting" });
                await sleep(failure.seconds * 1000, controller.signal);
                continue;
              }
              const code = failure instanceof Wait ? "LAUNCH_TIMEOUT" : codeOf(failure);
              const status = stateRef.current?.steps[step]?.status;
              setStep(step, {
                status: status === "submitted" ? "submitted" : "failed",
                error: code,
              });
              setError(code);
              track("builder_launch_failed", {
                error_code: code,
                error_origin: code === "USER_REJECTED" ? "user" : "app",
              });
              return;
            }
          }
          if (controller.signal.aborted) return;
        }
      } finally {
        abortRef.current = null;
        setBusy(false);
        setActiveStep(null);
      }
    },
    [setStep, track],
  );

  const start = (amounts: SolanaCreationAmounts) => {
    if (!manager || !draft?.review || !plan) {
      setError("SOLANA_DRAFT_UNAVAILABLE");
      return;
    }
    if (!solana.address) {
      setError("SOLANA_WALLET_REQUIRED");
      return;
    }
    if (!stateRef.current) {
      try {
        const initial = initialSolanaLaunch({
          draftId,
          manager,
          solanaKey: solana.address,
          plan,
          review: draft.review,
          amounts,
        });
        saveSolanaLaunch(localStorage, initial);
        stateRef.current = initial;
        setState(initial);
      } catch (failure) {
        setError(codeOf(failure));
        return;
      }
    }
    const current = stateRef.current;
    if (current && !planRef.current && !current.signatures.swapPolicy)
      commit((next) => {
        next.steps.plan = { status: "idle" };
      });
    void runSteps(SOLANA_CREATION_STEPS);
  };

  return {
    draft,
    supported,
    manager,
    state,
    solanaAddress: solana.address,
    solanaCandidates: state ? [] : solana.addresses,
    chooseSolana: (address) => {
      if (!stateRef.current && solana.addresses.includes(address)) setChosenSolana(address);
    },
    solanaBalanceLamports: solana.balanceLamports,
    solanaReady: solana.ready,
    connectSolana: () => {
      try {
        solana.connect();
      } catch (failure) {
        setError(codeOf(failure));
      }
    },
    start,
    runCreation: () => {
      const current = stateRef.current;
      // The typed data lives in memory only: after a reload, unsigned consents need a fresh plan.
      if (
        current &&
        !planRef.current &&
        !current.signatures.swapPolicy &&
        current.steps.plan?.status === "done"
      )
        commit((next) => {
          next.steps.plan = { status: "idle" };
        });
      void runSteps(SOLANA_CREATION_STEPS);
    },
    runOperations: () => void runSteps(SOLANA_OPERATION_STEPS),
    stop: () => abortRef.current?.abort(),
    restartCreation: () => {
      const current = stateRef.current;
      if (!current || creationLanded(current) || abortRef.current) return;
      // Nothing created yet: drop the journal so the amounts and wallets can be chosen again. A seed
      // approve that already landed stays as an allowance and is reused by the next plan.
      try {
        localStorage.removeItem(solanaLaunchKey(current.manager, current.draftId));
      } catch {}
      stateRef.current = null;
      planRef.current = null;
      setState(null);
      setError(null);
    },
    setAmount: (key, raw) => {
      if (!/^\d{1,30}$/.test(raw)) return;
      commit((next) => {
        next.amounts[key] = raw;
      });
    },
    busy,
    evmBlocks,
    activeStep,
    error,
  };
}
