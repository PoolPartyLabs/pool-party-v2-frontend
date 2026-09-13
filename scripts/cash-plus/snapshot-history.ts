/** @id PP-CP-LIB-025 @name Cash+ receipt-block evidence @implements-rules-version v1 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAddress } from "viem";
import { artifact, clients, deployment, loadState, local, stringify } from "./runtime";

async function main() {
  const d = await deployment();
  const state = loadState();
  const client = clients(state.rpcUrl).publicClient;
  const relevant = state.operations.filter((op) =>
    [
      "investor deposit",
      "park USDC",
      "official Aqua conversion with Aave JIT",
      "investor cash redemption",
    ].includes(op.label),
  );
  const snapshots = [];
  for (const op of relevant) {
    const blocks =
      op.label === "investor deposit"
        ? [BigInt(op.block) - BigInt(1), BigInt(op.block)]
        : [BigInt(op.block)];
    for (const blockNumber of blocks) {
      const read = (functionName: string, args: readonly unknown[] = []) =>
        client.readContract({
          address: getAddress(d.vault),
          abi: artifact("CashPlusVault").abi,
          functionName,
          args,
          blockNumber,
        });
      const [block, status, inventory, shares, cashflows] = await Promise.all([
        client.getBlock({ blockNumber }),
        read("status"),
        read("inventory"),
        read("sharesOf", [state.actors.investor]),
        read("accountCashflows", [state.actors.investor]),
      ]);
      snapshots.push({
        label: blockNumber < BigInt(op.block) ? "before investor deposit" : op.label,
        transactionHash: op.hash,
        blockNumber,
        blockHash: block.hash,
        status,
        inventory,
        shares,
        cashflows,
      });
    }
  }
  writeFileSync(
    resolve(local, "snapshot-history.json"),
    stringify({ runId: state.runId, vault: d.vault, snapshots }),
  );
  console.log(
    `Saved ${snapshots.length} receipt-block snapshots to ${resolve(local, "snapshot-history.json")}`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
