/**
 * @id PP-MGR-CMP-066
 * @name RemoveBlockConfirm tests
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, a presentational confirm under test
 *
 * The remove confirm (handoff P10, decision DP11): the words come from `describeRemoval`, so they
 * name only what exists (the share part only with a share, the steps that really go), an empty
 * block reads "Remove this block?" alone, and focus starts on Cancel.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { describeBlock } from "../blocks/blockRegistry";
import { makeDescribeContext, makeTestCopy } from "../blocks/blockTestKit";
import type { BuildPlan } from "../plan/buildPlan";
import { describeRemoval } from "../plan/planReducers";
import {
  hubPoolPlan,
  hubPoolWithFeesPlan,
  hubSupplyPlan,
  makeTestContext,
  supplyBorrowPlan,
} from "../plan/planTestKit";
import { makeTestPanelCopy } from "./panelFixtures";
import { RemoveBlockConfirm, removalText } from "./RemoveBlockConfirm";

const blockCopy = makeTestCopy();
const panelCopy = makeTestPanelCopy();

/** The confirm's words for a block of a plan, in English. */
function words(plan: BuildPlan, blockId: string) {
  const description = describeRemoval(plan, makeTestContext(), blockId);
  if (!description) throw new Error("no removal");
  const ctx = makeDescribeContext(plan);
  return removalText({
    description,
    blockTitle: describeBlock(blockId, ctx).title,
    stepTitle: (step) => describeBlock(step.id, ctx).title,
    copy: panelCopy.confirm,
    listNames: blockCopy.listNames,
    locale: "en",
  });
}

describe("removalText (P10)", () => {
  it("[P10] a pool: its share back to Idle input, and its Swap · auto", () => {
    // @rule P10
    expect(words(hubPoolPlan(), "hub-pool-pool")).toEqual({
      title: "Remove WETH / USDC?",
      sentence: "Its 60% goes back to Idle input. Its Swap · auto step is removed with it.",
    });
  });

  it("[P10] a pool with Collect fees names both steps", () => {
    // @rule P10
    expect(words(hubPoolWithFeesPlan(), "hub-pool-pool").sentence).toBe(
      "Its 60% goes back to Idle input. Its Swap · auto step and its Collect fees step are removed with it.",
    );
  });

  it("[P10] a Supply of the arriving token: only its share", () => {
    // @rule P10
    expect(words(hubSupplyPlan(), "hub-supply-supply")).toEqual({
      title: "Remove Supply USDC?",
      sentence: "Its 40% goes back to Idle input.",
    });
  });

  it("[P10] a Supply with a Borrow under it names the Borrow block", () => {
    // @rule P10
    expect(words(supplyBorrowPlan(), "hub-aave-supply").sentence).toBe(
      "Its 50% goes back to Idle input. Its Swap · auto step and the Borrow USDC block are removed with it.",
    );
  });

  it("[P10] an empty block asks only 'Remove this block?'", () => {
    // @rule P10
    const plan: BuildPlan = {
      version: 1,
      hub: {
        chains: [
          {
            id: "c",
            sharePct: 0,
            steps: [{ id: "b", family: "position", kind: "aaveSupply", config: null }],
          },
        ],
      },
      spokes: [],
    };
    expect(words(plan, "b")).toEqual({ title: "Remove this block?", sentence: null });
  });
});

describe("RemoveBlockConfirm (P10)", () => {
  it("[P10] focuses Cancel, and each pill answers", async () => {
    // @rule P10
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <RemoveBlockConfirm
        title="Remove WETH / USDC?"
        sentence="Its 60% goes back to Idle input."
        cancelLabel="Cancel"
        removeLabel="Remove block"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText("Remove WETH / USDC?")).toBeInTheDocument();
    expect(screen.getByText("Its 60% goes back to Idle input.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove block" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
