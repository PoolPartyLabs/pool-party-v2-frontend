/**
 * @id PP-STR-CMP-029
 * @name PrivyBuyStep - stories
 * @implements-rules-version v1 (POO-1808 rules v1)
 * @epic POO-1793 (Privy on-ramp migration)
 *
 * @analytics-events none. The component emits `tx_amount_blocked` on its refusal paths, and these
 *   stories render it without an analytics provider, so nothing reaches a dataLayer here. The
 *   emissions are asserted in `ProvisioningPanel.privyBuy.analytics.test.tsx`.
 *
 * Every phase the buy step can be in, driven entirely through the injected deps.
 *
 * This is the workbench half of the same seam the suite uses: the inner component takes its adapter,
 * watcher, probe and balance read as PROPS, so a ceiling, a refusal and an inconclusive exit are all
 * reachable here without a Privy provider, a network or a card. A story that had to mock
 * `@privy-io/react-auth` would be a story about our mock rather than about the screen.
 *
 * The deps are deliberately INERT (they never resolve) wherever the phase under test is a resting
 * state: the step is then parked exactly where the story name says, rather than racing forward one
 * tick after it renders.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { within } from "storybook/test";
import type { ProvisioningOrder } from "@/lib/provisioning/types";
import { PrivyBuyStep, type PrivyBuyStepDeps } from "./PrivyBuyStep";

const ADDRESS = "0x1111111111111111111111111111111111111111";

/** The order the planner produces for a $120 shortfall on the USDC path. */
const USDC_ORDER: ProvisioningOrder = {
  currencyCode: "USDC-BASE",
  fiatAmount: "120.00",
  fiatCurrency: "USD",
};

/** The gas-first leg, which this rail refuses ([R4], POO-1820). */
const NATIVE_ORDER: ProvisioningOrder = { ...USDC_ORDER, currencyCode: "ETH-BASE" };

/** A promise nobody resolves: parks the step in whatever phase the story is showing. */
function never<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

/** The happy baseline: 25 USDC already on Base, coverage confirmed, checkout ready to open. */
function deps(overrides: Partial<PrivyBuyStepDeps> = {}): PrivyBuyStepDeps {
  return {
    openCheckout: async () => ({ attemptId: "att_1", moved: "confirmed", reason: "ok" }),
    probeCoverage: async () => ({ status: "covered", methods: [] }),
    readBalance: async () => BigInt(25_000_000),
    watchVisible: async () => ({
      outcome: "settled",
      delivered: {
        amount: "120",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        chain: "eip155:8453",
        observedAt: Date.now(),
      },
    }),
    sleep: async () => {},
    now: () => Date.now(),
    environment: "sandbox",
    ...overrides,
  };
}

const meta = {
  title: "Strategies/Provisioning/PrivyBuyStep",
  component: PrivyBuyStep,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
  args: {
    order: USDC_ORDER,
    address: ADDRESS,
    onSettled: () => {},
    onFailed: () => {},
    deps: deps(),
  },
} satisfies Meta<typeof PrivyBuyStep>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * `ready`: the baseline is read, coverage answered, and the CTA opens the checkout.
 *
 * The buyer pays in dollars here, so the amount rides on the call and no "enter the amount" line is
 * needed.
 */
export const Ready: Story = {};

/**
 * `preparing` with an unreadable baseline ([R5]).
 *
 * A balance we could not read is not a zero: a zero would credit the buyer's own money as a delivery
 * the first time the watcher looked. So the CTA refuses and the line says what is happening. This is
 * the one wall with no refusal screen behind it, which is why it also reports
 * `tx_amount_blocked{block_reason: "onramp_baseline_unreadable"}`.
 */
export const BaselineUnreadable: Story = {
  args: {
    deps: deps({
      readBalance: async () => {
        throw new Error("rpc unavailable");
      },
      probeCoverage: never,
    }),
  },
};

/**
 * `ready` for a buyer paying in something other than dollars ([R7]).
 *
 * The order is a USD figure and the rail hands us no rate, so no amount is prefilled and the buyer is
 * told what the leg needs. The figure carries no ticker: it is what they PAY, and naming the
 * stablecoin beside it would put a spend amount and a delivered amount in one sentence.
 */
export const NonDollarBuyer: Story = { args: { buyerCurrency: "EUR" } };

/**
 * `refused` because this rail does not sell the native coin ([R4]).
 *
 * POO-1820 answered no, so the gas-first leg is refused BEFORE a checkout opens rather than sending
 * the buyer to one that cannot fill the order. Whether to cover gas with a paymaster or to disclose
 * it differently is still an open product decision.
 */
export const RefusedNative: Story = { args: { order: NATIVE_ORDER } };

/**
 * `refused` because nobody will sell to this buyer right now ([R6]).
 *
 * Coverage is a question whose answer changes without a release, which is why it is asked rather than
 * looked up in a country table. Note what this does NOT say: not "declined", not "failed", and not
 * anything about their card.
 */
export const RefusedUncovered: Story = {
  args: { deps: deps({ probeCoverage: async () => ({ status: "uncovered" }) }) },
};

/**
 * `refused` because the rail cannot charge in the buyer's own money ([R7]).
 *
 * The alternative was a silent fallback to dollars, which charges someone in a currency nobody chose
 * for them and lets their bank take the conversion. That is the POO-1512 defect one rail over.
 */
export const RefusedCurrency: Story = { args: { buyerCurrency: "XYZ" } };

/**
 * `observing`: the provider says it charged a card, and we are watching the chain.
 *
 * The claim is not the settlement. Funds take minutes, and resolving here would make the next leg
 * read a zero delta and fail over money that is on its way.
 */
export const Observing: Story = {
  args: { deps: deps({ watchVisible: never }) },
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.click(await within(canvasElement).findByRole("button"));
  },
};

/**
 * `settling`: the visible window closed and the money has not landed yet.
 *
 * Never a failure and never a cancellation. In the panel this hands over to the settling screen, which
 * says the purchase is still landing and offers no retry that would charge a second card.
 */
export const Settling: Story = {
  args: { deps: deps({ watchVisible: async () => ({ outcome: "settling" }) }) },
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.click(await within(canvasElement).findByRole("button"));
  },
};
