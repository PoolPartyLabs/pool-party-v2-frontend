/**
 * @id PP-REW (POO-210)
 * @name useSayQuack
 * @implements-rules-version v1
 *
 * Client hook for the daily Say Quack check-in. In mock mode it calls the mock
 * rewardsService (no signing, no network). In real mode it signs the daily
 * message with the connected wallet (Privy personal_sign) and forwards the
 * signed payload to the sayQuackAction Server Action. Mirrors the useAuth
 * mock/real split so Privy hooks never run when PrivyProvider is absent.
 */
"use client";

import { useWallets } from "@privy-io/react-auth";
import { useAuth } from "@/lib/auth/useAuth";
import { buildDailyQuackMessage, todayUtc } from "@/lib/rewards/quackMessage";
import type { SayQuackOutcome } from "@/lib/rewards/writes";
import { isMockMode, rewardsService } from "@/lib/services";
import { sayQuackAction } from "../actions";

/** The Say Quack action surface. */
export interface SayQuackApi {
  /** Run the check-in and return the discriminated outcome. */
  sayQuack: () => Promise<SayQuackOutcome>;
}

function useMockSayQuack(): SayQuackApi {
  return {
    sayQuack: async () => {
      const { quacksAwarded } = await rewardsService.sayQuack();
      return { status: "awarded", quacksAwarded };
    },
  };
}

function useRealSayQuack(): SayQuackApi {
  const { address } = useAuth();
  const { wallets } = useWallets();
  return {
    sayQuack: async () => {
      if (!address) return { status: "error" };
      const wallet =
        wallets.find((w) => w.address?.toLowerCase() === address.toLowerCase()) ?? wallets[0];
      if (!wallet) return { status: "error" };

      const date = todayUtc();
      const message = buildDailyQuackMessage(address, date);
      let signature: string;
      try {
        // PP-INTEGRATION-POINT: wallet signature via Privy embedded/external wallet.
        const provider = await wallet.getEthereumProvider();
        signature = (await provider.request({
          method: "personal_sign",
          params: [message, address],
        })) as string;
      } catch {
        // User rejected the signature or the provider failed.
        return { status: "error" };
      }
      return sayQuackAction({ wallet: address, signature, date });
    },
  };
}

/** Daily Say Quack check-in (mock or real, decided at build time by isMockMode). */
export function useSayQuack(): SayQuackApi {
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant; the branch is stable across renders.
  return isMockMode ? useMockSayQuack() : useRealSayQuack();
}
