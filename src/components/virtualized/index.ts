/**
 * @name virtualized components — public API (barrel)
 * @implements-rules-version v1
 *
 * Barrel for the windowed-list DOM primitives (POO-625). See
 * docs/adr/0001-list-virtualization-react-virtual.md for the Technique A / absolute-row-ban contract.
 * (A re-export barrel, so it carries no artifact ID of its own; the IDs live on the components below.)
 */
export { VirtualCardList, type VirtualCardListProps } from "./VirtualCardList";
export { VirtualTableBody, type VirtualTableBodyProps } from "./VirtualTableBody";
