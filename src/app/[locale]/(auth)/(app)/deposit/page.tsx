import { setRequestLocale } from "next-intl/server";
import { type DepositInvestContext, DepositScreen } from "@/features/deposit/DepositScreen";
import { parseInvestParams } from "@/features/deposit/lib/investContext";
import { accountService, strategyService } from "@/lib/services";

/** PP-DEP-SCR-001…006 — the on-ramp wizard (fiat + crypto paths). */
export default async function DepositPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  // External-wallet sessions already hold their own crypto, so the in-app crypto-deposit
  // (receive-to-address) path is hidden for them. `?wallet=external` forces it for previewing.
  const walletKind = sp.wallet === "external" ? "external" : await accountService.getWalletKind();
  const cryptoDepositAvailable = walletKind !== "external";

  // Optional "Deposit & invest" top-up context: /deposit?strategy=<id>&amount=<shortfall>&invest=<chosen>.
  // Built from the URL params alone (POO-494 R1/R2): the lookup below only decorates the banner
  // name, so a real-mode catalog miss (closed pool, pagination, throttling) never drops the
  // received-fixed mode, the prefill, or the "Invest now" return deep link.
  const parsed = parseInvestParams(sp);
  let investContext: DepositInvestContext | null = null;
  if (parsed) {
    let strategyName: string | null = null;
    try {
      strategyName = (await strategyService.getById(parsed.strategyId))?.name ?? null;
    } catch {
      strategyName = null;
    }
    investContext = { ...parsed, strategyName };
  }

  // Wallet modal "Receive" deep-links here: /deposit?mode=receive opens the crypto-receive step.
  const startOnReceive = sp.mode === "receive";

  return (
    <DepositScreen
      investContext={investContext}
      cryptoDepositAvailable={cryptoDepositAvailable}
      initialCrypto={startOnReceive}
    />
  );
}
