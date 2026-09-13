/**
 * @id PP-AUTH-LIB-005
 * @name personal_sign encoding
 * @implements-rules-version v2
 * @analytics-events none, a signing primitive with no user-visible step of its own; the flows that
 *   call it carry their own funnels.
 *
 * The one place that decides how a message reaches `personal_sign` (POO-1407).
 *
 * ## Why this exists as a function rather than a convention
 *
 * EIP-191's `personal_sign` takes its payload HEX-ENCODED. Every call site in this app used to pass
 * the raw string, and MetaMask and Rabby accept that, which is why it survived unnoticed through six
 * separate signing flows. Ledger Live does not: handed a raw string where hex is expected it decodes
 * to an EMPTY buffer and signs THAT, returning a well-formed 65-byte signature over nothing. The
 * digest of the empty message is the constant `0x5f35dce9…`, so every attempt recovers a different
 * meaningless address and no amount of retrying helps.
 *
 * That defect was found in the SIWE handshake, but nothing about it was specific to SIWE. The same
 * raw string went to `personal_sign` from the profile save, both manager writes, the rewards claim
 * and the on-ramp `requestId` mint. Fixing only the one where it was noticed would have moved a
 * Ledger user from "cannot sign in" to "signed in, and every write fails", which is strictly harder
 * to diagnose from a support ticket, and one of those writes is a money path.
 *
 * A shared function rather than the same one-line edit copied six times, because the encoding is a
 * single fact about a single RPC. Copies drift, and the next signing flow added to this app inherits
 * the correct behaviour by calling this instead of by remembering a rule.
 *
 * ## Why hex is safe for every wallet, not just the one that needed it
 *
 * This is the well-trodden path, not a workaround: viem's `signMessage` hex-encodes unconditionally,
 * so every wagmi dapp already sends hex to every wallet, and Privy's own login sign calls the same
 * RPC with `toHex(message)`. The digest is unchanged either way for any wallet that decodes the hex,
 * so a signature produced here verifies against exactly the message the backend rebuilds.
 */
"use client";

import { toHex } from "viem";
import type { Eip1193Provider } from "@/lib/tx/sendTransaction";

/**
 * `personal_sign` the message with `address`, encoded the way the spec says.
 *
 * Errors propagate: a rejected prompt is the user's answer, and swallowing it here would turn one
 * refusal into a second one somewhere up the stack.
 */
export async function personalSign(
  provider: Eip1193Provider,
  message: string,
  address: string,
): Promise<string> {
  return (await provider.request({
    method: "personal_sign",
    params: [toHex(message), address],
  })) as string;
}
