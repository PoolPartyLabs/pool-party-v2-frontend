/**
 * @id PP-MGR-CMP-036
 * @name ProtocolMark.stories
 * @implements-rules-version v1
 *
 * Storybook coverage for the shared protocol mark (POO-2128, epic POO-2119).
 *
 * The story that earns its place is `EveryProtocol`: the component has exactly one branch, and the
 * only way to see that the branch is drawn correctly is the full set side by side, where the three
 * Uniswap ids carry the committed asset and Across, Aave v3 and GMX fall back to a monogram. One
 * story per id would say the same thing six times and would not show the fallbacks lining up.
 *
 * `BothSizes` is the second: the two call sites differ only in edge (24 px on Mandate step 2, 28 px
 * on step 5), which is the whole reason `size` is a prop rather than a constant, and a reviewer can
 * only check that the monogram stays centred and circular at both by seeing both.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ProtocolId } from "../mandateDraft";
import { ProtocolMark } from "./ProtocolMark";

/** Every protocol the catalog lists, in the order the Protocols step renders them. */
const PROTOCOLS: { id: ProtocolId; name: string }[] = [
  { id: "uniswap-v3-swap", name: "Uniswap v3" },
  { id: "across", name: "Across" },
  { id: "aave-v3", name: "Aave v3" },
  { id: "uniswap-v3", name: "Uniswap v3" },
  { id: "uniswap-v4", name: "Uniswap v4" },
  { id: "gmx", name: "GMX" },
];

/** One labelled mark, so a reviewer can tell which id produced which drawing. */
function Labelled({ id, name, size }: { id: ProtocolId; name: string; size?: number }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
      <ProtocolMark id={id} name={name} size={size} />
      <span style={{ color: "#a1a1aa", fontSize: 13 }}>
        {name} · {id}
      </span>
    </span>
  );
}

const meta = {
  title: "Manager/ProtocolMark",
  component: ProtocolMark,
  args: { id: "uniswap-v3", name: "Uniswap v3" },
  parameters: {
    docs: {
      description: {
        component:
          "The leading mark on a protocol row, shared by Mandate steps 2 and 5. Uniswap has a committed asset; every other protocol takes a monogram on the raised surface rather than a brand colour this repo would be inventing. Always aria-hidden, because the row title carries the name.",
      },
    },
  },
} satisfies Meta<typeof ProtocolMark>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The default: one Uniswap row mark at the step 2 edge. */
export const Default: Story = {};

/** All six ids: the asset for the three Uniswap ones, a monogram for the rest. */
export const EveryProtocol: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {PROTOCOLS.map((protocol) => (
        <Labelled key={protocol.id} id={protocol.id} name={protocol.name} />
      ))}
    </div>
  ),
};

/** The two edges in use: 24 px on Mandate step 2, 28 px on the taller step 5 rows. */
export const BothSizes: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
        <Labelled id="uniswap-v4" name="Uniswap v4" size={24} />
        <Labelled id="aave-v3" name="Aave v3" size={24} />
        <span style={{ color: "#71717a", fontSize: 12 }}>24 px · step 2</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
        <Labelled id="uniswap-v4" name="Uniswap v4" size={28} />
        <Labelled id="aave-v3" name="Aave v3" size={28} />
        <span style={{ color: "#71717a", fontSize: 12 }}>28 px · step 5</span>
      </div>
    </div>
  ),
};
