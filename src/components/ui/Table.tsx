/**
 * @id PP-CORE-CMP-020
 * @name Table
 * @implements-rules-version v1
 * Generic, sortable data table built on @tanstack/react-table with loading and empty states.
 */
"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { type HTMLAttributes, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { EmptyState } from "./EmptyState";
import { Skeleton } from "./Skeleton";

/**
 * Public props for {@link Table}. Generic over the row shape `T`; forwards native `<table>`
 * attributes onto the underlying element.
 */
export interface TableProps<T> extends Omit<HTMLAttributes<HTMLTableElement>, "children"> {
  /** Column definitions in @tanstack/react-table format (header, accessor, cell, sorting). */
  columns: ColumnDef<T>[];
  /** Row data to render. An empty array renders the {@link EmptyState}. */
  data: T[];
  /** When `true`, renders {@link Skeleton} placeholder rows instead of data. */
  isLoading?: boolean;
  /** Already-translated headline shown by {@link EmptyState} when `data` is empty. */
  emptyMessage?: string;
  /** Number of skeleton rows to render while `isLoading` is `true`. Defaults to `5`. */
  loadingRows?: number;
}

/**
 * Sortable data table. Click a header whose column allows sorting to toggle
 * ascending, descending, and unsorted. While `isLoading` is `true` the body renders
 * skeleton rows; when `data` is empty an {@link EmptyState} is shown beneath the header.
 */
export function Table<T>({
  columns,
  data,
  isLoading = false,
  emptyMessage = "No data to display",
  loadingRows = 5,
  className,
  ...props
}: TableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    // PP-NOTE: ascending on the first click for every column. @tanstack/react-table otherwise
    // defaults numeric columns to descending-first, which is less predictable for users.
    sortDescFirst: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const headerGroups = table.getHeaderGroups();
  const rows = table.getRowModel().rows;
  const showEmpty = !isLoading && rows.length === 0;

  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full border-collapse text-sm text-foreground" {...props}>
        <thead>
          {headerGroups.map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b border-border">
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sortDirection = header.column.getIsSorted();
                const headerContent = header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext());

                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={
                      !canSort || sortDirection === false
                        ? undefined
                        : sortDirection === "asc"
                          ? "ascending"
                          : "descending"
                    }
                    className="px-3 py-2.5 text-left align-middle font-medium text-muted-foreground"
                  >
                    {canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          "-mx-1 inline-flex items-center gap-1.5 rounded-sm px-1 py-0.5",
                          "transition-colors hover:text-foreground",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        )}
                      >
                        {headerContent}
                        <SortIcon direction={sortDirection} />
                      </button>
                    ) : (
                      headerContent
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {isLoading
            ? Array.from({ length: loadingRows }).map((_, rowIndex) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows have no stable id
                <tr key={`skeleton-row-${rowIndex}`} className="border-b border-border">
                  {columns.map((_column, cellIndex) => (
                    <td
                      // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder cells have no stable id
                      key={`skeleton-cell-${rowIndex}-${cellIndex}`}
                      className="px-3 py-3 align-middle"
                    >
                      <Skeleton height="1rem" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border transition-colors last:border-b-0 hover:bg-muted"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-3 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
      {showEmpty ? (
        <div className="border-t border-border">
          <EmptyState title={emptyMessage} />
        </div>
      ) : null}
    </div>
  );
}

/** Inline sort affinity indicator reflecting a column's current sort direction. */
function SortIcon({ direction }: { direction: false | "asc" | "desc" }) {
  if (direction === "asc") {
    return <ArrowUp className="size-3.5 shrink-0 text-foreground" aria-hidden="true" />;
  }
  if (direction === "desc") {
    return <ArrowDown className="size-3.5 shrink-0 text-foreground" aria-hidden="true" />;
  }
  return <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" aria-hidden="true" />;
}
