CREATE TABLE "aqua_fills" (
	"id" text PRIMARY KEY NOT NULL,
	"strategy_hash" text NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp with time zone NOT NULL,
	"taker" text NOT NULL,
	"token_in" text NOT NULL,
	"token_out" text NOT NULL,
	"amount_in" numeric(78, 0) NOT NULL,
	"amount_out" numeric(78, 0) NOT NULL,
	"mark_price_e8" numeric(78, 0),
	"jit_unparked" boolean DEFAULT false NOT NULL,
	"jit_amount" numeric(78, 0),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aqua_ships" (
	"id" text PRIMARY KEY NOT NULL,
	"strategy_hash" text NOT NULL,
	"maker" text NOT NULL,
	"app" text NOT NULL,
	"mandate" text NOT NULL,
	"program_hex" text NOT NULL,
	"order_bytes" text NOT NULL,
	"epoch" integer NOT NULL,
	"salt" numeric(78, 0) NOT NULL,
	"deadline" bigint NOT NULL,
	"spot_e8" numeric(78, 0) NOT NULL,
	"band_low_e8" numeric(78, 0) NOT NULL,
	"band_high_e8" numeric(78, 0) NOT NULL,
	"shipped_usdc" numeric(78, 0) NOT NULL,
	"shipped_weth" numeric(78, 0) NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"ship_tx_hash" text,
	"dock_tx_hash" text,
	"shipped_at" timestamp with time zone,
	"docked_at" timestamp with time zone,
	"mandate_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "aqua_fills_tx_log_key" ON "aqua_fills" USING btree ("tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "aqua_fills_strategy_hash_idx" ON "aqua_fills" USING btree ("strategy_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "aqua_ships_strategy_hash_key" ON "aqua_ships" USING btree ("strategy_hash");--> statement-breakpoint
CREATE INDEX "aqua_ships_maker_status_idx" ON "aqua_ships" USING btree ("maker","status");