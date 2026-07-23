/**
 * @id PP-CORE-CMP-020
 * @name Table.stories
 * @implements-rules-version v1
 * Storybook coverage for the Table primitive: sortable columns, loading, and empty states.
 */

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ColumnDef } from "@tanstack/react-table";
import { Table } from "./Table";

interface Holding {
  asset: string;
  allocation: number;
  value: number;
}

const columns: ColumnDef<Holding>[] = [
  { accessorKey: "asset", header: "Asset" },
  {
    accessorKey: "allocation",
    header: "Allocation",
    cell: ({ getValue }) => `${getValue<number>()}%`,
  },
  {
    accessorKey: "value",
    header: "Value",
    cell: ({ getValue }) =>
      getValue<number>().toLocaleString("en-US", { style: "currency", currency: "USD" }),
  },
];

const data: Holding[] = [
  { asset: "USDC", allocation: 45, value: 12_500 },
  { asset: "ETH", allocation: 30, value: 8_320 },
  { asset: "BTC", allocation: 15, value: 4_180 },
  { asset: "SOL", allocation: 10, value: 2_740 },
];

const meta = {
  title: "UI/Table",
  component: Table<Holding>,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Table<Holding>>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Sortable: Story = {
  args: { columns, data },
};

export const Loading: Story = {
  args: { columns, data: [], isLoading: true, loadingRows: 4 },
};

export const Empty: Story = {
  args: { columns, data: [], emptyMessage: "No holdings in this pool yet" },
};
