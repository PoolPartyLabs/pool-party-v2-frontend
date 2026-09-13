/** @id PP-CP-LIB-022 @name Cash+ fork operator CLI @implements-rules-version v1 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type Address,
  BaseError,
  ContractFunctionRevertedError,
  encodeDeployData,
  erc20Abi,
  getAddress,
  type Hex,
  keccak256,
  parseAbi,
  parseUnits,
  toHex,
} from "viem";
import {
  type CashPlusDeployment,
  parseCashPlusDeployment,
} from "../../src/lib/cash-plus/config/deployments";
import {
  B,
  compileOrder,
  encodeOrder,
  type Order,
  orderHash,
  type ProgramParameters,
  takerTraits,
} from "./compiler";
import { archivePreviousRun, historicalForkStateUnavailable, startFreshFork } from "./fresh-fork";
import {
  type Actors,
  artifact,
  artifactNames,
  assertFork,
  buildContracts,
  clients,
  codeHash,
  contractsRoot,
  deployArtifact,
  deployment,
  exportAbis,
  loadState,
  local,
  newState,
  official,
  read,
  root,
  rpc,
  saveState,
  stateExists,
  stringify,
  transact,
  upstreamCommit,
} from "./runtime";

const routerAbi = parseAbi([
  "function AQUA() view returns(address)",
  "function hash((address maker,uint256 traits,bytes data) order) view returns(bytes32)",
  "function quote((address maker,uint256 traits,bytes data) order,address tokenIn,address tokenOut,uint256 amount,bytes takerTraitsAndData) view returns(uint256,uint256,bytes32)",
  "function swap((address maker,uint256 traits,bytes data) order,address tokenIn,address tokenOut,uint256 amount,bytes takerTraitsAndData) returns(uint256,uint256,bytes32)",
]);
const aTokenAbi = parseAbi([
  "function UNDERLYING_ASSET_ADDRESS() view returns(address)",
  "function POOL() view returns(address)",
]);
const feedAbi = parseAbi([
  "function description() view returns(string)",
  "function decimals() view returns(uint8)",
]);
const vaultAbi = () => artifact("CashPlusVault").abi;
const programAbi = () => artifact("CashPlusProgramFactory").abi;
const arg = (key: string, fallback?: string) => {
  const index = process.argv.indexOf(`--${key}`);
  return index < 0 ? fallback : process.argv[index + 1];
};
const flag = (key: string) => process.argv.includes(`--${key}`);
const address = (s: string) => getAddress(s);
const must = <T>(value: T | null | undefined): T => {
  if (value == null) throw new Error("REQUIRED_BINDING_MISSING");
  return value;
};
const same = (a: unknown, b: string) => String(a).toLowerCase() === b.toLowerCase();
function amount(value: string | undefined, fallback: string): bigint {
  const raw = value ?? fallback;
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(raw))
    throw new Error("AMOUNT_REQUIRES_PLAIN_DECIMAL_MAX_6_PLACES");
  const n = parseUnits(raw, 6);
  if (n <= B(0) || n >= B(2) ** B(256)) throw new Error("INVALID_AMOUNT");
  return n;
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function funding(token: Address, holder: Address, to: Address, n: bigint) {
  const state = loadState();
  await assertFork(state.rpcUrl, state.forkInstanceId);
  await rpc(state.rpcUrl, "anvil_impersonateAccount", [holder]);
  try {
    await rpc(state.rpcUrl, "anvil_setBalance", [holder, toHex(parseUnits("1", 18))]);
    await transact(
      holder,
      token,
      erc20Abi,
      "transfer",
      [to, n],
      "fixture funding via fork impersonation",
    );
  } finally {
    await rpc(state.rpcUrl, "anvil_stopImpersonatingAccount", [holder]);
  }
}
async function getter(
  d: CashPlusDeployment,
  name: string,
  args: readonly unknown[] = [],
): Promise<unknown> {
  return read(address(d.vault), vaultAbi(), name, args);
}
async function deploy(options: { rpcUrl?: string; fresh?: boolean; built?: boolean } = {}) {
  if (stateExists() && !flag("new-run") && !options.fresh) {
    console.log(
      "Existing run found. Verifying it; pass --new-run to deploy another vault without resetting the chain.",
    );
    await verify();
    return;
  }
  if (!flag("skip-build") && !options.built) buildContracts();
  exportAbis();
  const rpcUrl = options.rpcUrl ?? must(arg("rpc", "http://127.0.0.1:8550"));
  const metadata = await assertFork(rpcUrl);
  const accounts = await rpc<Address[]>(rpcUrl, "eth_accounts");
  if (accounts.length < 5) throw new Error("FIVE_UNLOCKED_ANVIL_TEST_ACCOUNTS_REQUIRED");
  const actors: Actors = {
    governance: must(accounts[0]),
    investor: must(accounts[1]),
    keeper: must(accounts[2]),
    guardian: must(accounts[3]),
    counterparty: must(accounts[4]),
  };
  saveState(
    newState(
      rpcUrl,
      String(must(metadata.forkedNetwork).forkBlockNumber),
      actors,
      metadata.instanceId,
    ),
  );
  await funding(official.usdc, official.aUsdc, actors.governance, parseUnits("1000", 6));
  await funding(official.usdc, official.aUsdc, actors.investor, parseUnits("10000", 6));
  await funding(official.usdc, official.aUsdc, actors.counterparty, parseUnits("1000", 6));
  await funding(official.secondary, official.aSecondary, actors.governance, parseUnits("100", 6));
  await funding(
    official.secondary,
    official.aSecondary,
    actors.counterparty,
    parseUnits("1000", 6),
  );
  const factory = await deployArtifact(actors.governance, "CashPlusDeploymentFactory");
  const config = {
    usdc: official.usdc,
    secondary: official.secondary,
    aqua: official.aqua,
    router: official.router,
    pool: official.pool,
    usdcAToken: official.aUsdc,
    secondaryAToken: official.aSecondary,
    usdcFeed: official.usdcFeed,
    secondaryFeed: official.secondaryFeed,
    sequencerFeed: official.sequencer,
    usdcMaxAge: 90000,
    secondaryMaxAge: 90000,
    maxFeedSkew: 90000,
    sequencerGrace: 3600,
    pegDeviationBps: 50,
    governance: actors.governance,
    keeper: actors.keeper,
    guardian: actors.guardian,
    hardDepositCap: parseUnits("1000000", 6),
  };
  const policy = {
    depositCap: parseUnits("1000000", 6),
    minDeposit: parseUnits("1", 6),
    maxFillBps: 100,
    dailyBudgetBps: 2000,
    secondaryTargetBps: 1000,
    secondaryCapBps: 2000,
    baseSpreadBps: 5,
    maxSurchargeBps: 10,
    hotUsdcBps: 500,
    hotSecondaryBps: 0,
  };
  const initCode = encodeDeployData({
    abi: vaultAbi(),
    bytecode: artifact("CashPlusVault").bytecode.object,
    args: [config, policy],
  });
  if ((initCode.length - 2) / 2 > 49152) throw new Error("EIP3860_INIT_CODE_LIMIT");
  if ((artifact("CashPlusVault").deployedBytecode.object.length - 2) / 2 > 24576)
    throw new Error("EIP170_RUNTIME_LIMIT");
  const salt = toHex(randomBytes(32));
  const factoryAbi = artifact("CashPlusDeploymentFactory").abi;
  const vault = (await read(factory, factoryAbi, "predict", [
    actors.governance,
    salt,
    keccak256(initCode),
  ])) as Address;
  await transact(
    actors.governance,
    official.usdc,
    erc20Abi,
    "approve",
    [factory, parseUnits("1000", 6)],
    "approve locked sponsor seed",
  );
  const receipt = await transact(
    actors.governance,
    factory,
    factoryAbi,
    "deploy",
    [initCode, official.usdc, parseUnits("1000", 6), salt],
    "atomic vault deployment and seed",
  );
  const get = async (name: string) => (await read(vault, vaultAbi(), name)) as Address;
  const [usdcAdapter, secondaryAdapter, pricing, programFactory, oracle, lens] = await Promise.all([
    get("USDC_ADAPTER"),
    get("SECONDARY_ADAPTER"),
    get("PRICING"),
    get("PROGRAM_FACTORY"),
    get("ORACLE"),
    get("LENS"),
  ]);
  const addresses = [
    vault,
    factory,
    usdcAdapter,
    secondaryAdapter,
    pricing,
    programFactory,
    oracle,
    lens,
    official.aqua,
    official.router,
    official.pool,
    official.usdc,
    official.secondary,
    official.aUsdc,
    official.aSecondary,
    official.usdcFeed,
    official.secondaryFeed,
    official.sequencer,
  ];
  const codeHashes = [];
  for (const target of addresses)
    codeHashes.push({ address: target, hash: await codeHash(target) });
  const block = await clients(rpcUrl).publicClient.getBlock({ blockNumber: receipt.blockNumber });
  const state = loadState();
  const manifest = parseCashPlusDeployment({
    schemaVersion: 1,
    id: `cash-plus-${state.runId}`,
    runId: state.runId,
    mode: "fork",
    chainId: 31337,
    networkName: "Local Arbitrum fork",
    rpcUrl,
    deploymentBlock: receipt.blockNumber.toString(),
    deploymentBlockHash: block.hash,
    vault,
    aqua: official.aqua,
    router: official.router,
    aavePool: official.pool,
    usdc: { address: official.usdc, symbol: "USDC", decimals: 6 },
    secondary: { address: official.secondary, symbol: "USD₮0", decimals: 6 },
    usdcAdapter,
    secondaryAdapter,
    usdcAToken: official.aUsdc,
    secondaryAToken: official.aSecondary,
    pricing,
    programFactory,
    oracle,
    usdcFeed: official.usdcFeed,
    secondaryFeed: official.secondaryFeed,
    sequencerFeed: official.sequencer,
    explorerUrl: null,
    codeHashes,
    source: { chainId: 42161, blockNumber: state.sourceBlock, swapVmCommit: upstreamCommit },
  });
  state.deployment = manifest;
  saveState(state);
  writeFileSync(
    resolve(root, "src/lib/cash-plus/config/deployment.generated.json"),
    `${stringify(manifest)}\n`,
  );
  await transact(
    actors.governance,
    vault,
    vaultAbi(),
    "setAllowedTaker",
    [actors.counterparty, true],
    "authorize designated demo counterparty",
  );
  await transact(
    actors.governance,
    official.secondary,
    erc20Abi,
    "transfer",
    [vault, parseUnits("100", 6)],
    "disclosed sponsor secondary inventory donation",
  );
  await verify();
  await keeperOnce();
  await ship();
  await report();
  console.log(`Ready: ${vault}; investor ${actors.investor}; run ${state.runId}; ${rpcUrl}`);
}
async function verify() {
  const d = await deployment();
  const s = loadState();
  if (d.source.swapVmCommit !== upstreamCommit) throw new Error("SWAP_VM_SOURCE_MISMATCH");
  for (const name of artifactNames) {
    const hash = createHash("sha256")
      .update(JSON.stringify(artifact(name).abi))
      .digest("hex");
    if (hash !== s.abiHashes[name]) throw new Error(`ABI_MISMATCH ${name}`);
  }
  for (const binding of d.codeHashes)
    if ((await codeHash(address(binding.address))) !== binding.hash)
      throw new Error(`CODE_CHANGED ${binding.address}`);
  const pairs: [[string, string], ...Array<[string, string]>] = [
    ["USDC", d.usdc.address],
    ["SECONDARY_STABLE", d.secondary.address],
    ["AQUA", d.aqua],
    ["ROUTER", d.router],
    ["USDC_ADAPTER", d.usdcAdapter],
    ["SECONDARY_ADAPTER", must(d.secondaryAdapter)],
    ["PRICING", d.pricing],
    ["PROGRAM_FACTORY", d.programFactory],
    ["ORACLE", d.oracle],
    ["GOVERNANCE", s.actors.governance],
    ["KEEPER", s.actors.keeper],
    ["GUARDIAN", s.actors.guardian],
  ];
  for (const [getterName, value] of pairs)
    if (!same(await getter(d, getterName), value)) throw new Error(`VAULT_BINDING ${getterName}`);
  if (!same(await read(address(d.router), routerAbi, "AQUA"), d.aqua))
    throw new Error("ROUTER_AQUA_MISMATCH");
  for (const [token, adapter, receipt] of [
    [d.usdc.address, d.usdcAdapter, d.usdcAToken],
    [d.secondary.address, must(d.secondaryAdapter), must(d.secondaryAToken)],
  ]) {
    if ((await read(address(must(token)), erc20Abi, "decimals")) !== 6)
      throw new Error("TOKEN_DECIMALS");
    for (const [fn, value] of [
      ["VAULT", d.vault],
      ["UNDERLYING", must(token)],
      ["POOL", d.aavePool],
      ["A_TOKEN", must(receipt)],
    ])
      if (
        !same(
          await read(address(must(adapter)), artifact("CashPlusAaveAdapter").abi, must(fn), []),
          must(value),
        )
      )
        throw new Error(`ADAPTER_BINDING ${fn}`);
    if (
      !same(
        await read(address(must(receipt)), aTokenAbi, "UNDERLYING_ASSET_ADDRESS"),
        must(token),
      ) ||
      !same(await read(address(must(receipt)), aTokenAbi, "POOL"), d.aavePool)
    )
      throw new Error("RESERVE_MISMATCH");
  }
  if (
    (await read(address(d.usdcFeed), feedAbi, "description")) !== "USDC / USD" ||
    (await read(address(d.secondaryFeed), feedAbi, "description")) !== "USDT / USD"
  )
    throw new Error("FEED_METADATA_MISMATCH");
  const block = await clients(s.rpcUrl).publicClient.getBlock({
    blockNumber: B(d.deploymentBlock),
  });
  if (block.hash !== d.deploymentBlockHash) throw new Error("DEPLOYMENT_BLOCK_REORG");
  const status = (await getter(d, "status")) as { valuationAvailable: boolean };
  if (!status.valuationAvailable) throw new Error("VALUATION_UNAVAILABLE");
  console.log(
    `Verified ${d.id}: bytecode, ABI, roles, reserve wiring, oracle metadata and deployment block.`,
  );
}
async function ship() {
  const d = await deployment();
  const s = loadState();
  const c = clients(s.rpcUrl);
  const current = await c.publicClient.getBlock();
  const active = (await getter(d, "activeStrategies")) as Hex[];
  for (const hash of active) {
    const record = (await getter(d, "strategies", [hash])) as readonly [bigint, bigint, number];
    if (
      record[1] > current.timestamp + B(45) &&
      record[0] === (await getter(d, "policyVersion")) &&
      s.orders[hash]
    ) {
      console.log(`Active canonical order ${hash}`);
      return hash;
    }
  }
  const inventory = (await getter(d, "inventory")) as Array<{
    walletBalance: bigint;
    adapterIdleBalance: bigint;
    lendingBalance: bigint;
  }>;
  const holdings = (i: number) => {
    const t = must(inventory[i]);
    return t.walletBalance + t.adapterIdleBalance + t.lendingBalance;
  };
  const p: ProgramParameters = {
    policyVersion: (await getter(d, "policyVersion")) as bigint,
    deadline: current.timestamp + B(300),
    salt: toHex(randomBytes(32)),
    usdcVirtualBalance: holdings(0),
    secondaryVirtualBalance: holdings(1),
  };
  const order = compileOrder(address(d.vault), address(d.pricing), p);
  const encoded = encodeOrder(order);
  const factoryEncoded = await read(address(d.programFactory), programAbi(), "encode", [p]);
  if (encoded.toLowerCase() !== String(factoryEncoded).toLowerCase())
    throw new Error("FACTORY_COMPILER_MISMATCH");
  if ((await read(address(d.router), routerAbi, "hash", [order])) !== orderHash(order))
    throw new Error("ROUTER_HASH_MISMATCH");
  // Probe new Aqua storage before removing old orders whenever the contract has a free slot.
  const maximumActive = Number(await getter(d, "MAX_ACTIVE_ORDERS"));
  if (active.length < maximumActive)
    await c.publicClient.simulateContract({
      account: s.actors.keeper,
      address: address(d.vault),
      abi: vaultAbi(),
      functionName: "shipCanonical",
      args: [p],
    });
  for (const hash of active)
    await transact(
      s.actors.keeper,
      address(d.vault),
      vaultAbi(),
      "dock",
      [hash],
      "dock expired or expiring order",
    );
  await transact(
    s.actors.keeper,
    address(d.vault),
    vaultAbi(),
    "shipCanonical",
    [p],
    "ship canonical Aqua order",
  );
  const latest = loadState();
  latest.orders[orderHash(order)] = {
    ...order,
    traits: order.traits.toString(),
    deadline: p.deadline.toString(),
  };
  saveState(latest);
  console.log(`Shipped ${orderHash(order)}; canonical ${encoded}`);
  return orderHash(order);
}
async function keeperOnce() {
  const d = await deployment();
  const s = loadState();
  const status = (await getter(d, "status")) as {
    valuationAvailable: boolean;
    emergencyMode: boolean;
    tradingPaused: boolean;
    assetsUsdc: bigint;
  };
  if (!status.valuationAvailable || status.emergencyMode) {
    await transact(
      s.actors.keeper,
      address(d.vault),
      vaultAbi(),
      "setPause",
      [true, true],
      "pause unhealthy strategy",
    );
    throw new Error("KEEPER_STOPPED_UNHEALTHY");
  }
  const inventory = (await getter(d, "inventory")) as Array<{
    token: Address;
    walletBalance: bigint;
    adapterIdleBalance: bigint;
    lendingBalance: bigint;
  }>;
  const policy = (await getter(d, "policy")) as readonly (bigint | number)[];
  const prices = (await read(
    address(d.oracle),
    artifact("CashPlusOracle").abi,
    "prices",
  )) as readonly [bigint, bigint];
  const target0 = (status.assetsUsdc * B(policy[8] ?? 0) + B(9999)) / B(10000) + B(2);
  const secondaryValue = (status.assetsUsdc * B(policy[9] ?? 0) + B(9999)) / B(10000);
  const target1 = (secondaryValue * prices[0] + prices[1] - B(1)) / prices[1];
  for (let i = 0; i < 2; i += 1) {
    const item = inventory[i];
    if (!item) throw new Error("INVENTORY_COMPONENT_MISSING");
    const target = i === 0 ? target0 : target1;
    if (item.walletBalance > target + B(1))
      await transact(
        s.actors.keeper,
        address(d.vault),
        vaultAbi(),
        "park",
        [item.token, item.walletBalance - target],
        `park ${i === 0 ? "USDC" : "USD₮0"}`,
      );
    else if (item.walletBalance < target && item.lendingBalance >= target - item.walletBalance)
      await transact(
        s.actors.keeper,
        address(d.vault),
        vaultAbi(),
        "unpark",
        [item.token, target - item.walletBalance],
        `restore ${i === 0 ? "USDC" : "USD₮0"} hot buffer`,
      );
  }
  console.log(
    `Keeper checkpoint NAV ${status.assetsUsdc}; one serial signer, no pending duplicate.`,
  );
}
async function keeper() {
  await verify();
  let iterations = 0;
  const maximum = arg("iterations") ? Number(arg("iterations")) : Number.POSITIVE_INFINITY;
  while (iterations < maximum) {
    await keeperOnce();
    await ship();
    iterations += 1;
    if (flag("once") || iterations >= maximum) break;
    await sleep(10_000);
  }
}
async function counterparty() {
  const d = await deployment();
  const s = loadState();
  const hash = await ship();
  const saved = loadState().orders[hash];
  if (!saved) throw new Error("ORDER_BYTES_MISSING_RESHIP_NEW_ORDER");
  const order: Order = { maker: saved.maker, traits: B(saved.traits), data: saved.data };
  const block = await clients(s.rpcUrl).publicClient.getBlock();
  const reverse = flag("reverse");
  const input = address(reverse ? d.secondary.address : d.usdc.address);
  const output = address(reverse ? d.usdc.address : d.secondary.address);
  const scenario = arg("scenario", "normal");
  if (scenario !== "normal" && scenario !== "exceeds-limit")
    throw new Error("UNKNOWN_COUNTERPARTY_SCENARIO");
  const n = amount(arg("amount"), scenario === "exceeds-limit" ? "1000" : "10");
  const deadline = block.timestamp + B(60);
  if (scenario === "exceeds-limit") {
    try {
      await clients(s.rpcUrl).publicClient.simulateContract({
        account: s.actors.counterparty,
        address: address(d.router),
        abi: [...routerAbi, ...vaultAbi()],
        functionName: "swap",
        args: [order, input, output, n, takerTraits(B(1), deadline)],
      });
    } catch (error) {
      const reverted =
        error instanceof BaseError
          ? error.walk((e) => e instanceof ContractFunctionRevertedError)
          : undefined;
      if (
        !(reverted instanceof ContractFunctionRevertedError) ||
        reverted.data?.errorName !== "FillLimit"
      )
        throw error;
      const message = String(error);
      writeFileSync(resolve(local, "rejected-limit.txt"), message);
      console.log(`Expected over-limit simulation rejected: ${message.slice(0, 500)}`);
      return;
    }
    throw new Error("OVER_LIMIT_UNEXPECTEDLY_ACCEPTED");
  }
  await transact(
    s.actors.counterparty,
    input,
    erc20Abi,
    "approve",
    [address(d.router), n],
    "approve exact counterparty input",
  );
  const [quotedIn, out, quotedHash] = await clients(s.rpcUrl).publicClient.readContract({
    account: s.actors.counterparty,
    address: address(d.router),
    abi: routerAbi,
    functionName: "quote",
    args: [order, input, output, n, takerTraits(B(1), deadline)],
  });
  if (quotedIn !== n || quotedHash !== hash) throw new Error("QUOTE_CONTEXT_MISMATCH");
  await transact(
    s.actors.counterparty,
    address(d.router),
    [...routerAbi, ...vaultAbi()],
    "swap",
    [order, input, output, n, takerTraits((out * B(9995)) / B(10000), deadline)],
    "official Aqua conversion with Aave JIT",
  );
  console.log(`Conversion executed: ${n} -> quoted ${out}; receipt is the settlement authority.`);
  await report();
}
async function investorDeposit() {
  const d = await deployment();
  const s = loadState();
  const n = amount(arg("amount"), "1000");
  const block = await clients(s.rpcUrl).publicClient.getBlock();
  await transact(
    s.actors.investor,
    address(d.usdc.address),
    erc20Abi,
    "approve",
    [address(d.vault), n],
    "investor exact USDC approval",
  );
  const shares = (await getter(d, "previewDeposit", [n])) as bigint;
  const version = (await getter(d, "policyVersion")) as bigint;
  await transact(
    s.actors.investor,
    address(d.vault),
    vaultAbi(),
    "deposit",
    [n, (shares * B(9995)) / B(10000), block.timestamp + B(300), version],
    "investor deposit",
  );
  await report();
}
async function investorRedeem() {
  const d = await deployment();
  const s = loadState();
  const shares = (await getter(d, "sharesOf", [s.actors.investor])) as bigint;
  const preview = (await getter(d, "previewRedeem", [shares])) as bigint;
  const block = await clients(s.rpcUrl).publicClient.getBlock();
  const version = (await getter(d, "policyVersion")) as bigint;
  await transact(
    s.actors.investor,
    address(d.vault),
    vaultAbi(),
    "redeemAll",
    [(preview * B(9995)) / B(10000), block.timestamp + B(300), version],
    "investor cash redemption",
  );
  await report();
}
async function report() {
  const d = await deployment();
  const s = loadState();
  const [status, inventory, shares, cashflows, activeStrategies] = await Promise.all([
    getter(d, "status"),
    getter(d, "inventory"),
    getter(d, "sharesOf", [s.actors.investor]),
    getter(d, "accountCashflows", [s.actors.investor]),
    getter(d, "activeStrategies"),
  ]);
  const evidence = {
    ...s,
    status,
    inventory,
    investorShares: shares,
    investorCashflows: cashflows,
    activeStrategies,
    lockfileSha256: createHash("sha256")
      .update(readFileSync(resolve(root, "pnpm-lock.yaml")))
      .digest("hex"),
    contractsRoot,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(resolve(local, "evidence.json"), stringify(evidence));
  writeFileSync(resolve(local, `snapshot-${s.operations.length}.json`), stringify(evidence));
  console.log(
    stringify({
      runId: s.runId,
      vault: d.vault,
      investor: s.actors.investor,
      status,
      inventory,
      shares,
      cashflows,
      activeStrategies,
    }),
  );
}
async function capacity() {
  const d = await deployment();
  const s = loadState();
  const cap = amount(arg("cap"), "1500");
  const reason = keccak256(toHex("SIMULATED_CAPACITY_REPORT_CASHPLUS_DEMO_V1"));
  await transact(
    s.actors.keeper,
    address(d.vault),
    vaultAbi(),
    "lowerDepositCapWithReason",
    [cap, reason],
    "simulated capacity report lowers deposit cap",
  );
}
async function demo() {
  const step = arg("step", "status");
  if (step === "start") {
    if (!flag("skip-build")) buildContracts();
    const archive = archivePreviousRun();
    if (archive) console.log(`Previous run evidence preserved: ${archive}`);
    const fork = await startFreshFork(arg("port"), arg("upstream"));
    console.log(
      `Fresh fork ${fork.rpcUrl}, source ${fork.sourceBlock}, PID ${fork.pid}. Run the demo immediately; public historical state can expire.`,
    );
    return deploy({ rpcUrl: fork.rpcUrl, fresh: true, built: true });
  }
  if (step === "invest") return investorDeposit();
  if (step === "park") return keeperOnce();
  if (step === "convert") return counterparty();
  if (step === "withdraw") return investorRedeem();
  if (step === "capacity") return capacity();
  if (step === "status") return report();
  if (step === "rehearse") {
    await investorDeposit();
    await keeperOnce();
    await counterparty();
    await investorRedeem();
    return report();
  }
  throw new Error("UNKNOWN_DEMO_STEP");
}
async function main() {
  const command = process.argv[2];
  if (command === "export") {
    exportAbis();
    return;
  }
  if (command === "deploy-fork") return deploy();
  if (command === "verify") return verify();
  if (command === "ship") return ship();
  if (command === "keeper") return keeper();
  if (command === "counterparty") return counterparty();
  if (command === "demo") return demo();
  throw new Error("Commands: export, deploy-fork, verify, ship, keeper, counterparty, demo");
}
main().catch((error) => {
  if (historicalForkStateUnavailable(error)) {
    mkdirSync(local, { recursive: true });
    writeFileSync(resolve(local, "last-fork-error.log"), String(error));
    console.error(
      "HISTORICAL_FORK_STATE_UNAVAILABLE: The upstream RPC no longer serves required storage at this fork's pinned block. No transaction resend or fork reset was performed. Preserve evidence, reconcile pending transactions, then use `pnpm cash-plus:demo --step start` for a fresh run or an archival RPC. Details: scripts/cash-plus/.local/last-fork-error.log",
    );
  } else console.error(error);
  process.exitCode = 1;
});
