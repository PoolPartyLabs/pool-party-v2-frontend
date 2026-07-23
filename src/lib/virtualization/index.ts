/**
 * @name virtualization — public API (barrel)
 * @implements-rules-version v1
 *
 * The single entry point for the windowed-list primitives (POO-625, under the POO-623 epic). Consuming
 * surfaces import the gate and the row hook from here; the DOM components ship from
 * `@/components/virtualized`. See docs/adr/0001-list-virtualization-react-virtual.md for the contract.
 * (A re-export barrel, so it carries no artifact ID of its own; the IDs live on the modules below.)
 */
export {
  chunk,
  clampScrollIndex,
  pinFocusedIndex,
  type TechniqueASegment,
  techniqueASegments,
} from "./rows";
export {
  type LaneBreakpoint,
  type UseVirtualizedRowsOptions,
  useVirtualizedRows,
  type VirtualizedRows,
} from "./useVirtualizedRows";
export { THRESHOLD, useVirtualizeGate, type VirtualizeGate } from "./useVirtualizeGate";
