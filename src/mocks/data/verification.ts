/**
 * @id PP-ADM-MCK-001
 * @name manager verification requests — mock fixture
 * @implements-rules-version v1
 *
 * PP-MOCK: seeded manager verification requests for the Admin Console (POO-587). The `pending` ones
 * populate the admin Operations > Managers queue. `apex-quant` also exists in the manager profiles
 * fixture (managerVerification: "none"), so approving it sets its badge to `valid`; the others are
 * synthetic new managers whose full profiles land with the real backend.
 *
 * PP-INTEGRATION-POINT: verification requests ← pool-party-api (`GET /admin/verifications`), never the
 * DB directly.
 */
import type { ManagerVerificationRequest } from "@/lib/schemas";

export const managerVerificationRequests: ManagerVerificationRequest[] = [
  {
    managerHandle: "apex-quant",
    managerName: "Apex Quant",
    status: "pending",
    submittedAt: "2026-07-03T14:20:00.000Z",
    aum: 128_400,
    strategyCount: 2,
  },
  {
    managerHandle: "sofia-delgado",
    managerName: "Sofia Delgado",
    status: "pending",
    submittedAt: "2026-07-04T09:12:00.000Z",
    aum: 54_200,
    strategyCount: 1,
  },
  {
    managerHandle: "lucas-meyer",
    managerName: "Lucas Meyer",
    status: "pending",
    submittedAt: "2026-07-04T18:45:00.000Z",
    aum: 81_900,
    strategyCount: 3,
  },
];
