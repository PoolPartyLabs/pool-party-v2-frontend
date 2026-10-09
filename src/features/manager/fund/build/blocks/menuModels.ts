/**
 * @id PP-MGR-LIB-024
 * @name menuModels
 * @implements-rules-version v1 (POO-2155 rules v1)
 * @implements-rules-version v1 (POO-2301 shared local runtime extension)
 * @analytics-events none, a pure module. A choice, a refusal and a drop are reported by
 *   `useBuildCanvas` through `onEvent`; the Build screen (PP-MGR-SCR-002, S7) maps them to events.
 *
 * The three menus of the Build canvas as DATA (handoff v1.2 I1, I2, I4 and the "Menu" block), the
 * sentence the panel stub shows while one is open (AN10), and the palette drop targets (I3). The
 * `CanvasMenu` component draws a {@link MenuModel}; it decides nothing.
 *
 * Legality comes from S1 and only from S1: the Add protocol menu asks `kindAvailability`, the port
 * menu asks `insertOptions` (the I4 list, D1), and every option carries the {@link MenuAction} the
 * controller turns into the S1 reducer. A palette drop resolves to the SAME action as the menu row
 * for that slot (I3: "dropping has the same result as choosing the option in the menu").
 *
 * C6 and C22 disagree with A4 on the coming-soon rows (D12): they are a fixed product list shown
 * disabled on every network, never adding anything, so A4 holds for every ENABLED option.
 */

import type { MandateCatalog } from "../../mandateCatalog";
import { HUB_NETWORK, NETWORK_ORDER, type NetworkId } from "../../mandateDraft";
import type { GraphTarget } from "../layout/graphTypes";
import type { BlockKind, PlanBlockReason } from "../plan/buildPlan";
import { chainsWithNetwork, findBlock } from "../plan/planDerive";
import {
  type InsertChoice,
  type InsertSlot,
  insertOptions,
  kindAvailability,
  portSlotsOf,
  toPortStepShape,
} from "../plan/planRules";
import {
  BLOCK_KINDS,
  BLOCK_REGISTRY,
  type DescribeContext,
  describeBlock,
  type PaletteDragItem,
} from "./blockRegistry";

/** What choosing an option (or dropping on a target) does: one S1 reducer. */
export type MenuAction =
  | { kind: "addChain"; network: NetworkId; blockKind: BlockKind }
  | { kind: "addSpoke"; network: NetworkId }
  | { kind: "insert"; slot: InsertSlot; choice: InsertChoice };

/** One row of a menu. */
export interface MenuOption {
  id: string;
  /** Body/Medium: "Uniswap v4", "Robinhood Chain", "Swap". */
  name: string;
  /** Caption/Default: the block type, "spoke · adds a bridge", or the disabled reason. */
  caption: string;
  /** Which family of mark the row draws. */
  logo: "protocol" | "network" | "flow";
  /**
   * The mark's subject: a block kind (protocol), a network id (network) or a flow kind (flow). An
   * addition to plan section 3.5: a disabled row has no action to read its logo from.
   */
  markId: string;
  /** 40% opacity, its reason as the caption; choosing it reports `blocked` and adds nothing. */
  disabled: boolean;
  blockedReason: PlanBlockReason | null;
  /** Null exactly when disabled. */
  action: MenuAction | null;
}

/** A whole menu. */
export interface MenuModel {
  /** Natural case; the capitals are CSS. */
  title: string;
  options: MenuOption[];
  /** One sentence above the link, or null. */
  footer: string | null;
  /** The sentence that replaces the options when nothing is available (I1). */
  emptySentence: string | null;
  /** C6: back to Mandate step 2 (protocols) or step 1 (networks). */
  link: { label: string; mandateStep: "networks" | "protocols" };
}

/** What a menu model reads: the describe context plus the catalog (`kindAvailability`). */
export interface MenuContext extends DescribeContext {
  catalog: MandateCatalog;
}

/** Whether a row exists for this network and the mandate still holds it (C6). */
function rowInMandate(network: NetworkId, ctx: MenuContext): boolean {
  return network === HUB_NETWORK || ctx.draft.networks.includes(network);
}

/**
 * I1, C6, C22, ST2: the Add protocol menu of a row. Enabled options first (the new-chain kinds the
 * mandate offers on that network), then "Aave v3 · Borrow" disabled (only where Aave v3 is in the
 * mandate and offered on that network, C14), then the coming-soon rows (every network). With no
 * enabled option, the sentence and the link only.
 */
export function protocolMenuModel(network: NetworkId, ctx: MenuContext): MenuModel {
  const { copy } = ctx;
  const networkName = copy.networkName(network);
  const link = { label: copy.menu.linkProtocols, mandateStep: "protocols" as const };
  const available = (kind: BlockKind) =>
    rowInMandate(network, ctx) && kindAvailability(kind, network, ctx) === "enabled";

  const enabled: MenuOption[] = BLOCK_KINDS.filter(
    (kind) => BLOCK_REGISTRY[kind].placement === "newChain" && available(kind),
  ).map((kind) => ({
    id: `addChain:${network}:${kind}`,
    name: copy.protocolName(kind),
    caption: copy.blockType(kind),
    logo: "protocol",
    markId: kind,
    disabled: false,
    blockedReason: null,
    action: { kind: "addChain", network, blockKind: kind },
  }));
  if (enabled.length === 0) {
    return {
      title: copy.menu.protocolsTitle(networkName),
      options: [],
      footer: null,
      emptySentence: copy.menu.protocolsNone(networkName),
      link,
    };
  }
  const underSupply: MenuOption[] = BLOCK_KINDS.filter(
    (kind) => BLOCK_REGISTRY[kind].placement === "afterSupply" && available(kind),
  ).map((kind) => ({
    id: `addChain:${network}:${kind}`,
    name: copy.protocolName(kind),
    caption: copy.menu.borrowDisabled,
    logo: "protocol",
    markId: kind,
    disabled: true,
    blockedReason: "borrow_needs_supply",
    action: null,
  }));
  const comingSoon: MenuOption[] = BLOCK_KINDS.filter(
    (kind) => BLOCK_REGISTRY[kind].status === "comingSoon",
  ).map((kind) => ({
    id: `addChain:${network}:${kind}`,
    name: copy.protocolName(kind),
    caption: copy.menu.comingSoonType(copy.blockType(kind)),
    logo: "protocol",
    markId: kind,
    disabled: true,
    blockedReason: "coming_soon",
    action: null,
  }));
  return {
    title: copy.menu.protocolsTitle(networkName),
    options: [...enabled, ...underSupply, ...comingSoon],
    footer: copy.menu.protocolsFooter(networkName),
    emptySentence: null,
    link,
  };
}

/**
 * I2, ST3, D4: the Add network menu. The mandate networks minus the hub minus those on the canvas,
 * in catalog order. The footer names the networks already placed; with none left and none placed it
 * says the mandate has no other network (D4). The box itself stays (open point 4).
 */
export function networkMenuModel(ctx: MenuContext): MenuModel {
  const { copy, plan, draft } = ctx;
  const placed = plan.spokes.map((spoke) => spoke.network);
  const options: MenuOption[] = NETWORK_ORDER.filter(
    (network) =>
      network !== HUB_NETWORK && draft.networks.includes(network) && !placed.includes(network),
  ).map((network) => ({
    id: `addSpoke:${network}`,
    name: copy.networkName(network),
    caption: copy.menu.networksOption,
    logo: "network",
    markId: network,
    disabled: false,
    blockedReason: null,
    action: { kind: "addSpoke", network },
  }));
  const footer =
    placed.length > 0
      ? copy.menu.networksPlaced(
          copy.listNames(placed.map((n) => copy.networkName(n))),
          placed.length,
        )
      : options.length === 0
        ? copy.menu.networksNone
        : null;
  return {
    title: copy.menu.networksTitle,
    options,
    footer,
    emptySentence: null,
    link: { label: copy.menu.linkNetworks, mandateStep: "networks" },
  };
}

/** The row of an insert choice, or null when the mandate does not offer it there (C6). */
function insertOption(
  slot: InsertSlot,
  choice: InsertChoice,
  network: NetworkId,
  ctx: MenuContext,
): MenuOption | null {
  const { copy } = ctx;
  const id = `insert:${slot.side}:${slot.blockId}:${choice.kind}`;
  if (choice.family === "flow") {
    const jupiter =
      choice.kind === "swap" && network === "solana" && ctx.draft.runtime === "solana-local";
    if (jupiter && !ctx.draft.protocols.includes("jupiter")) return null;
    return {
      id,
      name:
        choice.kind === "swap"
          ? jupiter
            ? (copy.flow.jupiter ?? copy.flow.swap)
            : copy.flow.swap
          : copy.flow.collectFees,
      caption: copy.menu.portFlowOption,
      logo: "flow",
      markId: jupiter ? "jupiter" : choice.kind,
      disabled: false,
      blockedReason: null,
      action: { kind: "insert", slot, choice },
    };
  }
  const availability = kindAvailability(choice.kind, network, ctx);
  if (availability === "coming_soon") {
    return {
      id,
      name: copy.protocolName(choice.kind),
      caption: copy.menu.comingSoonType(copy.blockType(choice.kind)),
      logo: "protocol",
      markId: choice.kind,
      disabled: true,
      blockedReason: "coming_soon",
      action: null,
    };
  }
  if (availability !== "enabled") return null;
  return {
    id,
    name: copy.protocolName(choice.kind),
    caption: copy.menu.portBorrowOption,
    logo: "protocol",
    markId: choice.kind,
    disabled: false,
    blockedReason: null,
    action: { kind: "insert", slot, choice },
  };
}

/**
 * I4, ST4, D1: the menu of an insert port, titled "Before {title}" or "After {title}" with the
 * card's own title, listing `insertOptions(slot)` (Borrow first after a Supply, as drawn). A slot
 * with no port lists nothing; the controller does not open it.
 */
export function portMenuModel(slot: InsertSlot, ctx: MenuContext): MenuModel {
  const { copy, plan } = ctx;
  const found = findBlock(plan, slot.blockId);
  const title = describeBlock(slot.blockId, ctx).title;
  const options = found
    ? insertOptions(plan, slot)
        .map((choice) => insertOption(slot, choice, found.network, ctx))
        .filter((option): option is MenuOption => option !== null)
    : [];
  const afterSupply =
    slot.side === "after" &&
    found?.block.family === "position" &&
    found.block.kind === "aaveSupply";
  return {
    title: slot.side === "before" ? copy.menu.portBefore(title) : copy.menu.portAfter(title),
    options,
    footer: afterSupply ? copy.menu.portFooterAfterSupply : copy.menu.portFooter,
    emptySentence: null,
    link: { label: copy.menu.linkProtocols, mandateStep: "protocols" },
  };
}

/** The menu a target opens, or null for a target that opens none (a card, a share label). */
export function menuModelFor(target: GraphTarget, ctx: MenuContext): MenuModel | null {
  if (target.kind === "addProtocol") return protocolMenuModel(target.network as NetworkId, ctx);
  if (target.kind === "addNetwork") return networkMenuModel(ctx);
  if (target.kind === "port") {
    return portMenuModel({ side: target.side, blockId: target.blockId }, ctx);
  }
  return null;
}

/**
 * AN10: what the panel stub says while a menu is open. The Add protocol menu names the network the
 * block lands on; a port menu after a Supply uses the Figma sentence (8181-2110), the others the
 * coordinator's; the Add network menu has the coordinator's parallel sentence (review F3 of PR #36,
 * waiting for the product owner's confirmation). A target with no menu has none.
 */
export function menuOpenSentence(target: GraphTarget, ctx: MenuContext): string | null {
  const { copy } = ctx;
  if (target.kind === "addProtocol") return copy.panel.menuOpen(copy.networkName(target.network));
  if (target.kind === "addNetwork") return copy.panel.menuOpenNetwork;
  if (target.kind !== "port") return null;
  const title = describeBlock(target.blockId, ctx).title;
  if (target.side === "before") return copy.panel.portMenuOpenBefore(title);
  const found = findBlock(ctx.plan, target.blockId);
  const afterSupply = found?.block.family === "position" && found.block.kind === "aaveSupply";
  return afterSupply ? copy.panel.portMenuOpenSupply(title) : copy.panel.portMenuOpenAfter(title);
}

/** Every insert slot of the plan that has a port (C17), hub first, then the spokes. */
function portSlots(ctx: MenuContext): Array<{ slot: InsertSlot; network: NetworkId }> {
  const out: Array<{ slot: InsertSlot; network: NetworkId }> = [];
  for (const { chain, network } of chainsWithNetwork(ctx.plan)) {
    for (const port of portSlotsOf(chain.steps.map(toPortStepShape))) {
      const blockId = chain.steps[port.index]?.id;
      if (!blockId) continue;
      if (port.top) out.push({ slot: { side: "before", blockId }, network });
      if (port.bottom) out.push({ slot: { side: "after", blockId }, network });
    }
  }
  return out;
}

/** A valid drop target and what dropping there does. */
export interface DropTarget {
  target: GraphTarget;
  action: MenuAction;
}

/**
 * I3, ST10, D22: the targets a dragged palette row may drop on, each with the menu action it
 * applies. A new-chain kind: every row's Add protocol circle where it is available. A Borrow: the
 * bottom port of a configured Supply. Swap and Collect fees: the ports whose `insertOptions` offer
 * them. A coming-soon kind: none.
 */
export function dropTargets(item: PaletteDragItem, ctx: MenuContext): DropTarget[] {
  if (item.family === "position" && BLOCK_REGISTRY[item.kind].placement === "newChain") {
    const networks: NetworkId[] = [HUB_NETWORK, ...ctx.plan.spokes.map((s) => s.network)];
    return networks
      .filter(
        (network) =>
          rowInMandate(network, ctx) && kindAvailability(item.kind, network, ctx) === "enabled",
      )
      .map((network) => ({
        target: { kind: "addProtocol", network },
        action: { kind: "addChain", network, blockKind: item.kind },
      }));
  }
  const out: DropTarget[] = [];
  for (const { slot, network } of portSlots(ctx)) {
    if (item.family === "flow" && item.network && item.network !== network) continue;
    if (
      item.family === "flow" &&
      item.kind === "swap" &&
      network === "solana" &&
      ctx.draft.runtime === "solana-local" &&
      !ctx.draft.protocols.includes("jupiter")
    )
      continue;
    const option = insertOptions(ctx.plan, slot).find(
      (choice) => choice.family === item.family && choice.kind === item.kind,
    );
    if (!option) continue;
    if (option.family === "position" && kindAvailability(option.kind, network, ctx) !== "enabled") {
      continue;
    }
    out.push({
      target: { kind: "port", side: slot.side, blockId: slot.blockId },
      action: { kind: "insert", slot, choice: option },
    });
  }
  return out;
}
