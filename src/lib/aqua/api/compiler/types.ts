import "server-only";

/**
 * Compiler types. The mandate shape is FROZEN for parallel work (PRG); changing a field name
 * here requires an epic comment and Murilo's ack.
 */

export type MandateName = "production" | "demo";

export type Mandate = {
  /** Always WETH/USDC in v1. base is what we buy, quote is what we pay with. */
  pair: { base: `0x${string}`; quote: `0x${string}` };
  /** Band edges as NEGATIVE basis points from spot. Production -1500 / -500, demo -30 / -10. */
  bandLowPct: number;
  bandHighPct: number;
  /** Flat fee in bps, accrues to the maker (D4: 80). */
  feeBps: number;
  /** Epoch length; sets the program deadline (D5: 3). */
  epochDays: number;
  /** Share of vault total assets this band may commit, in percent (D5: 10). */
  bandSleevePct: number;
  /** Hard per-ship cap in raw quote units, independent of the sleeve percentage. */
  maxPerShip: bigint;
  /**
   * Minimum distance the band top must keep below spot, in bps.
   *
   * PRG-R3 fixed this at 200 bps. The approved demo mandate sits at spot-0.1%, which 200 bps
   * would refuse, so the margin became per-mandate: production keeps 200, demo uses 10. The
   * invariant that never bends is `bandHigh < spot`, enforced separately and unconditionally.
   */
  minBelowSpotBps: number;
};

export type CompileContext = {
  /** The vault. Aqua mode enforces receiver == maker, so this also receives the fills. */
  maker: `0x${string}`;
  /** The allowlisted router the strategy is shipped to (PRG-R7: only allowlisted apps). */
  app: `0x${string}`;
  /** Chainlink ETH/USD at build time, 8 decimals. */
  spotE8: bigint;
  /** Vault total assets in raw quote units, for the sleeve calculation (PRG-R5). */
  totalAssets: bigint;
  /** Raw quote units already committed to other ACTIVE strategies (PRG-R6 coverage). */
  alreadyShipped?: bigint;
  /** Liquid + parked quote the vault can actually honour (PRG-R6). Defaults to totalAssets. */
  liquidQuote?: bigint;
  /** Epoch id. Doubles as the salt, so it MUST differ from any previous epoch (PRG-R10). */
  epoch: number;
  /** Unix seconds at build time. Injected rather than read so compiles are deterministic. */
  now: bigint;
  /** Explicit ship size in raw quote units. Defaults to the full allowed sleeve. */
  shipQuoteAmount?: bigint;
};

export type CompiledBand = {
  spotE8: bigint;
  lowE8: bigint;
  highE8: bigint;
  rawPriceMinX18: bigint;
  rawPriceMaxX18: bigint;
};

/** What the Aqua registry needs to ship this strategy. Mirrors the SDK's CallInfo. */
export type ShipCallInfo = {
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
};

export type CompileResult = {
  mandate: MandateName;
  /** The bare SwapVM program bytes. */
  program: `0x${string}`;
  /**
   * The ABI-encoded Order struct: what actually goes on chain (PRG-R9). The program lives in
   * the last slice of order.data; this is NOT the bare program.
   */
  orderBytes: `0x${string}`;
  /** keccak256(orderBytes). Dead forever once docked (PRG-R10). */
  strategyHash: `0x${string}`;
  shipCallInfo: ShipCallInfo;
  /** Raw units registered per token. The empty side is 0 but still registered (PRG-R2). */
  shipped: { quote: bigint; base: bigint };
  band: CompiledBand;
  deadline: bigint;
  salt: bigint;
  epoch: number;
  /** Human-readable decode of the program, for the ship record and for review. */
  instructions: string[];
};
