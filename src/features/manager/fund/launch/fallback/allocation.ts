/**
 * @id PP-MGR-LIB-049 (POO-2183)
 * @name fallbackAllocations
 * @implements-rules-version v1
 */
import type { FundLaunchDraft } from "../contracts";
import type { CanvasChain } from "../plan";

export interface AllocationEdits {
  chains?: Record<string, number>;
  leaves?: Record<string, number>;
}

function percent(value: number | undefined): number {
  if (value === undefined) throw new Error("INVALID_ALLOCATION");
  if (!Number.isInteger(value) || value < 0 || value > 100) throw new Error("INVALID_ALLOCATION");
  return value;
}

function split(total: number, ids: string[]) {
  percent(total);
  if (!ids.length) {
    return {};
  }
  const each = Math.floor(total / ids.length);
  return Object.fromEntries(
    ids.map((id, index) => [id, each + (index === 0 ? total % ids.length : 0)]),
  );
}

export function fallbackAllocations(
  draft: FundLaunchDraft,
  edits: AllocationEdits = {},
  validate = true,
) {
  const chains: Record<string, number> = {};
  const leaves: Record<string, number> = {};
  const readOnlyChains = new Set<string>();
  const readOnlyLeaves = new Set<string>();
  const spokes = draft.plan.spokes.map((spoke) => {
    if (spoke.network !== "robinhood") throw new Error("INVALID_ALLOCATION");
    if (spoke.sharePct !== undefined && spoke.sharePct !== 0) percent(spoke.sharePct);
    if (spoke.sharePct === 0 && spoke.chains.length === 0)
      return { network: spoke.network, sharePct: 0 };
    const mandate = draft.spokeCapPercent ?? draft.v2Selection?.spokeCapPercent;
    const cap = draft.caps?.networks.robinhood;
    const networkShare = mandate ?? (cap && !cap.noCap ? cap.pct : undefined);
    const sharePct =
      spoke.sharePct > 0
        ? percent(spoke.sharePct)
        : networkShare === undefined
          ? (() => {
              throw new Error("INVALID_ALLOCATION");
            })()
          : percent(networkShare);
    return { network: spoke.network, sharePct };
  });
  const spokeTotal = spokes.reduce((sum, spoke) => sum + spoke.sharePct, 0);
  if (spokeTotal > 100) throw new Error("INVALID_ALLOCATION");
  const allocateChains = (entries: CanvasChain[], budget: number) => {
    const written = entries.filter((chain) => chain.sharePct !== undefined && chain.sharePct !== 0);
    const missing = entries.filter((chain) => chain.sharePct === undefined || chain.sharePct === 0);
    const used = written.reduce((sum, chain) => sum + percent(chain.sharePct), 0);
    const defaults = split(
      budget - used,
      missing.map((chain) => chain.id),
    );
    for (const chain of entries) {
      const panel = chain.sharePct !== undefined && chain.sharePct !== 0;
      if (panel) readOnlyChains.add(chain.id);
      const share = percent(
        panel ? chain.sharePct : (edits.chains?.[chain.id] ?? defaults[chain.id]),
      );
      if (share <= 0) throw new Error("INVALID_ALLOCATION");
      chains[chain.id] = share;
      const positions = chain.steps.filter((block) => block.family === "position");
      if (!positions.length) throw new Error("INVALID_ALLOCATION");
      const writtenLeaves = positions.filter(
        (block) => (draft.launchExecution?.[block.id]?.leafSharePct ?? 0) !== 0,
      );
      const missingLeaves = positions.filter(
        (block) => (draft.launchExecution?.[block.id]?.leafSharePct ?? 0) === 0,
      );
      const leafUsed = writtenLeaves.reduce(
        (sum, block) => sum + percent(draft.launchExecution?.[block.id]?.leafSharePct ?? 0),
        0,
      );
      const leafDefaults = split(
        100 - leafUsed,
        missingLeaves.map((block) => block.id),
      );
      for (const block of positions) {
        const saved = draft.launchExecution?.[block.id]?.leafSharePct;
        const panelLeaf = saved !== undefined && saved !== 0;
        if (panelLeaf) readOnlyLeaves.add(block.id);
        const leaf = percent(
          panelLeaf ? saved : (edits.leaves?.[block.id] ?? leafDefaults[block.id]),
        );
        if (leaf <= 0 || (validate && !Number.isInteger((share * leaf) / 100)))
          throw new Error("INVALID_ALLOCATION");
        leaves[block.id] = leaf;
      }
      if (validate && positions.reduce((sum, block) => sum + percent(leaves[block.id]), 0) !== 100)
        throw new Error("INVALID_ALLOCATION");
    }
    if (validate && entries.reduce((sum, chain) => sum + percent(chains[chain.id]), 0) > budget)
      throw new Error("INVALID_ALLOCATION");
  };
  allocateChains(draft.plan.hub.chains, 100 - spokeTotal);
  draft.plan.spokes.forEach((spoke, index) => {
    allocateChains(spoke.chains, percent(spokes[index]?.sharePct));
  });
  return { chains, leaves, spokes, readOnlyChains, readOnlyLeaves };
}
