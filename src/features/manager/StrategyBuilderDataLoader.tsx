/**
 * @id PP-MGR-SCR-002 (POO-701)
 * @name Strategy-builder data loader
 * @implements-rules-version v1
 *
 * Real-mode client boundary for the strategy builder (POO-701 [R3]). It injects the logo upload
 * (`useUploadMedia("logo")` — a manager-scoped PRE-ID mint with NO strategyId, since the strategy
 * does not exist yet) into the presentational {@link StrategyBuilderScreen} so the Review step's
 * crop-apply mints (SIWE session-authorized, NO wallet signature since POO-707 [R2]) + uploads to S3
 * and stages the trusted https URL into the single create POST.
 * Mirrors `PersonalInfoDataLoader` / `ManagerConsoleDataLoader`: used only when `isMockMode` is false;
 * mock mode renders `StrategyBuilderScreen` directly with no upload fn (the crop stays a session-local
 * preview). Safe to call the Privy-backed hook here — this loader only ever mounts in real mode.
 */
"use client";

import { useUploadMedia } from "@/lib/media/useUploadMedia";
import type { FeePolicy, UniswapPool } from "@/lib/schemas";
import { StrategyBuilderScreen } from "./StrategyBuilderScreen";

/** Public props for {@link StrategyBuilderDataLoader}. */
export interface StrategyBuilderDataLoaderProps {
  /** The Uniswap v3 pool catalog for the Mandate step's pool picker (read server-side). */
  pools: UniswapPool[];
  /** Pool Party's AUM-tiered cut, shown read-only on the Review step. */
  feePolicy: FeePolicy;
}

/** Renders the strategy builder wired to the real (session-authorized, POO-707) logo upload (POO-701). */
export function StrategyBuilderDataLoader({ pools, feePolicy }: StrategyBuilderDataLoaderProps) {
  // POO-701 [R1]/[R3]: pre-id logo mint — no strategyId (the strategy is created AFTER the upload, so
  // the https URL rides into the single create POST). Mirrors the avatar/banner injection in
  // ManagerConsoleDataLoader.
  const uploadLogo = useUploadMedia("logo");
  return <StrategyBuilderScreen pools={pools} feePolicy={feePolicy} onUploadLogo={uploadLogo} />;
}
