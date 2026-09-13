/**
 * @id PP-STR-CMP-028 (POO-1576, POO-1618, POO-1129)
 * @name OnRampMethodStep, stories
 * @implements-rules-version v3 (POO-1129 rules v1) · v2 (POO-1618 rules v1) · v1 (POO-1576 rules v1)
 *
 * "Choose how to pay", in the states the frames settle, as corrected by POO-1129: `3c` (priced
 * rows, and NO `Best price` pill on any of them, D1), a row refused for missing its own floor (D3),
 * the all-blocked dead end and its exit, the gas-first leg where nothing can be priced yet, `3g`
 * (the provider returned nothing), and POO-1618's currency control with the reload it triggers.
 *
 * This is also the ONLY way to see this screen without a live Paybis rail: mock mode has no on-ramp
 * behind it, so the panel never reaches the step there (POO-1631 tracks a mock harness).
 *
 * ## The rows are the LIVE capture, not tidy invented ones
 *
 * Every id, `displayName` and label below comes from `GET /api/v1/on-ramp/payment-methods` on the
 * sandbox, read 2026-08-14. Three things about them are load-bearing and would be lost by prettying
 * them up. The ids mix conventions ON THE WIRE (`poolparty-credit-card` hyphenated,
 * `poolparty_bridgerpay_revolutpay` not), so anything that assumes one shape is wrong here rather
 * than in production. Labels are MULTIPLE per method and the only three that exist are `instant`,
 * `low-fee` and `high-approval-rate` - all positive, lower-case, and rendered exactly as sent
 * (POO-1603 [R3]: render, never branch). And there is NO slowness label of any kind: a bank rail
 * simply omits `instant`, so absence is the whole signal and nothing may invent "1-2 business days".
 *
 * That absence is also why no bank rail appears in these rows any more. POO-1129 A7-b defers
 * non-instant methods out of the first iteration, and the filter is ELIGIBILITY that runs upstream
 * (`selectInstantMethods`), so a method with no `instant` label never reaches this component at all.
 * Putting one in a story would draw a screen the product cannot produce.
 *
 * Sized to 460px, the desktop dialog width the design is drawn at.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { OnRampMethodRow } from "@/features/strategies/lib/onRampMethodRows";
import { OnRampMethodStep } from "./OnRampMethodStep";

/** Frame `3c` over the live list: two rails at $218.45, and one whose own floor this order misses. */
const ROWS: OnRampMethodRow[] = [
  {
    id: "poolparty-credit-card",
    name: "Credit/Debit Card",
    labels: ["instant"],
    charge: { amount: 218.45, currencyCode: "USD" },
    minimum: { amount: 10, currencyCode: "USD" },
    blocked: false,
    unpriced: false,
  },
  {
    id: "poolparty_bridgerpay_revolutpay",
    name: "Revolut Pay",
    labels: ["high-approval-rate", "instant", "low-fee"],
    charge: { amount: 218.45, currencyCode: "USD" },
    minimum: { amount: 10, currencyCode: "USD" },
    blocked: false,
    unpriced: false,
  },
  {
    // POO-1129 D3: priced, and priced BELOW its own floor, so it is refused rather than raised to
    // meet it. In place, at reduced emphasis, still focusable, and it cannot become `value`.
    id: "directa24_pix",
    name: "Pix",
    labels: ["instant"],
    charge: { amount: 218.45, currencyCode: "USD" },
    minimum: { amount: 500, currencyCode: "USD" },
    blocked: true,
    unpriced: false,
  },
];

/** A slice of the vendor's 44 fiats (measured 2026-08-14), enough to make the control a control. */
const CURRENCIES = ["BRL", "EUR", "GBP", "JPY", "MXN", "USD"];

const meta = {
  title: "Strategies/Provisioning/OnRampMethodStep",
  component: OnRampMethodStep,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="flex w-[460px] flex-col gap-4 rounded-2xl border border-border bg-surface p-6">
        <Story />
      </div>
    ),
  ],
  args: {
    rows: ROWS,
    currencyCode: "USD",
    value: "poolparty-credit-card",
    onSelect: () => {},
    onBlockedSelect: () => {},
    onContinue: () => {},
    onCancel: () => {},
  },
} satisfies Meta<typeof OnRampMethodStep>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * `3c` with no supported set: the currency is stated rather than offered.
 *
 * The DEGRADED state is the default story on purpose. It is what every buyer sees whenever
 * `currency-pairs-to-buy` cannot be read, and it is the state the screen shipped in, so it should be
 * the one that is hardest to break unnoticed.
 */
export const Default: Story = {};

/** POO-1618: the control, over the supported set. Changing it re-lists the methods. */
export const CurrencyChooser: Story = {
  args: { currencies: CURRENCIES, onCurrencyChange: () => {} },
};

/**
 * POO-1618 [R3]: the reload the control triggers.
 *
 * Not the empty state and not the previous currency's rows: the first would blame the provider for
 * our own round trip, the second is the POO-1513 stale-figure class. `Continue` stays enabled
 * throughout, because a slow list may never trap a buyer mid-funding.
 */
export const ReloadingAfterCurrencyChange: Story = {
  args: {
    currencies: CURRENCIES,
    onCurrencyChange: () => {},
    currencyCode: "BRL",
    loading: true,
    rows: [],
    value: undefined,
  },
};

/**
 * POO-1129 D3: EVERY method is below its own floor, so there is nothing to continue with.
 *
 * A dead end is a defect and not a state, so it is drawn: the message names the LOWEST floor,
 * `Continue` is disabled, and `Cancel` (the control that returns to the amount, which lives on the
 * previous step) sits directly below it.
 */
export const AllBlocked: Story = {
  args: {
    rows: ROWS.map((row) => ({
      ...row,
      minimum: { amount: row.id === "directa24_pix" ? 500 : 600, currencyCode: "USD" },
      blocked: true,
    })),
    value: undefined,
  },
};

/**
 * The gas-first `ETH-BASE` leg: the list resolves, nothing is priced (the target is solved at mint
 * time), so the rows carry names, labels and their own minimums and no charge is claimed.
 */
export const Unpriced: Story = {
  args: {
    rows: ROWS.map((row) => ({
      ...row,
      charge: undefined,
      // No charge is no comparison, so nothing is refused either: the block is a fact ABOUT a
      // charge, and withholding the charge withholds the refusal with it.
      blocked: false,
      unpriced: false,
    })),
  },
};

/** `3g`: the provider returned nothing. Informational, never a dead end, and Continue still works. */
export const NoMethods: Story = {
  args: { rows: [], value: undefined },
};

/** A European buyer: every figure in the currency the server resolved, never dollars. */
export const EuroBuyer: Story = {
  args: {
    currencyCode: "EUR",
    currencies: CURRENCIES,
    onCurrencyChange: () => {},
    rows: ROWS.map((row) => ({
      ...row,
      ...(row.charge ? { charge: { ...row.charge, currencyCode: "EUR" } } : {}),
      ...(row.minimum ? { minimum: { ...row.minimum, currencyCode: "EUR" } } : {}),
    })),
  },
};
