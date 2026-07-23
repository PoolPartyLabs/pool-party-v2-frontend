/**
 * @id PP-PROF-MCK-001
 * @name profile mock data
 * @implements-rules-version v1
 *
 * Static identity + referral fixture for the Profile area (PP-PROF-SCR-001/002), the Home/Console
 * greeting, and the profile service seam (POO-222). Relocated from the feature layer
 * (`src/features/profile/mockUser.ts`) to the central mock-data layer so it sits behind the service
 * factory like every other domain fixture; typed against `profileUserSchema` (validated in the
 * co-located test) so the UI has a stable, PII-shaped identity to build against.
 *
 * PP-INTEGRATION-POINT (POO-222 [R7] / POO-426): replace with the authenticated user's profile from
 * the backend identity endpoint (`GET /me` on `PP_API_URL`, wallet from the SIWE session). Real
 * persistence + avatar upload stay a PP-INTEGRATION-POINT (POO-232 / POO-233).
 */
import type { ProfileUser } from "@/lib/schemas";

/** PP-MOCK: the signed-in investor (Maria). */
export const mockProfileUser: ProfileUser = {
  // POO-693: `name` is the PRIVATE comms-only name; `displayName` is the PUBLIC one shown on the greeting
  // and the profile header. Maria shows her real name publicly, so the two match in this fixture.
  name: "Maria Silva",
  displayName: "Maria Silva",
  email: "maria@email.com",
  emailVerified: true,
  username: "maria_invests",
  initial: "M",
  // PP-MOCK: no uploaded avatar in the fixture — the UI renders the `initial` fallback (real avatar
  // upload lands via the POO-580 media mint in real mode only; mock persistence is session-local).
  avatar: "",
  country: "Brazil",
  phone: "+55 11 90000-0000",
  referralCode: "MARIA2026",
  referralJoined: 3,
  referralEarned: 30,
  // PP-MOCK: matches the Rubber Rush mock balance (PP-CORE-MCK-005) and the header Quacks pill.
  quacks: 15_021,
  isManager: false,
};
