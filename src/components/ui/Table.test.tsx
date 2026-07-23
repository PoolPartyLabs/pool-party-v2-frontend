/**
 * @id PP-CORE-CMP-020
 * @name Table.test
 * @implements-rules-version v1
 * Behavioral tests for the Table primitive: rendering, sorting, empty, and loading states.
 */
import type { ColumnDef } from "@tanstack/react-table";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Table } from "./Table";

interface Asset {
  symbol: string;
  balance: number;
}

const columns: ColumnDef<Asset>[] = [
  { accessorKey: "symbol", header: "Asset" },
  { accessorKey: "balance", header: "Balance" },
];

const data: Asset[] = [
  { symbol: "ETH", balance: 30 },
  { symbol: "BTC", balance: 10 },
  { symbol: "SOL", balance: 20 },
];

/** Returns the first-column text of every body row, in DOM order. */
function firstColumnValues(): string[] {
  const rows = screen.getAllByRole("row").slice(1); // drop the header row
  return rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent ?? "");
}

describe("Table", () => {
  it("renders a row for each item in data", () => {
    render(<Table columns={columns} data={data} />);

    expect(screen.getByText("ETH")).toBeInTheDocument();
    expect(screen.getByText("BTC")).toBeInTheDocument();
    expect(screen.getByText("SOL")).toBeInTheDocument();
    // header row + one row per data item
    expect(screen.getAllByRole("row")).toHaveLength(data.length + 1);
  });

  it("renders headers as column scope cells", () => {
    render(<Table columns={columns} data={data} />);

    const assetHeader = screen.getByRole("columnheader", { name: /asset/i });
    expect(assetHeader).toHaveAttribute("scope", "col");
  });

  it("reorders rows when a sortable header is clicked", async () => {
    const user = userEvent.setup();
    render(<Table columns={columns} data={data} />);

    expect(firstColumnValues()).toEqual(["ETH", "BTC", "SOL"]);

    // First click sorts ascending by Balance (10, 20, 30 -> BTC, SOL, ETH).
    await user.click(screen.getByRole("button", { name: /balance/i }));
    expect(firstColumnValues()).toEqual(["BTC", "SOL", "ETH"]);

    // Second click toggles to descending (30, 20, 10 -> ETH, SOL, BTC).
    await user.click(screen.getByRole("button", { name: /balance/i }));
    expect(firstColumnValues()).toEqual(["ETH", "SOL", "BTC"]);
  });

  it("reflects sort direction via aria-sort on the active header", async () => {
    const user = userEvent.setup();
    render(<Table columns={columns} data={data} />);

    const balanceHeader = screen.getByRole("columnheader", { name: /balance/i });
    expect(balanceHeader).not.toHaveAttribute("aria-sort");

    await user.click(screen.getByRole("button", { name: /balance/i }));
    expect(balanceHeader).toHaveAttribute("aria-sort", "ascending");

    await user.click(screen.getByRole("button", { name: /balance/i }));
    expect(balanceHeader).toHaveAttribute("aria-sort", "descending");
  });

  it("does not render a sort button for a non-sortable column", () => {
    const nonSortable: ColumnDef<Asset>[] = [
      { accessorKey: "symbol", header: "Asset", enableSorting: false },
    ];
    render(<Table columns={nonSortable} data={data} />);

    expect(screen.queryByRole("button", { name: /asset/i })).not.toBeInTheDocument();
  });

  it("shows the empty state with the provided message when data is empty", () => {
    render(<Table columns={columns} data={[]} emptyMessage="No assets yet" />);

    expect(screen.getByText("No assets yet")).toBeInTheDocument();
    // Only the header row remains; no data rows.
    expect(screen.getAllByRole("row")).toHaveLength(1);
  });

  it("renders skeleton placeholder rows while loading", () => {
    render(<Table columns={columns} data={data} isLoading loadingRows={3} />);

    // Header row + the requested number of skeleton rows.
    expect(screen.getAllByRole("row")).toHaveLength(4);
    // Real data is not rendered while loading.
    expect(screen.queryByText("ETH")).not.toBeInTheDocument();
    // Skeleton placeholders are present and hidden from assistive tech.
    const placeholders = screen.getAllByRole("presentation", { hidden: true });
    expect(placeholders.length).toBeGreaterThan(0);
  });

  it("does not show the empty state while loading", () => {
    render(<Table columns={columns} data={[]} isLoading emptyMessage="No assets yet" />);

    expect(screen.queryByText("No assets yet")).not.toBeInTheDocument();
  });

  it("merges a consumer className onto the wrapper", () => {
    const { container } = render(<Table columns={columns} data={data} className="max-h-96" />);

    expect(container.firstChild).toHaveClass("max-h-96", "w-full");
  });
});
