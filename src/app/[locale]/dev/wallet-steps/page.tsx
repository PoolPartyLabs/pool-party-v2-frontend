import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { WalletStepsSandbox } from "./WalletStepsSandbox";

/**
 * Dev-only sandbox for the multistep wallet-signing modal (PP-CORE-MOD-006 / 009, POO-295).
 *
 * Exercises the generic {@link WalletSignModal} with switchable specs (variable step count) under
 * either the host-driven (controlled `activeStep`) or the mock-timer (uncontrolled) driver. The same
 * seam Rafael's real flows use to advance the stepper on wallet events. Lets us click through every
 * shape (1-step collect, 2-step deposit, 4-step add-liquidity, …) in the real app shell before any
 * backend exists. Returns 404 in production so it never ships to users.
 */
export default async function WalletStepsDevPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  return <WalletStepsSandbox />;
}
