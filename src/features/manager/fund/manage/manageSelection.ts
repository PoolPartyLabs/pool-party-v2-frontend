/**
 * @id PP-MGR-LIB-067
 * @name manageSelection
 * @implements-rules-version v2 (POO-2274)
 * @analytics-events none, pure layout inspection identity
 *
 * Inspection follows actual graph topology. Only an exact layout positionId can own operations.
 */
import { layoutManageGraph, type ManageLayout, type ManageNode } from "./manageLayout";
import type { ManageChain, ManageModel, ManagePosition } from "./manageModel";

export type ManageInspectionKind =
  | "position"
  | "cash"
  | "idleInput"
  | "idleOutput"
  | "income"
  | "deposit"
  | "withdraw"
  | "swap"
  | "collectFees"
  | "feeSwap"
  | "bridge";

export type ManageInspectableNode = {
  id: string;
  selectionId: string;
  chainId: number;
  position: ManagePosition | null;
} & (
  | { kind: "bridge"; direction?: "inbound" | "outbound" }
  | { kind: Exclude<ManageInspectionKind, "bridge">; direction?: undefined }
);

export interface ManageInspectionNetwork {
  chainId: number;
  name: string;
  network: ManageChain["network"];
  hub: boolean;
  nodes: ManageInspectableNode[];
}
export interface ManageInspectionSnapshot {
  nodes: ManageInspectableNode[];
  networks: ManageInspectionNetwork[];
}

function inspectNode(model: ManageModel, node: ManageNode): ManageInspectableNode {
  if (node.kind === "group") throw new Error("Decorative groups cannot be inspected");
  const chainId = node.chainId ?? model.hubChainId;
  const position = node.positionId
    ? (model.positions.find(
        (position) => position.id === node.positionId && position.chainId === chainId,
      ) ?? null)
    : null;
  const identity = {
    id: node.id,
    selectionId: node.kind === "position" && position ? position.id : node.id,
    chainId,
    position,
  };
  if (node.kind === "flow") {
    return node.flow === "bridge"
      ? { ...identity, kind: "bridge", direction: node.direction }
      : { ...identity, kind: node.flow };
  }
  return {
    ...identity,
    kind:
      node.kind === "idle" ? "idleInput" : node.kind === "withdrawal" ? "idleOutput" : node.kind,
  };
}

function topologyRank(node: ManageInspectableNode, hub: boolean): number {
  if (hub) {
    if (node.kind === "deposit") return 0;
    if (node.kind === "idleInput") return 1;
    if (node.kind === "cash") return 2;
    if (node.kind === "idleOutput") return 4;
    if (node.kind === "income") return 5;
    if (node.kind === "withdraw") return 6;
    return 3;
  }
  if (node.kind === "bridge" && node.direction === "inbound") return 0;
  if (node.kind === "idleInput") return 1;
  if (node.kind === "cash") return 2;
  if (node.kind === "bridge" && node.direction === "outbound") return 4;
  return 3;
}

export function deriveManageInspection(
  model: ManageModel,
  layout: ManageLayout = layoutManageGraph(model),
): ManageInspectionSnapshot {
  const actual = layout.nodes
    .filter((node) => node.kind !== "group")
    .map((node) => inspectNode(model, node));
  const networks = [...model.chains]
    .sort((left, right) => Number(right.hub) - Number(left.hub))
    .map((chain) => ({
      chainId: chain.chainId,
      name: chain.name,
      network: chain.network,
      hub: chain.hub,
      nodes: actual
        .filter((node) => node.chainId === chain.chainId)
        .sort((left, right) => topologyRank(left, chain.hub) - topologyRank(right, chain.hub)),
    }));
  return { nodes: networks.flatMap((network) => network.nodes), networks };
}

export function resolveManageInspection(
  snapshot: ManageInspectionSnapshot,
  selectionId: string | null,
): ManageInspectableNode | null {
  return snapshot.nodes.find((node) => node.selectionId === selectionId) ?? null;
}

export const manageInspectionLabelKey = {
  cash: "operatingCash",
  idleInput: "idleInput",
  idleOutput: "idleOutput",
  income: "income",
  deposit: "inspection.deposit",
  withdraw: "inspection.withdraw",
  swap: "inspection.swap",
  collectFees: "inspection.collectFees",
  feeSwap: "inspection.feeSwap",
  bridge: "inspection.bridge",
} as const;
