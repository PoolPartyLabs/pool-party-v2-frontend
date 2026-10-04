/**
 * @id PP-STR-LIB-026 (POO-2175)
 * @name fundReads
 * @implements-rules-version v2
 * PP-INTEGRATION-POINT: isolated investor and manager fund reads through the v2 client.
 */
import "server-only";
import { v2Fetch } from "./client";
import {
  balancesSchema,
  fundHistorySchema,
  fundListSchema,
  fundViewSchema,
  holderSchema,
  positionDetailSchema,
  positionsSchema,
  transitSchema,
  transitsSchema,
} from "./fundSchemas";
import { addressSchema, chainIdSchema, poolIdSchema } from "./schemas";
export const readFunds = () => v2Fetch("/funds", fundListSchema);
export const readFund = (core: string) =>
  v2Fetch(`/funds/${addressSchema.parse(core)}`, fundViewSchema);
export const readFundHistory = (core: string, cursor?: string) =>
  v2Fetch(
    `/funds/${addressSchema.parse(core)}/history?${new URLSearchParams({ limit: "20", ...(cursor ? { cursor } : {}) })}`,
    fundHistorySchema,
  );
export const readHolder = (core: string, wallet: string) =>
  v2Fetch(
    `/funds/${addressSchema.parse(core)}/holders/${addressSchema.parse(wallet)}`,
    holderSchema,
  );
export const readPositions = (core: string) =>
  v2Fetch(`/funds/${addressSchema.parse(core)}/positions`, positionsSchema);
export const readPosition = (core: string, chain: number, key: string) =>
  v2Fetch(
    `/funds/${addressSchema.parse(core)}/positions/${chainIdSchema.parse(chain)}/${poolIdSchema.parse(key)}`,
    positionDetailSchema,
  );
export const readTransits = (core: string, cursor?: string) =>
  v2Fetch(
    `/funds/${addressSchema.parse(core)}/transits?${new URLSearchParams({ limit: "20", ...(cursor ? { cursor } : {}) })}`,
    transitsSchema,
  );
export const readTransit = (core: string, id: string) =>
  v2Fetch(`/funds/${addressSchema.parse(core)}/transits/${poolIdSchema.parse(id)}`, transitSchema);
export const readBalances = (core: string, chain: number) =>
  v2Fetch(
    `/funds/${addressSchema.parse(core)}/spokes/${chainIdSchema.parse(chain)}/balances`,
    balancesSchema,
  );
