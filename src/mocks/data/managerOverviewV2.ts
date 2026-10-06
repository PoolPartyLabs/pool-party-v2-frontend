/** @id PP-MGR-SCR-001 @name ManagerOverviewV2 fixtures @implements-rules-version v1 (POO-2245)
 * PP-MOCK: explicit design scenario, never a fallback for production reads.
 */

import type { FundLaunchDraft, LaunchJourney } from "@/features/manager/fund/launch/contracts";
import { createEmptyDraft } from "@/features/manager/fund/mandateDraft";
import type { OverviewDemo } from "@/features/manager/fund/overview/ManagerOverviewV2";
import { mockFund } from "./v2Funds";

const manager = mockFund.manager;
const draft = {
  ...createEmptyDraft("2026-10-06T12:00:00Z", "overview-draft"),
  name: "New strategy",
};
const launchDraft: FundLaunchDraft = {
  ...createEmptyDraft("2026-10-06T11:00:00Z", "overview-launch"),
  review: {
    name: "Global Markets",
    description: "",
    imageUrl: "",
    performanceFeeBps: 2000,
    managementFeeBps: 0,
    payoutFeeBps: 200,
    minimum: "100",
    seed: "100",
  },
  plan: {
    version: 1,
    hub: {
      chains: [
        {
          id: "hub",
          sharePct: 100,
          steps: [
            {
              id: "aave",
              kind: "aaveSupply",
              family: "position",
              config: { assetKey: `arbitrum:${mockFund.mandate.usdc}` },
            },
          ],
        },
      ],
    },
    spokes: [],
  },
};
const journey: LaunchJourney = {
  version: 1,
  manager,
  journeyId: `${manager.toLowerCase()}:${launchDraft.id}`,
  draftId: launchDraft.id,
  createdAt: "2026-10-06T11:00:00Z",
  draft: launchDraft,
};
const second = {
  ...mockFund,
  coreVault: `0x${"23".repeat(20)}`,
  profile: { ...mockFund.profile, protocolVersion: "v2" as const, name: "Stable Reserve" },
};
const values = [
  85000, 89500, 88800, 97600, 100000, 103000, 98000, 100500, 104500, 106000, 105000, 108000, 110000,
  107500, 111000, 109500, 113000, 116000, 120000, 117000, 122000, 124000, 119000, 125000, 123000,
  129000, 128000, 124000, 126000, 125000,
];
export const managerOverviewDemo: OverviewDemo = {
  state: "ready",
  manager,
  funds: [
    {
      ...mockFund,
      profile: { ...mockFund.profile, protocolVersion: "v2", name: "Balanced Income" },
    },
    second,
  ],
  setup: {
    drafts: [draft],
    journeys: [journey],
    draftStatus: "available",
    journeyStatus: "available",
  },
  aum: "$125,000.00",
  readyCount: 2,
  networks: 2,
  rowAum: { [mockFund.coreVault]: "$84,250.00", [second.coreVault]: "$40,750.00" },
  series: values.map((value, index) => ({
    value,
    label: new Date(Date.UTC(2026, 8, 6 + index)).toISOString().slice(0, 10),
    display: `$${value.toLocaleString("en-US")}.00`,
  })),
};
