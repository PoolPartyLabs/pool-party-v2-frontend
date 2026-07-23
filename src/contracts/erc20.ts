/**
 * @id PP-CORE-LIB-040 (POO-810)
 * @name erc20 contract ABI
 * @implements-rules-version v1
 *
 * The canonical minimal ERC-20 fragment the transactional receipt decoder + on-chain token-meta
 * reads share (POO-810): the `Transfer(from, to, value)` event and the `decimals()` / `symbol()`
 * views. A `Transfer` log is emitted BY the token contract, so `log.address` IS the token address —
 * the decoder needs no address list in advance (POO-810 R2/R7). `viem`-typed as `const` so
 * `decodeEventLog` narrows the args (`from`/`to`/`value`).
 *
 * This is the single source for the fragment the decode path relies on; the pre-existing inline
 * ERC-20 allowance/balance ABIs (`lib/tx/permit2.ts`, `lib/tokens/readErc20.ts`) predate this and
 * stay as-is (different views, not in scope to consolidate here).
 *
 * PP-INTEGRATION-POINT: standard ERC-20 (no protocol-specific event ABI) — decodes the real receipt
 * `Transfer` logs of any invest/collect/withdraw tx.
 */

/** The ERC-20 `Transfer(address indexed from, address indexed to, uint256 value)` event fragment. */
export const erc20TransferEvent = {
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
} as const;

/** The ERC-20 `symbol()` view fragment. */
export const erc20SymbolView = {
  type: "function",
  name: "symbol",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "", type: "string" }],
} as const;

/** The ERC-20 `decimals()` view fragment. */
export const erc20DecimalsView = {
  type: "function",
  name: "decimals",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "", type: "uint8" }],
} as const;

/** Minimal ERC-20 ABI: the `Transfer` event + the `decimals()` / `symbol()` metadata views. */
export const erc20Abi = [erc20TransferEvent, erc20SymbolView, erc20DecimalsView] as const;
