/**
 * @id PP-MGR-CMP-046
 * @name canvasCopy tests
 * @implements-rules-version v1 (POO-2152 rules v1)
 * @analytics-events none, a test of message files
 *
 * The copy of the Build canvas (`manager.fundBuilder.canvas`, POO-2152 [G7], [BB11]). Slice S2
 * lands the whole tree once, so every later slice only consumes keys; these tests are what keep
 * the tree whole:
 *
 * - [G7] the same key set in all 11 locales of `src/i18n/config.ts` (without the six `review.*`
 *   keys, which slice S7 adds), the same placeholders per key in every locale (names AND counts:
 *   a translation that drops `{network}` prints the wrong sentence with no error), no em dash;
 * - [BB11] the exact English of the strings the handoff gives (tooltips, titles, captions), with
 *   the placeholders the coordinator decided: D7 puts `{token}` where the handoff printed USDC
 *   (Robinhood Chain arrives in USDG), D13 gives each insert port the tooltip of its own slot.
 *
 * `scripts/i18n-check.ts` checks parity for the whole repository; these pin this tree to its
 * rules, so a regression names the rule it breaks.
 */
import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";
import de from "@/i18n/messages/de/manager.json";
import en from "@/i18n/messages/en/manager.json";
import es from "@/i18n/messages/es/manager.json";
import fr from "@/i18n/messages/fr/manager.json";
import ja from "@/i18n/messages/ja/manager.json";
import ko from "@/i18n/messages/ko/manager.json";
import nl from "@/i18n/messages/nl/manager.json";
import ptBR from "@/i18n/messages/pt-BR/manager.json";
import vi from "@/i18n/messages/vi/manager.json";
import zhCN from "@/i18n/messages/zh-CN/manager.json";
import zhTW from "@/i18n/messages/zh-TW/manager.json";

const MESSAGES: Record<string, { fundBuilder: { canvas: unknown } }> = {
  en,
  "pt-BR": ptBR,
  es,
  fr,
  de,
  nl,
  ja,
  ko,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  vi,
};

/** `dot.path` to string for one locale's canvas tree. */
function flatten(
  value: unknown,
  prefix = "",
  out = new Map<string, string>(),
): Map<string, string> {
  if (typeof value === "string") {
    out.set(prefix, value);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
  }
  return out;
}

function canvasOf(locale: string): Map<string, string> {
  const messages = MESSAGES[locale];
  if (!messages) throw new Error(`no messages for ${locale}`);
  return flatten(messages.fundBuilder.canvas);
}

/** Every `{name}` placeholder, duplicates kept, sorted: names AND counts must match. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "").sort();
}

const EN = canvasOf("en");

describe("canvas copy: one tree in every locale", () => {
  // @rule G7
  it("[G7] covers exactly the 11 locales of the i18n config", () => {
    expect(Object.keys(MESSAGES).sort()).toEqual([...locales].sort());
    expect(locales).toHaveLength(11);
  });

  // @rule G7
  it("[G7] lands 147 keys, the twelve review.* keys of slices S7 and PA1 among them", () => {
    // 100 from S2, plus `panel.menuOpenNetwork` (review F3 of PR #36, POO-2155), plus seven from S7
    // (POO-2157): the six Next: Review notices (D19) and `planUnreadable` (D18), plus the six
    // launch readiness notices of PA1 (POO-2184), plus the 35 `panel.*` keys of the configuration
    // panel shell (POO-2187), minus the two `toast.*` keys its remove confirm retired (DP11).
    expect(EN.size).toBe(147);
    expect([...EN.keys()].filter((key) => key.startsWith("toast."))).toEqual([]);
    expect([...EN.keys()].filter((key) => key.startsWith("review.")).sort()).toEqual([
      "review.comingSoon",
      "review.duplicateReserve",
      "review.emptyBlock",
      "review.emptyPlan",
      "review.incompleteBlock",
      "review.invalidBlock",
      "review.overShare",
      "review.stackedPositions",
      "review.unavailable",
      "review.unsupportedSwap",
      "review.unusedSpokeShare",
      "review.zeroShare",
    ]);
  });

  // @rule G7
  it.each(
    locales.filter((locale) => locale !== "en"),
  )("[G7] %s has exactly the English key set", (locale) => {
    expect([...canvasOf(locale).keys()].sort()).toEqual([...EN.keys()].sort());
  });

  // @rule G7
  it.each(
    locales.filter((locale) => locale !== "en"),
  )("[G7] %s keeps every placeholder of every key, names and counts", (locale) => {
    const tree = canvasOf(locale);
    for (const [key, english] of EN) {
      expect({ key, placeholders: placeholders(tree.get(key) ?? "") }).toEqual({
        key,
        placeholders: placeholders(english),
      });
    }
  });

  // @rule G7
  it.each([...locales])("[G7] %s has no em dash (U+2014) in any value", (locale) => {
    for (const [key, value] of canvasOf(locale)) {
      expect({ key, hasEmDash: value.includes("—") }).toEqual({ key, hasEmDash: false });
    }
  });

  // @rule G7 (D7)
  it.each([
    ...locales,
  ])("[G7] %s never prints a literal USDC in the Swap auto and Bridge tooltips", (locale) => {
    const tree = canvasOf(locale);
    for (const key of ["tooltip.swapAuto", "tooltip.swapAutoSupply", "tooltip.bridgeAuto"]) {
      expect(tree.get(key)).toContain("{token}");
      expect(tree.get(key)).not.toContain("USDC");
    }
  });

  // @rule G7
  it("[G7] zh-CN and zh-TW say Collect fees as claiming what the position earned, not charging", () => {
    // 收取费用 / 收取費用 reads as "charge a fee". 领取 / 領取 is collecting what is owed to you.
    for (const locale of ["zh-CN", "zh-TW"]) {
      const tree = canvasOf(locale);
      for (const key of ["flow.collectFees", "tooltip.collectFees", "tooltip.portAfterPool"]) {
        expect({ locale, key, charges: tree.get(key)?.includes("收取") }).toEqual({
          locale,
          key,
          charges: false,
        });
      }
      expect(tree.get("flow.collectFees")).toMatch(/领取|領取/);
    }
  });
});

describe("canvas copy: the handoff's English, verbatim", () => {
  // @rule BB11
  it.each([
    ["tooltip.addProtocol", "Add protocol on {network}"],
    ["tooltip.addNetwork", "Add network"],
    ["tooltip.swapAuto", "The app swaps {token} into the pool tokens"],
    ["tooltip.bridgeAuto", "Moves {token} to {network}"],
    ["tooltip.collectFees", "Claims the pool fees into Income (fees)"],
    ["tooltip.share", "{pct}% of the strategy's capital"],
    ["spine.lockTooltip", "Fixed: USDC on Arbitrum"],
    ["palette.soonTooltip", "Coming soon"],
  ])("[BB11] tooltip %s reads %j", (key, english) => {
    expect(EN.get(key)).toBe(english);
  });

  // @rule BB11 (D13)
  it.each([
    ["tooltip.portBefore", "Insert a flow block: Swap"],
    ["tooltip.portAfterPool", "Insert a flow block: Collect fees"],
    ["tooltip.portAfterSupply", "Insert a block: Borrow, Swap"],
    ["tooltip.portAfterBorrow", "Insert a flow block: Swap"],
  ])("[BB11] the port tooltip of each slot names what that slot offers: %s", (key, english) => {
    expect(EN.get(key)).toBe(english);
  });

  // @rule G7
  it.each([
    ["title", "Build your strategy"],
    [
      "subtitle",
      "Assemble the strategy from blocks. Drag one in, then configure it on the right. Blocks only use what the mandate allows.",
    ],
    ["hint", "Ctrl + scroll to zoom (Cmd + scroll on Mac) · drag to move · double-click to fit"],
    ["bar.back", "Back: Mandate"],
    ["bar.next", "Next: Review"],
    ["palette.fromMandate", "From your mandate"],
    ["palette.flowBlocks", "Flow blocks"],
    ["palette.comingSoon", "Coming soon"],
    [
      "palette.caption",
      "Drag a block onto the canvas. It arrives empty: pick the pool, asset or market on the right.",
    ],
    ["spine.deposit.title", "Deposit"],
    ["spine.deposit.caption", "USDC · Arbitrum"],
    ["spine.idleInput.title", "Idle input"],
    ["spine.idleInput.caption", "USDC waiting on the hub"],
    ["spine.idleOutput.title", "Idle output"],
    ["spine.idleOutput.caption", "USDC back on the hub"],
    ["spine.income.title", "Income (fees)"],
    ["spine.withdraw.title", "Withdraw"],
    ["flow.swapAuto", "Swap · auto"],
    ["flow.swap", "Swap"],
    ["flow.collectFees", "Collect fees"],
    ["flow.bridgeAuto", "Bridge · auto"],
    ["card.emptySupply", "Aave v3 Supply"],
    ["card.emptyBorrow", "Aave v3 Borrow"],
    ["card.pickPool", "Pick a pool"],
    ["card.pickAsset", "Pick an asset"],
    ["empty.addProtocol", "Add protocol"],
    ["empty.addNetwork", "Add network"],
    ["empty.startHere", "Start here: add a protocol on Arbitrum (circle), or add a network (box)."],
    ["menu.protocols.title", "Protocols on {network}"],
    ["menu.protocols.footer", "Protocols of your mandate on {network}."],
    ["menu.protocols.borrowDisabled", "Borrow · add it under a Supply block"],
    ["menu.comingSoonType", "{type} · coming soon"],
    ["menu.link.protocols", "Edit mandate · Protocols"],
    ["menu.link.networks", "Edit mandate · Networks"],
    ["menu.networks.title", "Networks from your mandate"],
    ["menu.networks.option", "spoke · adds a bridge"],
    // Review F2 of PR #36: the handoff's sentence, agreeing with the number of networks placed.
    [
      "menu.networks.placed",
      "{count, plural, =1 {{names} is already on the canvas.} other {{names} are already on the canvas.}}",
    ],
    ["menu.port.after", "After {title}"],
    ["panel.overline", "Configure block"],
    ["panel.nothingTitle", "Nothing selected"],
    [
      "panel.nothingBody",
      "Add a protocol or a network on the canvas, or drag a block from the left. A new block arrives empty; you pick its pool, asset or market here.",
    ],
    ["panel.remove", "Remove block"],
    [
      "panel.menuOpen",
      "Choose a protocol in the menu. The block is added on {network} and opens here.",
    ],
  ])("[G7] %s reads the handoff's %j", (key, english) => {
    expect(EN.get(key)).toBe(english);
  });

  // @rule AN4 (D19, coordinator strings, slice S7)
  it.each([
    ["review.emptyPlan", "Add a block before Review."],
    [
      "review.invalidBlock",
      "Remove the blocks that are no longer in your mandate, or edit the mandate.",
    ],
    ["review.comingSoon", "Remove the blocks that are coming soon."],
    ["review.emptyBlock", "Configure every block before Review."],
    ["review.overShare", "The shares add up to more than the capital above them."],
    // PA1 (POO-2184): the launch readiness notices.
    [
      "review.incompleteBlock",
      "Set a price range and a max slippage for every pool before Review.",
    ],
    ["review.zeroShare", "Give every block a share above 0%, or remove it."],
    [
      "review.unusedSpokeShare",
      "A network holds more of the capital than its blocks use. Give its blocks that share, or remove the network.",
    ],
    [
      "review.stackedPositions",
      "Remove the blocks placed under a Supply block: they cannot launch yet.",
    ],
    [
      "review.duplicateReserve",
      "Supply each asset in one block only. Remove the second Supply of the same asset.",
    ],
    [
      "review.unsupportedSwap",
      "Swaps outside a pool cannot launch yet. Supply the token that arrives, or remove the Swap.",
    ],
    ["review.unavailable", "Review is not available yet."],
  ])("[AN4] the Next: Review notice %s reads %j", (key, english) => {
    expect(EN.get(key)).toBe(english);
  });
});
