/**
 * @id PP-MGR-LIB-024
 * @name menuModels tests
 * @implements-rules-version v1 (POO-2155 rules v1)
 * @analytics-events none, a pure module under test
 *
 * The three canvas menus as data (slice S5, POO-2155): Add protocol (I1, C6, C22, ST2), Add network
 * (I2, ST3, D4), the insert port (I4, ST4, D1); the panel sentence while one is open (AN10); and the
 * palette drop targets (I3, D22), which apply the same reducer as the menus. A4 is read as "every
 * ENABLED option passes the S1 rules" (D12) and is proven by running each option's reducer.
 */
import { describe, expect, it } from "vitest";
import type { MandateDraft, NetworkId } from "../../mandateDraft";
import { targetKey } from "../layout/graphTypes";
import { type BuildPlan, createEmptyPlan, isPlanBlocked } from "../plan/buildPlan";
import { addChain, addSpoke, insertAt } from "../plan/planReducers";
import { kindAvailability } from "../plan/planRules";
import {
  emptySpokePlan,
  hubPoolPlan,
  hubPoolWithFeesPlan,
  hubSupplyPlan,
  makeTestContext,
  makeTestDraft,
  spokePoolPlan,
  supplyBorrowPlan,
  VALID_TEST_PLANS,
} from "../plan/planTestKit";
import { makeDescribeContext, TEST_CATALOG } from "./blockTestKit";
import {
  dropTargets,
  type MenuAction,
  type MenuModel,
  menuOpenSentence,
  networkMenuModel,
  portMenuModel,
  protocolMenuModel,
} from "./menuModels";

function rows(model: MenuModel) {
  return model.options.map((o) => [o.name, o.caption, o.disabled]);
}

/** Apply a menu action's reducer: the same call the controller makes. */
function run(plan: BuildPlan, action: MenuAction, draft: MandateDraft = makeTestDraft()) {
  const ctx = makeTestContext(draft);
  if (action.kind === "addChain") return addChain(plan, ctx, action.network, action.blockKind);
  if (action.kind === "addSpoke") return addSpoke(plan, ctx, action.network);
  return insertAt(plan, ctx, action.slot, action.choice);
}

const DRAFT_NO_AAVE: MandateDraft = {
  ...makeTestDraft(),
  protocols: ["uniswap-v3-swap", "across", "uniswap-v4"],
};
const DRAFT_HUB_ONLY_REQUIRED: MandateDraft = {
  ...makeTestDraft(),
  networks: ["arbitrum"],
  protocols: ["uniswap-v3-swap", "across"],
};

describe("protocolMenuModel", () => {
  it("lists the enabled options first, then the disabled Borrow, then the coming-soon rows", () => {
    // @rule I1
    // @rule ST2
    // @rule C22
    const model = protocolMenuModel("arbitrum", makeDescribeContext(createEmptyPlan()));
    expect(model.title).toBe("Protocols on Arbitrum");
    expect(rows(model)).toEqual([
      ["Uniswap v4", "Liquidity position", false],
      ["Aave v3", "Supply", false],
      ["Aave v3", "Borrow · add it under a Supply block", true],
      ["Uniswap v3", "Liquidity position · coming soon", true],
      ["Pendle", "Yield position · coming soon", true],
      ["GMX", "Perp position · coming soon", true],
    ]);
    expect(model.footer).toBe("Protocols of your mandate on Arbitrum.");
    expect(model.emptySentence).toBeNull();
    expect(model.link).toEqual({ label: "Edit mandate · Protocols", mandateStep: "protocols" });
  });

  it("gives every disabled row its reason and no action", () => {
    // @rule I1
    const model = protocolMenuModel("arbitrum", makeDescribeContext(createEmptyPlan()));
    const disabled = model.options.filter((o) => o.disabled);
    expect(disabled.map((o) => o.blockedReason)).toEqual([
      "borrow_needs_supply",
      "coming_soon",
      "coming_soon",
      "coming_soon",
    ]);
    for (const option of disabled) expect(option.action).toBeNull();
  });

  it("leaves Borrow out on Robinhood Chain, where Aave v3 is not offered", () => {
    // @rule I1
    // @rule C6
    const model = protocolMenuModel("robinhood", makeDescribeContext(emptySpokePlan()));
    expect(model.title).toBe("Protocols on Robinhood Chain");
    expect(rows(model)).toEqual([
      ["Uniswap v4", "Liquidity position", false],
      ["Uniswap v3", "Liquidity position · coming soon", true],
      ["Pendle", "Yield position · coming soon", true],
      ["GMX", "Perp position · coming soon", true],
    ]);
  });

  it("leaves Aave out entirely when it is not in the mandate", () => {
    // @rule C6
    const model = protocolMenuModel(
      "arbitrum",
      makeDescribeContext(createEmptyPlan(), DRAFT_NO_AAVE),
    );
    expect(model.options.map((o) => o.markId)).toEqual([
      "uniswapV4Pool",
      "uniswapV3Pool",
      "pendle",
      "gmxPerp",
    ]);
  });

  it("shows only the sentence and the link when nothing of the mandate is available there", () => {
    // @rule I1
    const model = protocolMenuModel(
      "arbitrum",
      makeDescribeContext(createEmptyPlan(), DRAFT_HUB_ONLY_REQUIRED),
    );
    expect(model.options).toEqual([]);
    expect(model.footer).toBeNull();
    expect(model.emptySentence).toBe("No protocol of your mandate is available on Arbitrum.");
    expect(model.link.mandateStep).toBe("protocols");
  });

  it("adds a chain of that kind on that network when an enabled option is chosen", () => {
    // @rule I1
    const model = protocolMenuModel("arbitrum", makeDescribeContext(createEmptyPlan()));
    expect(model.options[0]?.action).toEqual({
      kind: "addChain",
      network: "arbitrum",
      blockKind: "uniswapV4Pool",
    });
    expect(model.options[0]?.logo).toBe("protocol");
  });
});

describe("networkMenuModel", () => {
  it("lists the mandate networks that are neither the hub nor on the canvas", () => {
    // @rule I2
    // @rule ST3
    const model = networkMenuModel(makeDescribeContext(createEmptyPlan()));
    expect(model.title).toBe("Networks from your mandate");
    expect(rows(model)).toEqual([["Robinhood Chain", "spoke · adds a bridge", false]]);
    expect(model.options[0]?.action).toEqual({ kind: "addSpoke", network: "robinhood" });
    expect(model.options[0]?.logo).toBe("network");
    expect(model.footer).toBeNull();
    expect(model.link).toEqual({ label: "Edit mandate · Networks", mandateStep: "networks" });
  });

  it("names the networks already on the canvas and keeps only the footer when none is left", () => {
    // @rule I2
    // @rule D4
    const model = networkMenuModel(makeDescribeContext(emptySpokePlan()));
    expect(model.options).toEqual([]);
    // Review F2: one network placed reads in the singular.
    expect(model.footer).toBe("Robinhood Chain is already on the canvas.");
    expect(model.emptySentence).toBeNull();
  });

  it("says the mandate has no other network when it holds the hub only", () => {
    // @rule D4
    const model = networkMenuModel(
      makeDescribeContext(createEmptyPlan(), { ...makeTestDraft(), networks: ["arbitrum"] }),
    );
    expect(model.options).toEqual([]);
    expect(model.footer).toBe("Your mandate has no other network.");
  });

  it("joins several placed networks with the locale's conjunction, in the plural", () => {
    // @rule I2
    const ctx = makeDescribeContext(emptySpokePlan());
    expect(ctx.copy.menu.networksPlaced(ctx.copy.listNames(["Base", "Robinhood Chain"]), 2)).toBe(
      "Base and Robinhood Chain are already on the canvas.",
    );
  });
});

describe("portMenuModel", () => {
  it("offers Swap before a card", () => {
    // @rule I4
    // @rule ST4
    const model = portMenuModel(
      { side: "before", blockId: "hub-supply-supply" },
      makeDescribeContext(hubSupplyPlan()),
    );
    expect(model.title).toBe("Before Supply USDC");
    expect(rows(model)).toEqual([["Swap", "Flow block", false]]);
    expect(model.footer).toBe("Blocks of your mandate that fit here.");
    expect(model.link.mandateStep).toBe("protocols");
  });

  it("offers Collect fees after a pool", () => {
    // @rule I4
    const model = portMenuModel(
      { side: "after", blockId: "hub-pool-pool" },
      makeDescribeContext(hubPoolPlan()),
    );
    expect(model.title).toBe("After WETH / USDC");
    expect(rows(model)).toEqual([["Collect fees", "Flow block", false]]);
    expect(model.options[0]?.action).toEqual({
      kind: "insert",
      slot: { side: "after", blockId: "hub-pool-pool" },
      choice: { family: "flow", kind: "collectFees" },
    });
  });

  it("offers Borrow against this supply and Swap after a Supply, as drawn (8181-2110)", () => {
    // @rule I4
    // @rule ST4
    const model = portMenuModel(
      { side: "after", blockId: "hub-supply-supply" },
      makeDescribeContext(hubSupplyPlan()),
    );
    expect(model.title).toBe("After Supply USDC");
    expect(rows(model)).toEqual([
      ["Aave v3", "Borrow against this supply", false],
      ["Swap", "Flow block", false],
    ]);
    expect(model.options.map((o) => o.logo)).toEqual(["protocol", "flow"]);
    expect(model.footer).toBe("Blocks of your mandate that fit after this supply.");
  });

  it("offers Swap after a Borrow", () => {
    // @rule I4
    // @rule C13
    const model = portMenuModel(
      { side: "after", blockId: "hub-aave-borrow" },
      makeDescribeContext(supplyBorrowPlan()),
    );
    expect(rows(model)).toEqual([["Swap", "Flow block", false]]);
  });

  it("offers nothing on a slot that has no port", () => {
    // @rule D1
    const model = portMenuModel(
      { side: "before", blockId: "hub-pool-pool" },
      makeDescribeContext(hubPoolPlan()),
    );
    expect(model.options).toEqual([]);
  });
});

describe("A4: every enabled option passes the S1 rules", () => {
  const drafts: Record<string, MandateDraft> = {
    full: makeTestDraft(),
    noAave: DRAFT_NO_AAVE,
    requiredOnly: DRAFT_HUB_ONLY_REQUIRED,
  };

  it("never offers an enabled option whose reducer refuses, on any test plan and mandate", () => {
    // @rule A4
    // @rule C6
    let checked = 0;
    for (const [draftName, draft] of Object.entries(drafts)) {
      for (const [planName, build] of Object.entries(VALID_TEST_PLANS)) {
        const plan = build();
        const ctx = makeDescribeContext(plan, draft);
        const networks: NetworkId[] = ["arbitrum", ...plan.spokes.map((s) => s.network)];
        const models = [
          ...networks.map((n) => protocolMenuModel(n, ctx)),
          networkMenuModel(ctx),
          ...plan.hub.chains
            .concat(plan.spokes.flatMap((s) => s.chains))
            .flatMap((chain) => chain.steps)
            .flatMap((step) => [
              portMenuModel({ side: "before", blockId: step.id }, ctx),
              portMenuModel({ side: "after", blockId: step.id }, ctx),
            ]),
        ];
        for (const model of models) {
          for (const option of model.options.filter((o) => !o.disabled)) {
            if (!option.action)
              throw new Error(`${draftName}/${planName}: enabled option with no action`);
            if (option.action.kind === "addChain") {
              expect(
                kindAvailability(option.action.blockKind, option.action.network, {
                  draft,
                  catalog: TEST_CATALOG,
                }),
              ).toBe("enabled");
            }
            const result = run(plan, option.action, draft);
            expect(isPlanBlocked(result), `${draftName}/${planName}/${option.id}`).toBe(false);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("gives every menu its link back to the mandate", () => {
    // @rule A4
    // @rule C6
    const ctx = makeDescribeContext(hubSupplyPlan());
    expect(protocolMenuModel("arbitrum", ctx).link.mandateStep).toBe("protocols");
    expect(networkMenuModel(ctx).link.mandateStep).toBe("networks");
    expect(
      portMenuModel({ side: "after", blockId: "hub-supply-supply" }, ctx).link.mandateStep,
    ).toBe("protocols");
  });
});

describe("menuOpenSentence", () => {
  it("tells where the block lands while the Add protocol menu is open", () => {
    // @rule AN10
    const ctx = makeDescribeContext(createEmptyPlan());
    expect(menuOpenSentence({ kind: "addProtocol", network: "arbitrum" }, ctx)).toBe(
      "Choose a protocol in the menu. The block is added on Arbitrum and opens here.",
    );
  });

  it("uses the Figma sentence after a Supply and the generic ones elsewhere", () => {
    // @rule AN10
    const ctx = makeDescribeContext(supplyBorrowPlan());
    expect(menuOpenSentence({ kind: "port", side: "after", blockId: "hub-aave-supply" }, ctx)).toBe(
      "Choose what comes after Supply WETH. A Borrow block uses that supply as its collateral.",
    );
    expect(menuOpenSentence({ kind: "port", side: "after", blockId: "hub-aave-borrow" }, ctx)).toBe(
      "Choose what comes after Borrow USDC.",
    );
    expect(
      menuOpenSentence(
        { kind: "port", side: "before", blockId: "hub-supply-supply" },
        makeDescribeContext(hubSupplyPlan()),
      ),
    ).toBe("Choose what comes before Supply USDC.");
  });

  it("tells what the Add network menu adds while it is open (review F3, coordinator copy)", () => {
    // @rule AN10
    expect(menuOpenSentence({ kind: "addNetwork" }, makeDescribeContext(createEmptyPlan()))).toBe(
      "Choose a network in the menu. The network is added to the canvas with its bridge.",
    );
  });

  it("has no sentence for a target that opens no menu", () => {
    // @rule AN10
    expect(
      menuOpenSentence({ kind: "block", blockId: "x" }, makeDescribeContext(createEmptyPlan())),
    ).toBeNull();
  });
});

describe("dropTargets", () => {
  function keys(targets: ReturnType<typeof dropTargets>): string[] {
    return targets.map((t) => targetKey(t.target)).sort();
  }

  it("activates every row's Add protocol circle where a position kind is available", () => {
    // @rule I3
    const ctx = makeDescribeContext(emptySpokePlan());
    expect(keys(dropTargets({ family: "position", kind: "uniswapV4Pool" }, ctx))).toEqual(
      [
        targetKey({ kind: "addProtocol", network: "arbitrum" }),
        targetKey({ kind: "addProtocol", network: "robinhood" }),
      ].sort(),
    );
    // Aave v3 is offered on the hub only.
    expect(keys(dropTargets({ family: "position", kind: "aaveSupply" }, ctx))).toEqual([
      targetKey({ kind: "addProtocol", network: "arbitrum" }),
    ]);
  });

  it("activates only the bottom port of a configured Supply for a Borrow", () => {
    // @rule I3
    // @rule C14
    const ctx = makeDescribeContext(hubSupplyPlan());
    const targets = dropTargets({ family: "position", kind: "aaveBorrow" }, ctx);
    expect(keys(targets)).toEqual([
      targetKey({ kind: "port", side: "after", blockId: "hub-supply-supply" }),
    ]);
    expect(targets[0]?.action).toEqual({
      kind: "insert",
      slot: { side: "after", blockId: "hub-supply-supply" },
      choice: { family: "position", kind: "aaveBorrow" },
    });
  });

  it("activates the ports where Swap or Collect fees fits, and nothing else", () => {
    // @rule I3
    const supply = makeDescribeContext(hubSupplyPlan());
    expect(keys(dropTargets({ family: "flow", kind: "swap" }, supply))).toEqual(
      [
        targetKey({ kind: "port", side: "before", blockId: "hub-supply-supply" }),
        targetKey({ kind: "port", side: "after", blockId: "hub-supply-supply" }),
      ].sort(),
    );
    expect(dropTargets({ family: "flow", kind: "collectFees" }, supply)).toEqual([]);
    const pool = makeDescribeContext(hubPoolPlan());
    expect(keys(dropTargets({ family: "flow", kind: "collectFees" }, pool))).toEqual([
      targetKey({ kind: "port", side: "after", blockId: "hub-pool-pool" }),
    ]);
    // A pool with its Collect fees already has no bottom port.
    expect(
      dropTargets(
        { family: "flow", kind: "collectFees" },
        makeDescribeContext(hubPoolWithFeesPlan()),
      ),
    ).toEqual([]);
  });

  it("activates nothing for a coming-soon kind, or a kind outside the mandate", () => {
    // @rule I3
    // @rule C22
    const ctx = makeDescribeContext(spokePoolPlan(), DRAFT_NO_AAVE);
    expect(dropTargets({ family: "position", kind: "uniswapV3Pool" }, ctx)).toEqual([]);
    expect(dropTargets({ family: "position", kind: "aaveSupply" }, ctx)).toEqual([]);
  });

  it("drops through the same reducer the menus use, and every drop succeeds", () => {
    // @rule I3
    // @rule A4
    const plan = hubSupplyPlan();
    const ctx = makeDescribeContext(plan);
    for (const item of [
      { family: "position", kind: "uniswapV4Pool" },
      { family: "position", kind: "aaveSupply" },
      { family: "position", kind: "aaveBorrow" },
      { family: "flow", kind: "swap" },
    ] as const) {
      for (const { action } of dropTargets(item, ctx)) {
        expect(isPlanBlocked(run(plan, action))).toBe(false);
      }
    }
  });
});
