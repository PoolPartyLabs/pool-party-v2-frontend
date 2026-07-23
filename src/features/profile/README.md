# Feature: Profile & Account

Investor profile hub and account settings (identity, security, social links, notifications, app
settings, help). Presentational screens fed a `ProfileUser` from the server, edited through a single
server action.

## i18n namespace

`profile.*` (files in `src/i18n/messages/[locale]/profile.json`). The Personal-info avatar crop
reuses the `manager.profileTab.crop.*` strings; the image-limit error uses `common.validation.*`.

## Data seam (POO-222) + real wiring (POO-233 / POO-426)

Identity is resolved through a server-only seam, mirroring `strategyCatalog` so `apiFetch`
(server-only) never reaches a client bundle. Pages import the resolver, NOT `profileService`:

- **Read** — `loadInvestorProfile()` (`src/lib/profile/loadInvestorProfile.ts`):
  `isMockMode ? profileService.get() : fetchInvestorProfile(sessionWallet)`.
  - Mock: `profileService.get()` → the session `ProfileUser` (structural clone).
  - Real: `fetchInvestorProfile` reads the OWNER `GET /api/v1/users/me` (POO-674, session Bearer
    forwarded from the httpOnly cookie via `getAuthHeader`) so `email`/`country`/`phone` survive a
    reload, falling back to the public `GET /api/v1/users/:address` (POO-232, fetch-or-create) when
    signed out or if the owner read is unavailable during rollout; wallet from the SIWE session. It
    composes referral/Quacks from the rewards read (`fetchRubberRush` — single source, POO-426), with a
    short per-wallet cache window + tag.
- **Write** — mock: `updateProfileAction` (`profileService.update`). Real: `useUpdateProfile()` signs
  the canonical signed-write message (POO-637 `signWrite`) with the connected wallet and forwards the
  envelope to `updateMyProfileAction` → `PATCH /api/v1/users/me`; the action busts the per-wallet
  cache tag and returns the fresh identity (the owner projection round-trips the saved email +
  country + phone, which the public read omits). The real-mode `PersonalInfoScreen` is wrapped by
  `PersonalInfoDataLoader` (a client boundary that injects the signed-write `onSave`) — the
  presentational screen is untouched.
- `resetMockProfileState()` (test-only) reseeds the mock from the fixture.

The `ProfileUser` type + `profileUserSchema` live in `src/lib/schemas`; the mock fixture
(`mockProfileUser`) lives in `src/mocks/data/profile.ts`. The only mock-fixture reader outside the
service layer is `GreetingHeading` (mock-mode display-name fallback). The `mockUser.ts` and
`profileStore.ts` files were removed in favour of the service.

### Real-mode field mapping (POO-674/POO-675/POO-693)

`displayName`←`displayName` (the PUBLIC display name; backend already masks the default) and
`name`←`name` (POO-693: the PRIVATE comms-only field, owner projection only — absent on the public read
and on older API responses → `""`, never fabricated). `displayName` feeds the avatar `initial`
(`deriveInitial` skips a leading `0x` so a wallet-style name yields its first real letter/digit).
`isManager` passes through, referral/Quacks come from the rewards read. The OWNER projection
(`GET`/`PATCH /users/me`) now carries the private `name` + `email` +
`country` + `phone` (POO-675/POO-693 columns), so all round-trip: they map from the owner read
(`null`→`""`), and on the public fallback (signed out) they resolve to `""` (the keys are simply
absent). Edits forward `email`/`country`/`phone` to the PATCH — a blank value is SENT as `""`
(clear-to-null), no longer dropped/omitted. `username` (input removed from the UI — no backend column)
and `emailVerified` (no verification backend) stay empty/false, never fabricated. The `/users/me`
owner read + the `country`/`phone` columns + the relaxed blank-email validation are the paired pp-api
change; the follow-up identity work is tracked in
[POO-652](https://linear.app/yeildbay/issue/POO-652).

## IDs

| ID | Type | Name | Status | Test coverage |
|----|------|------|--------|---------------|
| PP-PROF-SCR-001 | Screen | Profile hub (`ProfileHubScreen`) | Done | tested |
| PP-PROF-SCR-002 | Screen | Personal information (`PersonalInfoScreen`) | Done | tested |
| PP-PROF-CMP-006 | Component | `PhoneField` (optional phone + country-code selection, canonical E.164) | Done | tested |
| PP-PROF-SCR-003 | Screen | Linked social accounts (`SocialScreen` + real-mode `SocialDataLoader`) | Done | tested |
| PP-PROF-SCR-004 | Screen | Security & login (`SecurityScreen`) | Done | tested |
| PP-PROF-SCR-005 | Screen | Alerts & notifications (`NotificationsScreen`) | Done | tested |
| PP-PROF-SCR-006 | Screen | App settings (`AppSettingsScreen`) | Done | n/a |
| PP-PROF-SCR-007 | Screen | Help center (`HelpScreen`) | Done | n/a |
| PP-PROF-ACT-001 | Action | `updateProfileAction` (mock) + `updateMyProfileAction` (real signed `PATCH /users/me`) | Done | tested |
| PP-PROF-ACT-002 | Action | `disconnectLinkedAccountAction` (real signed `DELETE /users/me/linked-accounts`) | Done | tested |
| PP-PROF-HOOK-001 | Hook | `useUpdateProfile` (mock action vs real sign-then-forward) | Done | tested |
| PP-PROF-HOOK-002 | Hook | `useDisconnectLinkedAccount` (real sign-then-forward disconnect) | Done | tested |
| PP-PROF-LIB-002 | Lib | `mapInvestorProfile` (ACL: api + rewards → `ProfileUser`) | Done | tested |
| PP-PROF-LIB-003 | Lib | Profile API schema (`GET /users/:address` public + `GET`/`PATCH /users/me` owner: email + country/phone) | Done | tested |
| PP-PROF-LIB-004 | Lib | `fetchInvestorProfile` (real read + cache/tag) | Done | tested |
| PP-PROF-LIB-005 | Lib | `loadInvestorProfile` (mock/real resolver) | Done | tested |
| PP-PROF-LIB-006 | Lib | `buildProfileWriteBody` (editable subset → PATCH body) | Done | tested |
| PP-PROF-LIB-007 | Lib | Linked-accounts schema (`GET /users/:address/linked-accounts` projection) | Done | tested |
| PP-PROF-LIB-008 | Lib | `fetchLinkedAccounts` + `loadLinkedAccounts` (real read/cache + mock/real seam) | Done | tested |
| PP-CORE-LIB-035 | Lib | `toE164` / `isAcceptablePhone` (POO-699 phone helpers, `src/lib/utils/phone.ts`) | Done | tested |
| PP-CORE-LIB-036 | Lib | `describeError` (POO-702 flat PII-free error description for structured logs) | Done | tested |
| PP-CORE-LIB-037 | Lib | `mediaSaveLog` (POO-702 real-mode PATCH shape + outcome observability) | Done | tested |
| PP-AUTH-LIB-001 | Lib | `signWrite` (POO-637 FE signed-write helper) | Done | tested |
| PP-PROF-MCK-001 | Mock | `mockProfileUser` fixture (`src/mocks/data/profile.ts`) | Done | schema-validated |

## Integration points

- Read wired real — owner `GET /api/v1/users/me` (POO-674, session Bearer) with a fallback to public
  `GET /api/v1/users/:address` (POO-232) via `fetchInvestorProfile`; Quacks composed from the analytics
  rewards read (POO-426) and referral code/joined from the pp-api referral read
  (`GET /api/v1/referral/:wallet`, POO-661) — each degrades independently so identity always loads.
- Write wired real — signed `PATCH /api/v1/users/me` (POO-232) behind the POO-637 signed-write guard,
  via `useUpdateProfile` → `signWrite` → `updateMyProfileAction`; forwards `email`/`country`/`phone`
  (POO-675, blank = clear-to-null).
- Linked social accounts (POO-110 de-mock, contract POO-581) — read wired real via
  `loadLinkedAccounts` → `GET /api/v1/users/:address/linked-accounts` (OPEN, session wallet; mock mode
  and any read failure → no connections). Disconnect wired real via `useDisconnectLinkedAccount` →
  `signWrite('linked-account.disconnect', {provider})` → `disconnectLinkedAccountAction` → guarded
  `DELETE /api/v1/users/me/linked-accounts` (busts the `linked-accounts:<wallet>` tag). Real-mode
  screen wrapped by `SocialDataLoader`; `SocialScreen` stays presentational. **Connect is inert
  (disabled)** — `PUT /users/me/linked-accounts` needs a user-entered provider link / gmail the FE must
  normalize, an undecided input UX tracked separately; no connection is fabricated.
- Avatar upload wired real (POO-580 / POO-707) — crop-apply STAGES the cropped Blob locally (preview
  only); on Save the staged blob uploads to media storage via a **session-authorized** mint
  (`useUploadAvatar` → `useUploadMedia("avatar")` → `mintUploadUrlAction`, the SIWE `pp_access_token`
  Bearer — **no wallet signature**) and its trusted `publicUrl` is persisted by the SAME single signed
  `PATCH /users/me`, so a full edit costs one signature. The browser→S3 upload stays
  `PP-INTEGRATION-POINT` ([POO-580](https://linear.app/yeildbay/issue/POO-580) /
  [POO-233](https://linear.app/yeildbay/issue/POO-233)).
- Remaining identity-contract field gaps (email on the public read, username/country/phone/emailVerified) —
  [POO-652](https://linear.app/yeildbay/issue/POO-652).
- Logout (`ProfileHubScreen`), private-key export + delete-account gate (`SecurityScreen`) — see
  `docs/INTEGRATION_POINTS.md`.

## Personal-information validation (POO-699, rules v1)

`PERSONAL_INFO_LIMITS` (exported from `PersonalInfoScreen`) is kept in EXACT lockstep with the backend
`UpdateProfileDto` (POO-700): name 5-60, `displayName` 5-25, email 6-200. Every field is optional with
one uniform rule (mirroring how Email already behaved): **empty CLEARS the field; a non-empty value
must satisfy the bounds**. Below-min shows an inline error (wired through the shared `Input` `error=`
prop) and blocks Save; above-max is capped (`maxLength` on input + `sanitizeText` on save). Email keeps
its `@`/shape check AND adds the length bounds. Save is blocked whenever ANY field is
non-empty-and-invalid; an all-empty form still saves (clears every field).

- **Handle label rename (R5).** The public field's UI label is now `Handle (optional)` (i18n key
  `profile.personal.displayName` → "Handle" across all 11 locales). The code/state/API variable STAYS
  `displayName` end-to-end (`ProfilePatch.displayName`, `buildProfileWriteBody`, the profile schemas,
  `mapInvestorProfile`) — frontend copy only.
- **Phone (R4).** `PhoneField` uses `react-international-phone`'s headless `usePhoneInput` to drive the
  shared `Input` (label/error/aria preserved) plus a native country-code `<select>` (dial codes from the
  lib's data — `src/lib/data/countries.ts` has names only); `libphonenumber-js` validates and yields the
  canonical E.164 persisted into the existing `phone` field. No new integration point — persistence
  reuses the existing `ProfilePatch.phone` → `buildProfileWriteBody` seam.

## Save + upload failure observability (POO-702 Secondary #1, rules v1)

The observability half of POO-702 (the primary avatar/banner persist bug is tracked separately in the
same issue). A failing save or upload used to be swallowed — `PersonalInfoScreen.handleSave` was a
`try/finally` with no `catch`, so a rejected persist did nothing visible; the avatar-upload `catch` set
a UI flag but discarded the error object. Now:

- **Save** — a rejected `onSave` surfaces an explicit inline error (`profile.personal.saveFailed`, 11
  locales) and the caught error is structured-logged via `describeError` under the greppable
  `PP-PROFILE-SAVE` prefix (`{ surface: "investor", action: "save", ... }`). The success indicator is
  never shown on a failed save.
- **Upload** — the deferred avatar upload now runs on **Save** (POO-707): its `catch` keeps the staged
  crop preview + `avatarError` flag, skips the signed PATCH, AND logs the caught error under
  `PP-MEDIA-UPLOAD` (`{ surface: "investor", asset: "avatar", ... }`).
- **Server action** — real-mode `updateMyProfileAction` logs the PATCH body SHAPE (keys +
  `avatarUrl` classified absent/non-https/https, PII-free) and the API outcome under `PP-MEDIA-SAVE`
  (`mediaSaveLog`), then rethrows. This is the diagnostic that reveals, on the next real save, whether
  the uploaded https URL actually reaches the persisting PATCH — the exact question static reading could
  not answer.

## Notes

- Screens are presentational; the pages (`src/app/[locale]/(auth)/(app)/profile/**`) pass the
  `ProfileUser` in and the server action persists edits. Behavior is identical in mock and real mode.
