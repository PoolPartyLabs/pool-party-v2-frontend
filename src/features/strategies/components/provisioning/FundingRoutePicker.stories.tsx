/**
 * @id PP-CORE-CMP-064 (POO-1153, POO-1155, POO-1501)
 * @name FundingRoutePicker, stories
 * @implements-rules-version v4 (POO-1501 rules v1) · v3 (POO-1153, POO-1155 / POO-1129 rules v3) · v1 (POO-1086 rules v1)
 *
 * Screen 1, "Where from", in every state POO-1501 specifies: `1` tokens cover it, `1b` they do not,
 * `1c` no gas is needed, `1d` an empty wallet, plus the loading skeleton (D1) and the case that
 * renders nothing at all, which is the rule this screen exists under: a single viable option is
 * skipped, never shown.
 *
 * Sized to 460px, the desktop dialog width the design is drawn at.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { FundingRoutePicker } from "./FundingRoutePicker";

const meta = {
  title: "Strategies/Provisioning/FundingRoutePicker",
  component: FundingRoutePicker,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="w-[460px] rounded-2xl border border-border bg-surface p-6">
        <Story />
      </div>
    ),
  ],
  args: {
    // The worked scenario, at the figures POO-1499 settled: a $200 operation, $5 of gas on the
    // tokens route, and the shipped 5% buffer.
    requiredUsd: 205,
    opRequiredUsd: 200,
    gasUsd: 5,
    bufferPct: 5,
    onSelect: () => {},
    onCancel: () => {},
  },
} satisfies Meta<typeof FundingRoutePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The wallet covers it on its own, and the card is there as an alternative (Figma `6547:569`). */
export const TokensOrCard: Story = {
  args: {
    routes: [
      { kind: "tokens", availableUsd: 324.5, shortfallUsd: 0, sourceTargetUsd: 215.25 },
      { kind: "buy", availableUsd: 0, shortfallUsd: 205, sourceTargetUsd: 212 },
    ],
    // [R10] The buy row shows the received-fixed quote charge (backend `amountFrom`, incl. Paybis
    // fees), never the FE shortfall, and NAMES the method it was priced for (POO-1153). Here $210
    // needed lands at a $214.30 charge on the default card method.
    buyChargeUsd: 214.3,
    buyMethodName: "Credit Card",
  },
};

/**
 * POO-1153/POO-1512: the host judged the method's OWN minimum worth stating (the order sits at the
 * app floor, where a method minimum is what can still reject it). The row states the real minimum
 * ("Minimum $30.00 with Trustly") under the charge, in the minimum's own currency, so Paybis never
 * rejects the order for an amount the app quietly allowed, and the user knows the floor before
 * switching method inside the widget.
 */
export const BuyWithMethodMinimum: Story = {
  args: {
    routes: [
      { kind: "tokens", availableUsd: 324.5, shortfallUsd: 0, sourceTargetUsd: 215.25 },
      { kind: "buy", availableUsd: 0, shortfallUsd: 205, sourceTargetUsd: 212 },
    ],
    buyChargeUsd: 216.1,
    buyMethodName: "Trustly",
    buyMethodMinUsd: 30,
    buyMethodMinCurrency: "USD",
  },
};

/**
 * [R10] The received-fixed quote has not resolved yet, or is unavailable (mock mode, where the host
 * gates the hook off; a pair Paybis will not sell; a throttle or a timeout. POO-1626: this used to read
 * "dev's absent USDC-BASE pair", which POO-1605 made false by mapping our codes into the sandbox).
 * The buy row shows a neutral "shown at checkout" caption rather than the FE-computed shortfall, which
 * it must never present as what Paybis will charge. Same fallback when the method has no label.
 */
export const BuyChargePending: Story = {
  args: {
    routes: [
      { kind: "tokens", availableUsd: 324.5, shortfallUsd: 0, sourceTargetUsd: 215.25 },
      { kind: "buy", availableUsd: 0, shortfallUsd: 205, sourceTargetUsd: 212 },
    ],
  },
};

/** The tokens fall short, so the mixed route leads (Figma `6547:627`). */
export const TokensDoNotCover: Story = {
  args: {
    routes: [
      { kind: "tokens-plus-buy", availableUsd: 88.4, shortfallUsd: 121.6, sourceTargetUsd: 215.25 },
      { kind: "buy", availableUsd: 0, shortfallUsd: 205, sourceTargetUsd: 212 },
    ],
  },
};

/**
 * An operation that spends nothing of its own: withdraw, collect, compound, move-range and close all
 * pass `opRequiredUsdc = 0`, so the breakdown line names only the gas.
 */
export const GasOnly: Story = {
  args: {
    requiredUsd: 10,
    opRequiredUsd: 0,
    gasUsd: 10,
    routes: [
      { kind: "tokens", availableUsd: 324.5, shortfallUsd: 0, sourceTargetUsd: 215.25 },
      { kind: "buy", availableUsd: 0, shortfallUsd: 5, sourceTargetUsd: 5.25 },
    ],
  },
};

/**
 * One route, so nothing renders. This is the state production is in today: with the on-ramp off
 * (POO-1082 D3) there is only ever the tokens route, and the step is skipped.
 */
export const SingleRouteRendersNothing: Story = {
  args: {
    routes: [{ kind: "tokens", availableUsd: 324.5, shortfallUsd: 0, sourceTargetUsd: 215.25 }],
  },
};

/**
 * POO-1155: depositing from an external wallet is offered as a PEER, alongside using existing tokens
 * and buying crypto, rather than being hidden as a separate escape. It carries no USD figure: the
 * amount is settled on the deposit surface, and choosing it hands off to `/deposit`.
 */
export const WithDepositPeer: Story = {
  args: {
    routes: [
      { kind: "tokens-plus-buy", availableUsd: 88.4, shortfallUsd: 121.6, sourceTargetUsd: 215.25 },
      { kind: "buy", availableUsd: 0, shortfallUsd: 205, sourceTargetUsd: 212 },
      { kind: "deposit", availableUsd: 0, shortfallUsd: 0 },
    ],
  },
};

/**
 * `1c` (Figma `7326:766`): the target chain already has gas, so [R9] drops the breakdown line AND
 * the info affordance that opens it. The heading is the transaction amount alone. An empty
 * disclosure is worse than no disclosure.
 */
export const NoGasNeeded: Story = {
  args: {
    requiredUsd: 200,
    opRequiredUsd: 200,
    gasUsd: 0,
    routes: [
      { kind: "tokens", availableUsd: 324.5, shortfallUsd: 0, sourceTargetUsd: 210 },
      { kind: "buy", availableUsd: 0, shortfallUsd: 200, sourceTargetUsd: 210 },
    ],
  },
};

/**
 * `1d` (Figma `7331:766`): the wallet holds nothing spendable, so [R8] means `resolveFundingRoutes`
 * never produced a tokens route at all. One card plus the deposit ghost link, and therefore **no
 * `Recommended` chip** ([R6]): with one card there is nothing to compare against, and a badge on the
 * only option is decoration that invites the reader to look for a comparison that is not there.
 */
export const EmptyWallet: Story = {
  args: {
    routes: [
      { kind: "buy", availableUsd: 0, shortfallUsd: 205, sourceTargetUsd: 212 },
      { kind: "deposit", availableUsd: 0, shortfallUsd: 0 },
    ],
    buyChargeUsd: 216.4,
    buyMethodName: "Credit Card",
  },
};

/**
 * D1, answered by murilo 2026-08-10: while the quote is in flight the screen shows a skeleton of
 * itself, not a spinner and not a dead tap.
 *
 * The trigger is honest rather than a flag: a row cannot print an amount it does not have, so an
 * absent `sourceTargetUsd` IS the loading state. The modal still opens on tap, because "open only
 * when ready" means a dead tap of unknown length, which reads as a broken button.
 */
export const LoadingQuote: Story = {
  args: {
    routes: [
      { kind: "tokens", availableUsd: 324.5, shortfallUsd: 0 },
      { kind: "buy", availableUsd: 0, shortfallUsd: 205 },
    ],
  },
};
