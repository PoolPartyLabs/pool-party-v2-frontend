---
name: wallet-operation-flow
description: Blueprint for building an on-chain wallet operation in the Pool Party frontend (invest, withdraw, collect fees, create pool, move range, etc). The server builds calldata, the client signs and broadcasts, orchestrated as ordered FlowStep[] over useWalletSignFlow. Use when adding or reviewing any flow that signs or sends a transaction. Pairs with server-data-access (the build action) and frontend-security (signing safety).
---

# Wallet operation flow

Every fund-moving action in the app follows one shape: **the server builds the calldata, the client signs and broadcasts it**, sequenced as ordered steps over the `useWalletSignFlow` engine. There are 7 near-identical operation hooks today (`useInvest`, `useWithdraw`, `useCollectFees`, `useCreatePool`, `useMoveRange`, `useManagerCollect`, `useManagerRemoveLiquidity`). New operations follow this blueprint; do not invent a new flow.

## Anatomy (three layers)

```
Modal/host phase machine ──▶ useWalletSignFlow(steps)              [RUNNER]
                                   run() / retry() / reset()
                                        │
   ordered FlowStep[] from useXxx().buildSteps(...)                [CLIENT EXECUTOR HOOK]
     approve ─▶ permit(sign) ─▶ build ─▶ send
        │           │             │        │
   read allowance  signTypedData  │   executeBuiltTransaction(provider, builtTx, owner)
   (viem RPC)      (Privy)        │        eth_sendTransaction + poll receipt
                                  ▼
                    buildXxxTxAction(input) ── "use server" ─▶ apiFetch (server-only)   [SERVER BUILD ACTION]
                                  │  wallet derived from SIWE session, NOT the client
                                  ◀── BuiltTx, validated by builtTxSchema        [TRUST BOUNDARY]
```

Intent + signed permit flow client → server; the server returns calldata; the client signs and sends. The client never builds calldata; the server never holds keys.

## The `FlowStep` contract

`src/lib/tx/useWalletSignFlow.ts`. A step is `{ key: string; run: (ctx) => Promise<FlowStepResult> }`. `run` returns:
- a `Partial<Ctx>` → merged into the accumulating context for later steps;
- `{ txHash }` → records a mined hash (terminal);
- `{ skipped: true }` → status `"skipped"`, advances (the allowance-already-sufficient path);
- `void` → treated as `{}`.

Throwing fails the flow at that step (status `"error"`, `error = toTxError(caught, fallbackCode)`, resume point pinned). Runner semantics: `run()` resets context + index to 0; `retry()` resumes from the failed step (done/skipped steps are **not** re-run, so nothing is re-signed); `reset()` bumps an internal `runId` to cancel any in-flight run. Steps must not mutate `ctx`.

## Canonical hook skeleton

```ts
export function useInvest(): InvestExecutor {
  if (isMockMode) {
    // Mocked: real Privy hooks never run. buildSteps is inert; execute throws.
    return useMemo(() => ({ buildSteps: () => [], execute: async () => {
      throw new TransactionError("Invest is mocked in mock mode");
    } }), []);
  }
  const { wallets } = useWallets();
  const { signTypedData } = useSignTypedData();
  return useMemo(() => {
    function buildSteps(strategy, amountUsd, slippage): FlowStep<InvestCtx>[] {
      return [
        { key: "approve:USDC", run: async () => {
            const chainId = networkToChainId(strategy.network);
            const wallet = wallets[0]; if (!wallet) throw new TransactionError("Wallet not connected");
            await wallet.switchChain(chainId);                 // chain preflight before any sign/send
            const provider = await wallet.getEthereumProvider();
            const ctx = { provider, chainId, owner, spender, usdc, amount };
            const allowance = await readPermit2TokenAllowance(chainId, owner, usdc);
            if (allowance >= amount) return { ...ctx, skipped: true };  // already approved
            await executeBuiltTransaction(provider, buildPermit2ApproveTx(chainId, usdc), owner);
            return ctx; } },
        { key: "permit", run: async (ctx) => {
            const { signature } = await signTypedData(permitTypedData(permit, ctx.chainId), { address: ctx.owner });
            return { permit, signature }; } },
        { key: "build", run: async (ctx) => {
            // PP-INTEGRATION-POINT: calldata from pool-party-api via buildAddLiquidityTxAction (see server-data-access)
            const built = await buildAddLiquidityTxAction({ /* permit + signature + intent */ });
            if (!built) throw new TransactionError("Wallet session not established");
            return { built }; } },
        { key: "confirm:invest", run: async (ctx) =>
            ({ txHash: await executeBuiltTransaction(ctx.provider, ctx.built, ctx.owner) }) },
      ];
    }
    return { buildSteps, execute: /* thin sequential runner over buildSteps */ };
  }, [wallets, signTypedData]);
}
```

Reference: `src/features/strategies/hooks/useInvest.ts`. Variations: `useWithdraw` has no approve/permit (liquidity is already on-chain), build → send only; `useCreatePool` has two approve steps + a permit batch (two tokens) and tick selection.

## Error handling

`TransactionError` (`src/lib/tx/sendTransaction.ts`) wraps provider failures with `cause`; `waitForReceipt` throws on revert (`status 0x0`) and timeout. `toTxError(error, fallbackCode)` (`src/lib/tx/diagnostics.ts`) extracts the provider code (`4001` user-rejected, `-32603` internal) and falls back to a per-operation code. Mapping happens **once**, in the runner's catch, producing the `TxError {code, message}` the error UI renders. `error.message` may go to a copy-to-clipboard affordance, **never** to analytics.

## Built-tx trust boundary (POO-352)

The client signs and broadcasts **whatever the build response parses to**, so the build response is a trust boundary. The server action passes `schema: builtTxSchema` to `apiFetch`; `builtTxSchema` strictly validates `to`/`from` (0x-address), `data` (0x-hex), and `value` (wei) before the calldata ever reaches the client. The wallet prompt is the final value guard; pair it with clear-signing UI (see `frontend-security`).

## Mock mode

`isMockMode` is a build-time constant. The mock branch returns inert `buildSteps: () => []` and a throwing `execute`, so no Privy/wallet hook runs in mock mode (the design/visual harness). Real operation hooks run only in real mode.

## Invariants a reviewer must check

- **`runId` cancellation**: any async branch after an `await` checks the run id; missing it lets a reset/unmount write stale UI.
- **Skip path**: allowance-sufficient returns `{ skipped: true }` (no on-chain write); confirm it isn't conflated with `done`.
- **Never replay writes**: `retry()` resumes from the failed step; done/skipped steps must not re-sign/re-send. One write per step.
- **Chain preflight**: `wallet.switchChain(chainId)` precedes any sign/send, else `-32602`.
- **Server derives the wallet** from the SIWE session, never a client-supplied address.
- **Built-tx validated** by `builtTxSchema` before signing.

## Testing

Mirror `src/features/strategies/hooks/useInvest.test.tsx`: `vi.hoisted()` for a mutable mock bag referenced by `vi.mock` factories; mock Privy + permit2 + the server action; **partial-mock `sendTransaction` via `importOriginal`** so the real `TransactionError` is kept while `executeBuiltTransaction` is stubbed. Assert step effects (approve-then-send vs skip-then-send), and the throw paths (missing config, null build, no wallet). For the engine, cover advance/success, skipped-advance, error + mapped code, `retry()` not re-running done steps, and `reset()` cancellation.

## Anti-patterns

- Building calldata on the client, or trusting a client-supplied wallet address.
- Two writes in one `FlowStep` (breaks safe `retry()`).
- Signing/sending before `switchChain`.
- Defaulting token approvals to unlimited (see `frontend-security`).
- Putting `error.message` (or any raw error) into analytics or the UI body.
- Skipping `builtTxSchema` validation on the build response.
