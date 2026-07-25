import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Aqua extension tables on the Neon prod mirror (SRV-R2).
 *
 * Scope is deliberately TWO tables for the 20-hour window (execution plan section 6.1):
 * `aqua_ships` and `aqua_fills`. `aqua_mandates`, `aqua_nav_snapshots` and `aqua_keeper_log`
 * are designed but deferred; the status script reads live state from chain instead of a
 * stored series, so no NAV table is needed to ship the demo.
 *
 * Money is `numeric` and read back as a STRING, never a JS number. Token amounts are raw
 * integer units (6dp for USDC, 18dp for WETH) held as numeric(78,0), which covers uint256.
 *
 * This file is intentionally free of `server-only`: drizzle-kit reads it from a plain Node
 * process to generate migrations. It declares table shapes and imports nothing sensitive.
 * The client that opens a connection (`./client.ts`) carries the guard.
 */

/** uint256 fits in 78 decimal digits. */
const rawAmount = (name: string) => numeric(name, { precision: 78, scale: 0 });

/**
 * One row per ship. A docked strategyHash is dead forever (PRG-R10), so rows are never
 * reused: a roll writes a NEW row with a new salt and marks the old one docked.
 */
export const aquaShips = pgTable(
  "aqua_ships",
  {
    id: text("id").primaryKey(),

    /** keccak256(ABI-encoded Order). The identity of the strategy on-chain (PRG-R9). */
    strategyHash: text("strategy_hash").notNull(),
    /** The vault (maker) whose Aqua balance backs this strategy. */
    maker: text("maker").notNull(),
    /** The router the strategy is shipped to, always the allowlisted gen-2 one. */
    app: text("app").notNull(),

    /** "production" or "demo": which mandate band this ship implements. */
    mandate: text("mandate").notNull(),

    /** The bare SwapVM program, and the ABI-encoded Order that wraps it. */
    programHex: text("program_hex").notNull(),
    orderBytes: text("order_bytes").notNull(),

    /** Epoch identity. salt == epoch id; every roll MUST change it (PRG-R10). */
    epoch: integer("epoch").notNull(),
    salt: rawAmount("salt").notNull(),
    deadline: bigint("deadline", { mode: "bigint" }).notNull(),

    /** Band as built, plus the Chainlink spot it was built against, all 8dp. */
    spotE8: rawAmount("spot_e8").notNull(),
    bandLowE8: rawAmount("band_low_e8").notNull(),
    bandHighE8: rawAmount("band_high_e8").notNull(),

    /** Raw token units shipped. The empty side is 0 but still registered (PRG-R2). */
    shippedUsdc: rawAmount("shipped_usdc").notNull(),
    shippedWeth: rawAmount("shipped_weth").notNull(),

    /** "active" | "docked". */
    status: text("status").notNull().default("active"),

    shipTxHash: text("ship_tx_hash"),
    dockTxHash: text("dock_tx_hash"),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    dockedAt: timestamp("docked_at", { withTimezone: true }),

    /** The mandate the compiler was given, kept verbatim so a ship is reproducible. */
    mandateSnapshot: jsonb("mandate_snapshot"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("aqua_ships_strategy_hash_key").on(table.strategyHash),
    index("aqua_ships_maker_status_idx").on(table.maker, table.status),
  ],
);

/**
 * One row per settled fill, keyed by (txHash, logIndex) so replaying a block range is
 * idempotent and can never double-count a fill.
 */
export const aquaFills = pgTable(
  "aqua_fills",
  {
    id: text("id").primaryKey(),

    strategyHash: text("strategy_hash").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockTimestamp: timestamp("block_timestamp", { withTimezone: true }).notNull(),

    taker: text("taker").notNull(),
    tokenIn: text("token_in").notNull(),
    tokenOut: text("token_out").notNull(),
    /** Raw units. tokenIn is what the taker gave us (WETH on a buy band). */
    amountIn: rawAmount("amount_in").notNull(),
    amountOut: rawAmount("amount_out").notNull(),

    /** Chainlink ETH/USD at fill time, 8dp. Marks the fill for attribution (IDX-R4). */
    markPriceE8: rawAmount("mark_price_e8"),

    /**
     * True when settlement had to unpark from the carry adapter, i.e. the fill exceeded the
     * hot buffer and the maker hook fired. This is the trace worth showing.
     */
    jitUnparked: boolean("jit_unparked").notNull().default(false),
    jitAmount: rawAmount("jit_amount"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("aqua_fills_tx_log_key").on(table.txHash, table.logIndex),
    index("aqua_fills_strategy_hash_idx").on(table.strategyHash),
  ],
);

export type AquaShip = typeof aquaShips.$inferSelect;
export type NewAquaShip = typeof aquaShips.$inferInsert;
export type AquaFill = typeof aquaFills.$inferSelect;
export type NewAquaFill = typeof aquaFills.$inferInsert;
