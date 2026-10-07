/**
 * @id PP-MGR-CMP-091 (POO-2272)
 * @name ManageBlockHeader
 * @implements-rules-version v2
 * @analytics-events none, presentational identity; ManageScreen and operation hosts own events.
 * Protocol/subtitle identity and the network of the selected Manage origin.
 */
"use client";

import { useTranslations } from "next-intl";
import { NetworkLogo } from "@/components/data-display/NetworkLogo";
import { cn } from "@/lib/utils/cn";
import { BlockMark } from "../build/blocks/BlockMark";
import { type ManagePosition, manageProtocolMark } from "./manageModel";

/** Public props for the inline identity header. */
export interface ManageBlockHeaderProps {
  /** Canonical position origin already resolved by the Manage host. */
  position: ManagePosition;
  /** An operation may supply the selected pair without changing the canonical origin. */
  subtitle?: string;
  /** Optional class names supplied by the inline panel. */
  className?: string;
}

export function ManageBlockHeader({ position, subtitle, className }: ManageBlockHeaderProps) {
  const t = useTranslations("manager.manageV2");
  const networkName =
    position.network === "arbitrum"
      ? "Arbitrum"
      : position.network === "robinhood"
        ? "Robinhood"
        : position.network;
  const description =
    subtitle ??
    t(
      position.kind === "supply"
        ? "supplyType"
        : position.kind === "liquidity"
          ? "liquidityType"
          : "notAvailable",
    );

  return (
    <header className={cn("flex min-w-0 flex-wrap items-center gap-3", className)}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <BlockMark
          logo="protocol"
          markId={manageProtocolMark(position.source.adapterKind)}
          name={position.protocol}
          size={28}
        />
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <p className="font-semibold text-sm">{position.protocol}</p>
          <p className="text-muted-foreground text-xs">{description}</p>
        </div>
      </div>
      <div className="flex max-w-full items-center gap-1.5 rounded-lg bg-surface-raised p-1.5 text-xs">
        <NetworkLogo network={position.network} name={networkName} size={18} />
        <span className="min-w-0 [overflow-wrap:anywhere]">{networkName}</span>
      </div>
    </header>
  );
}
