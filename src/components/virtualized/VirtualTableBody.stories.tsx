/**
 * @name VirtualTableBody — stories
 *
 * Short story = the plain `.map()` baseline (gate off / below threshold). The 600-row story forces
 * the `virtualize` override on and renders inside a bounded scroll box so windowing engages: only the
 * visible rows plus overscan mount, with Technique A spacer rows reserving the rest.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect } from "react";
import { clearOverrides, setOverride } from "@/lib/features/devOverrides";
import { VirtualTableBody } from "./VirtualTableBody";

interface Pool {
  id: string;
  name: string;
  tvl: string;
  apy: string;
}

function makePools(n: number): Pool[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `pool-${i}`,
    name: `Pool ${i}`,
    tvl: `$${(120 + ((i * 37) % 900)).toLocaleString()}k`,
    apy: `${(2 + ((i * 7) % 38)).toFixed(1)}%`,
  }));
}

/** Force the `virtualize` flag on for the duration of a story (cleared on unmount). */
function ForceVirtualize({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    setOverride("virtualize", true);
    return () => clearOverrides();
  }, []);
  return <>{children}</>;
}

function PoolsTable({ pools }: { pools: Pool[] }) {
  return (
    <div style={{ overflow: "auto", height: 480, border: "1px solid #333", borderRadius: 8 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", color: "#efefef" }}>
        <thead style={{ position: "sticky", top: 0, background: "#1f1f1f" }}>
          <tr>
            <th scope="col" style={{ textAlign: "left", padding: 12 }}>
              Name
            </th>
            <th scope="col" style={{ textAlign: "right", padding: 12 }}>
              TVL
            </th>
            <th scope="col" style={{ textAlign: "right", padding: 12 }}>
              APY
            </th>
          </tr>
        </thead>
        <VirtualTableBody
          items={pools}
          colSpan={3}
          estimateSize={57}
          getRowKey={(p) => p.id}
          renderRow={(p) => (
            <>
              <td style={{ padding: 12, borderTop: "1px solid #2a2a2a" }}>{p.name}</td>
              <td style={{ padding: 12, textAlign: "right", borderTop: "1px solid #2a2a2a" }}>
                {p.tvl}
              </td>
              <td style={{ padding: 12, textAlign: "right", borderTop: "1px solid #2a2a2a" }}>
                {p.apy}
              </td>
            </>
          )}
        />
      </table>
    </div>
  );
}

const meta = {
  title: "Virtualized/VirtualTableBody",
  component: PoolsTable,
  parameters: { layout: "padded" },
} satisfies Meta<typeof PoolsTable>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Short list (below the 500 threshold): renders every row via the plain `.map()` baseline. */
export const Short: Story = {
  args: { pools: makePools(12) },
};

/** 600 rows with the `virtualize` flag forced on: windowed via Technique A spacer rows. */
export const Windowed600: Story = {
  args: { pools: makePools(600) },
  render: (args) => (
    <ForceVirtualize>
      <PoolsTable {...args} />
    </ForceVirtualize>
  ),
};
