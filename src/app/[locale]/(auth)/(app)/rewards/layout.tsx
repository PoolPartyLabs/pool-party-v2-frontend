import type { ReactNode } from "react";
import { requireFeature } from "@/lib/features/requireFeature";

/**
 * Gate for the whole Rewards area (`/rewards/*`). One server guard covers Rubber Rush, ManagerIncentiveProgram
 * and Referral: when the `rewards` flag is off, every rewards route 404s (kill-switch + deep-link
 * gating). Rewards is ON in v1, so this renders normally today.
 */
export default function RewardsLayout({ children }: { children: ReactNode }) {
  requireFeature("rewards");
  return children;
}
