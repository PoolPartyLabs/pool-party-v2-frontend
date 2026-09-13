/**
 * @id PP-CORE-LIB-106 (POO-1801)
 * @name CAIP-2 chain identifiers
 * @implements-rules-version v1 (POO-1801 rules v1)
 * @analytics-events none, a pure identifier translation with no surface of its own.
 *
 * [R1] `eip155:<id>`, the CAIP-2 spelling of an EVM chain, for the one boundary that speaks it.
 *
 * Building the string is one template literal; what earns this module its place is the REGISTRY
 * CHECK on both sides. `supportedChainMetas` (`./config`) is the single source for which chains this
 * app ships, and an id absent from it has no business travelling to a vendor as a well-formed
 * destination: `eip155:1` is a real, famous identifier and a chain no balance of ours lives on. So an
 * unsupported id is refused rather than rendered, and a CAIP-2 string arriving from outside is
 * refused the same way rather than trusted, because otherwise the vendor gets to tell us which chain
 * we are on.
 *
 * `undefined` and not a throw, matching this folder's existing helpers (`getChainById`,
 * `getUsdcAddress`, `networkToChainId` all answer `undefined`): callers here are building a request,
 * and a missing destination is a decision to make, never an exception to unwind.
 */
import { supportedChainMetas } from "./config";

/** The CAIP-2 namespace for EVM chains. The only namespace this app speaks. */
const EIP155 = "eip155";

/**
 * A CAIP-2 reference is a DECIMAL chain id with no padding, so `0x2105` and `08453` are refused
 * rather than normalized: two spellings of one chain is how an equality check quietly starts
 * failing.
 */
const EIP155_REFERENCE = /^eip155:([1-9][0-9]*)$/;

/**
 * `eip155:<id>` for a chain this app ships, or `undefined` for anything else ([R1]).
 *
 * The return is the TEMPLATE LITERAL `${string}:${string}`, not `string`: the SDKs that consume a
 * CAIP-2 identifier type their parameter that way, and a plain `string` would force every call site
 * to re-assert with `as` what this function already guarantees.
 */
export function toCaip2(chainId: number): `${string}:${string}` | undefined {
  const supported = supportedChainMetas.some((meta) => meta.chain.id === chainId);
  return supported ? `${EIP155}:${chainId}` : undefined;
}

/** The chain id behind a CAIP-2 string, or `undefined` unless it names a chain this app ships ([R1]). */
export function fromCaip2(caip2: string): number | undefined {
  const reference = EIP155_REFERENCE.exec(caip2)?.[1];
  if (reference === undefined) return undefined;
  const chainId = Number(reference);
  return supportedChainMetas.some((meta) => meta.chain.id === chainId) ? chainId : undefined;
}
