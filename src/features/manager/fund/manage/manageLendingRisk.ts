/**
 * @id PP-MGR-LIB-068 (POO-2290)
 * @name manageLendingRisk
 * @implements-rules-version v1
 * @linear https://linear.app/yeildbay/issue/POO-2290
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8682-3708
 * @analytics-events none, pure injected presentation; the host owns risk read/preview events.
 * Full account risk presentation only. No API DTO or protocol risk formula is assumed.
 */
export type LendingRiskIdentity =
  | { protocol: "aave-v3"; chainId: number; core: string; account: string; market: string }
  | {
      protocol: "kamino-lend";
      cluster: "mainnet-beta" | "devnet" | "testnet";
      program: string;
      account: string;
      market: string;
      obligation: string;
    };
export type LendingRiskToken =
  | { network: "evm"; chainId: number; address: string; symbol: string; decimals: number }
  | {
      network: "solana";
      cluster: "mainnet-beta" | "devnet" | "testnet";
      kind: "spl";
      mint: string;
      symbol: string;
      decimals: number;
    }
  | {
      network: "solana";
      cluster: "mainnet-beta" | "devnet" | "testnet";
      kind: "native";
      symbol: "SOL";
      decimals: 9;
    };
export interface LendingRiskSource {
  kind: "observed" | "fixture";
  reference: string;
  asOf: string;
  blockOrSlot: string | null;
  freshness: "fresh" | "stale" | "unknown";
}
export interface LendingRiskAssetAmount {
  token: LendingRiskToken;
  raw: string;
}
export interface LendingRiskOracle {
  token: LendingRiskToken;
  decimal: string;
  unit: "USD-per-token";
  provider: string;
  snapshotId: string;
  source: LendingRiskSource;
}
export interface LendingRiskParameter {
  token: LendingRiskToken;
  liquidationThresholdRatio: string | null;
  /** Required effective factor for Kamino debt; Aave may omit this in supplied results. */
  borrowFactorRatio: string | null;
}
export interface LendingRiskContext {
  snapshotId: string;
  scenarioId: string;
  method: string;
  assumptions: string[];
  collateral: LendingRiskAssetAmount[];
  debt: LendingRiskAssetAmount[];
  oracles: LendingRiskOracle[];
  parameters: LendingRiskParameter[];
}
export interface LendingRiskSnapshot {
  identity: LendingRiskIdentity;
  snapshotId: string;
  source: LendingRiskSource;
  complete: boolean;
  debt: {
    status: "confirmed" | "partial" | "unavailable";
    total: { decimal: string; currency: "USD" } | null;
  };
  scenario:
    | { kind: "current"; id: string }
    | { kind: "preview"; id: string; baseSnapshotId: string; valid: boolean };
  context: LendingRiskContext | null;
  healthFactor: { decimal: string; unit: "ratio"; scenarioId: string } | null;
  liquidationPrice:
    | {
        status: "available";
        decimal: string;
        unit: "USD-per-token";
        asset: LendingRiskToken;
        scenarioId: string;
      }
    | { status: "no-positive-root"; scenarioId: string }
    | null;
}
export interface ManageLendingRiskOrigin {
  /** Null when the authorized host has no verified full account or obligation. */
  identity: LendingRiskIdentity | null;
  /** The host ties the successful preview to its selected draft and base account snapshot. */
  preview: { id: string; baseSnapshotId: string } | null;
}
export interface LendingRiskRead {
  status: "loading" | "error" | "unavailable" | "ready";
  snapshot: LendingRiskSnapshot | null;
}
export type LendingRiskReason =
  | "accountUnavailable"
  | "loading"
  | "readError"
  | "stale"
  | "partial"
  | "previewUnavailable"
  | "riskUnavailable";
export interface LendingRiskColumnView {
  status: "unavailable" | "noDebt" | "ready";
  reason: LendingRiskReason | null;
  source: LendingRiskSource | null;
  snapshotId: string | null;
  scenarioId: string | null;
  healthFactor: string | null;
  liquidationPrice: { decimal: string; asset: LendingRiskToken } | null;
  noPositiveRoot: boolean;
  context: LendingRiskContext | null;
}
export interface ManageLendingRiskView {
  identity: LendingRiskIdentity | null;
  current: LendingRiskColumnView;
  after: LendingRiskColumnView;
}
const blankColumn = (reason: LendingRiskReason = "accountUnavailable"): LendingRiskColumnView => ({
  status: "unavailable",
  reason,
  source: null,
  snapshotId: null,
  scenarioId: null,
  healthFactor: null,
  liquidationPrice: null,
  noPositiveRoot: false,
  context: null,
});
/** Validate each full account scenario independently. Metrics are supplied, never calculated here. */
export function projectManageLendingRisk(
  origin: ManageLendingRiskOrigin,
  current: LendingRiskRead,
  after: LendingRiskRead,
): ManageLendingRiskView {
  const identity = origin.identity && validIdentity(origin.identity) ? origin.identity : null;
  if (!identity) return { identity: null, current: blankColumn(), after: blankColumn() };
  const currentView = projectColumn(identity, origin.preview, current, false);
  // A preview is independent in value, but must belong to this verified complete Current base.
  const previewMatchesBase =
    currentView.status !== "unavailable" &&
    currentView.source !== null &&
    currentView.snapshotId !== null &&
    origin.preview?.baseSnapshotId === currentView.snapshotId;
  return {
    identity,
    current: currentView,
    after: previewMatchesBase
      ? projectColumn(identity, origin.preview, after, true)
      : blankColumn("previewUnavailable"),
  };
}
function projectColumn(
  identity: LendingRiskIdentity,
  preview: ManageLendingRiskOrigin["preview"],
  read: LendingRiskRead,
  isAfter: boolean,
): LendingRiskColumnView {
  if (read.status !== "ready")
    return blankColumn(
      read.status === "loading"
        ? "loading"
        : read.status === "error"
          ? "readError"
          : isAfter
            ? "previewUnavailable"
            : "accountUnavailable",
    );
  const snapshot = read.snapshot;
  if (!snapshot || !validIdentity(snapshot.identity) || !sameIdentity(identity, snapshot.identity))
    return blankColumn();
  if (!validSource(snapshot.source))
    return blankColumn(snapshot.source.freshness === "stale" ? "stale" : "accountUnavailable");
  if (!text(snapshot.snapshotId) || !text(snapshot.scenario.id))
    return blankColumn("riskUnavailable");
  const scenario = snapshot.scenario;
  if (
    isAfter
      ? scenario.kind !== "preview" ||
        !scenario.valid ||
        !preview ||
        !text(preview.id) ||
        !text(preview.baseSnapshotId) ||
        scenario.id !== preview.id ||
        scenario.baseSnapshotId !== preview.baseSnapshotId
      : scenario.kind !== "current"
  )
    return blankColumn("previewUnavailable");
  const source = {
    ...blankColumn(),
    source: snapshot.source,
    snapshotId: snapshot.snapshotId,
    scenarioId: scenario.id,
  };
  if (!snapshot.complete || snapshot.debt.status !== "confirmed")
    return { ...source, reason: "partial" };
  const total = snapshot.debt.total;
  if (total?.currency !== "USD" || !decimal(total.decimal))
    return { ...source, reason: "riskUnavailable" };
  if (zero(total.decimal)) {
    // A known nonzero or malformed aggregate debt contradicts a no-debt claim. No Supply-row inference.
    if (
      snapshot.context &&
      (!Array.isArray(snapshot.context.debt) ||
        snapshot.context.debt.some((amount) => !validAmount(amount, identity) || !zero(amount.raw)))
    )
      return { ...source, reason: "riskUnavailable" };
    return { ...source, status: "noDebt", reason: null };
  }
  const context = snapshot.context;
  if (!context || !validContext(context, snapshot, identity))
    return { ...source, reason: "riskUnavailable" };
  const hf = snapshot.healthFactor;
  const healthFactor =
    hf && hf.unit === "ratio" && hf.scenarioId === scenario.id && decimal(hf.decimal)
      ? hf.decimal
      : null;
  const price = snapshot.liquidationPrice;
  const matches = price?.scenarioId === scenario.id;
  const liquidationPrice =
    price?.status === "available" &&
    matches &&
    price.unit === "USD-per-token" &&
    decimal(price.decimal) &&
    !zero(price.decimal) &&
    validToken(price.asset, identity) &&
    [...context.collateral, ...context.debt].some((amount) => sameToken(amount.token, price.asset))
      ? { decimal: price.decimal, asset: price.asset }
      : null;
  return {
    ...source,
    status: "ready",
    reason: !healthFactor || !liquidationPrice ? "riskUnavailable" : null,
    context,
    healthFactor,
    liquidationPrice,
    noPositiveRoot: Boolean(matches && price?.status === "no-positive-root"),
  };
}
function validContext(
  context: LendingRiskContext,
  snapshot: LendingRiskSnapshot,
  identity: LendingRiskIdentity,
): boolean {
  if (
    context.snapshotId !== snapshot.snapshotId ||
    context.scenarioId !== snapshot.scenario.id ||
    !text(context.method) ||
    !context.assumptions.length ||
    !context.assumptions.every(text) ||
    !context.debt.length
  )
    return false;
  const amounts = [...context.collateral, ...context.debt];
  if (
    !amounts.every((amount) => validAmount(amount, identity)) ||
    !context.debt.some((amount) => !zero(amount.raw))
  )
    return false;
  for (const group of [context.collateral, context.debt])
    if (new Set(group.map((amount) => tokenKey(amount.token))).size !== group.length) return false;
  if (
    !context.oracles.every(
      (oracle) =>
        validToken(oracle.token, identity) &&
        amounts.some((amount) => sameToken(amount.token, oracle.token)) &&
        oracle.snapshotId === snapshot.snapshotId &&
        oracle.unit === "USD-per-token" &&
        text(oracle.provider) &&
        decimal(oracle.decimal) &&
        !zero(oracle.decimal) &&
        validSource(oracle.source),
    )
  )
    return false;
  if (
    !context.parameters.every(
      (parameter) =>
        validToken(parameter.token, identity) &&
        amounts.some((amount) => sameToken(amount.token, parameter.token)) &&
        (parameter.liquidationThresholdRatio === null ||
          (decimal(parameter.liquidationThresholdRatio) &&
            ratioAtMostOne(parameter.liquidationThresholdRatio))) &&
        (parameter.borrowFactorRatio === null ||
          (decimal(parameter.borrowFactorRatio) &&
            BigInt(parameter.borrowFactorRatio.split(".")[0] ?? "0") >= BigInt(1))),
    )
  )
    return false;
  if (
    new Set(context.oracles.map((oracle) => tokenKey(oracle.token))).size !==
      context.oracles.length ||
    new Set(context.parameters.map((parameter) => tokenKey(parameter.token))).size !==
      context.parameters.length
  )
    return false;
  for (const { token } of amounts) {
    const oracle = context.oracles.find((entry) => sameToken(entry.token, token));
    if (
      !oracle ||
      oracle.snapshotId !== snapshot.snapshotId ||
      oracle.unit !== "USD-per-token" ||
      !text(oracle.provider) ||
      !decimal(oracle.decimal) ||
      zero(oracle.decimal) ||
      !validSource(oracle.source)
    )
      return false;
  }
  for (const { token } of context.collateral) {
    const threshold = context.parameters.find((entry) =>
      sameToken(entry.token, token),
    )?.liquidationThresholdRatio;
    if (!threshold || !decimal(threshold) || !ratioAtMostOne(threshold)) return false;
  }
  // Kamino adjusted debt needs its effective borrow factor. Do not infer this parameter for Aave.
  for (const { token } of identity.protocol === "kamino-lend" ? context.debt : []) {
    const factor = context.parameters.find((entry) =>
      sameToken(entry.token, token),
    )?.borrowFactorRatio;
    if (!factor || !decimal(factor) || BigInt(factor.split(".")[0] ?? "0") < BigInt(1))
      return false;
  }
  return true;
}
const text = (value: string): boolean =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 512;
const unsigned = (value: string): boolean =>
  typeof value === "string" && /^(0|[1-9]\d{0,77})$/.test(value);
const decimal = (value: string): boolean =>
  typeof value === "string" && value.length <= 300 && /^(0|[1-9]\d*)(?:\.\d+)?$/.test(value);
const zero = (value: string): boolean => /^0(?:\.0+)?$/.test(value);
const ratioAtMostOne = (value: string): boolean =>
  /^0(?:\.\d+)?$/.test(value) || /^1(?:\.0+)?$/.test(value);
const evmAddress = (value: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(value);
const cluster = (value: string): boolean => ["mainnet-beta", "devnet", "testnet"].includes(value);
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** Base58 is decoded without case folding; a Solana identity must contain exactly 32 bytes. */
function solanaAddress(value: string): boolean {
  if (typeof value !== "string" || value.length < 32 || value.length > 44) return false;
  let decoded = BigInt(0);
  for (const char of value) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return false;
    decoded = decoded * BigInt(58) + BigInt(digit);
  }
  let bytes = 0;
  for (let rest = decoded; rest > BigInt(0); rest >>= BigInt(8)) bytes++;
  for (const char of value) {
    if (char !== "1") break;
    bytes++;
  }
  return bytes === 32;
}
function validIdentity(identity: LendingRiskIdentity): boolean {
  return identity.protocol === "aave-v3"
    ? Number.isSafeInteger(identity.chainId) &&
        identity.chainId > 0 &&
        [identity.core, identity.account, identity.market].every(evmAddress)
    : identity.protocol === "kamino-lend" &&
        cluster(identity.cluster) &&
        [identity.program, identity.account, identity.market, identity.obligation].every(
          solanaAddress,
        );
}
function sameIdentity(a: LendingRiskIdentity, b: LendingRiskIdentity): boolean {
  if (a.protocol === "aave-v3" && b.protocol === "aave-v3")
    return (
      a.chainId === b.chainId &&
      a.core.toLowerCase() === b.core.toLowerCase() &&
      a.account.toLowerCase() === b.account.toLowerCase() &&
      a.market.toLowerCase() === b.market.toLowerCase()
    );
  return (
    a.protocol === "kamino-lend" &&
    b.protocol === "kamino-lend" &&
    a.cluster === b.cluster &&
    a.program === b.program &&
    a.account === b.account &&
    a.market === b.market &&
    a.obligation === b.obligation
  );
}
function validToken(token: LendingRiskToken, identity: LendingRiskIdentity): boolean {
  if (
    !text(token.symbol) ||
    token.symbol.length > 32 ||
    !Number.isInteger(token.decimals) ||
    token.decimals < 0 ||
    token.decimals > 255
  )
    return false;
  if (token.network === "evm")
    return (
      identity.protocol === "aave-v3" &&
      token.chainId === identity.chainId &&
      token.decimals <= 36 &&
      evmAddress(token.address)
    );
  if (identity.protocol !== "kamino-lend" || token.cluster !== identity.cluster) return false;
  if (token.kind === "native") return token.symbol === "SOL" && token.decimals === 9;
  if (token.kind !== "spl" || !solanaAddress(token.mint)) return false;
  return (
    (token.mint !== "So11111111111111111111111111111111111111112" || token.decimals === 9) &&
    (token.cluster !== "mainnet-beta" ||
      token.mint !== "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" ||
      token.decimals === 6)
  );
}
function tokenKey(token: LendingRiskToken): string {
  return token.network === "evm"
    ? `evm:${token.chainId}:${token.address.toLowerCase()}`
    : `solana:${token.cluster}:${token.kind}:${token.kind === "spl" ? token.mint : "native"}`;
}
function sameToken(a: LendingRiskToken, b: LendingRiskToken): boolean {
  return tokenKey(a) === tokenKey(b) && a.symbol === b.symbol && a.decimals === b.decimals;
}
function validAmount(amount: LendingRiskAssetAmount, identity: LendingRiskIdentity): boolean {
  return (
    validToken(amount.token, identity) &&
    unsigned(amount.raw) &&
    BigInt(amount.raw) < BigInt(2) ** BigInt(256)
  );
}
function validSource(source: LendingRiskSource): boolean {
  return (
    source.freshness === "fresh" &&
    text(source.reference) &&
    validTimestamp(source.asOf) &&
    (source.kind === "fixture"
      ? source.blockOrSlot === null
      : source.kind === "observed" && source.blockOrSlot !== null && unsigned(source.blockOrSlot))
  );
}
function validTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    return false;
  const date = value.slice(0, 10),
    parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
    return false;
  const [hour = 24, minute = 60, second = 60] = value.slice(11, 19).split(":").map(Number);
  return hour < 24 && minute < 60 && second < 60 && Number.isFinite(new Date(value).getTime());
}
/** Presentation conversion, exact raw units with no Number or monetary arithmetic. */
export function lendingRiskAmountDecimal(amount: LendingRiskAssetAmount): string {
  if (amount.token.decimals === 0) return amount.raw;
  const digits = amount.raw.padStart(amount.token.decimals + 1, "0");
  const whole = digits.slice(0, -amount.token.decimals),
    fraction = digits.slice(-amount.token.decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
