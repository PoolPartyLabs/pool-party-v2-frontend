/**
 * @id PP-PROF-SCR-002
 * @name Personal information
 * @implements-rules-version v1
 *
 * Editable identity fields, grouped into Personal (private name / public display name / country) and
 * Contact (email + verified badge / phone). POO-693 splits the single Name into the PRIVATE comms-only
 * `name` and the PUBLIC `displayName`. Name / display name / email / country / phone are optional and
 * controlled (POO-675: the username input was removed — no backend column; phone is now controlled +
 * persisted rather than a dead uncontrolled input).
 * POO-699 adds per-field input validation with a uniform "empty clears; else enforce the bounds" rule
 * (mirroring Email): Name 5-60, the public field (label renamed to "Handle") 5-25, Email 6-200 + @, and
 * Phone as an optional country-code number persisted as canonical E.164 (see {@link PhoneField}). The
 * public field's code/state/API variable STAYS `displayName` end-to-end; only its LABEL is "Handle".
 * Save is blocked whenever any field is non-empty-and-invalid; an all-empty form still saves (clears).
 * Mock mode persists them for the session via the mock profile service (POO-356 R4), real mode signs +
 * PATCHes /users/me via the injected onSave.
 * POO-707: ONE-signature deferred Save. Cropping STAGES the blob locally (preview only, no upload, no
 * signature, [R4]); Save is dirty-tracked ([R3], enabled only when a field changed or an image is staged
 * AND valid); on Save the staged blob uploads (session-auth, no signature) then the SINGLE existing
 * signed PATCH persists the URL + changed text ([R5]) — a full edit costs exactly one wallet signature.
 * An upload OR PATCH failure surfaces a visible error, keeps the staged preview, and never persists a
 * broken URL, with a timeout so a wedged wallet fails visibly ([R6]). Mock mode keeps the crop a
 * session-local preview. Wrapped in the shared SettingsLayout (desktop nav rail / mobile drill-down).
 */
"use client";

import { BadgeCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CountrySelect } from "@/components/ui/CountrySelect";
import { ImageCropModal } from "@/components/ui/ImageCropModal";
import { Input } from "@/components/ui/Input";
import { useUnsavedChanges } from "@/lib/hooks/unsavedChanges";
import { describeError } from "@/lib/observability/describeError";
import type { ProfileUser } from "@/lib/schemas";
import type { ProfilePatch } from "@/lib/services";
import { isValidEmail } from "@/lib/utils/email";
import { IMAGE_ACCEPT_ATTR, validateImageFile } from "@/lib/utils/imageUpload";
import { isAcceptablePhone, toE164 } from "@/lib/utils/phone";
import { sanitizeText } from "@/lib/utils/sanitize";
import { withTimeout } from "@/lib/utils/withTimeout";
import { updateProfileAction } from "./actions";
import { PhoneField } from "./components/PhoneField";
import { SettingsLayout } from "./components/SettingsLayout";
import type { AvatarUploadFn } from "./hooks/useUploadAvatar";

/**
 * POO-699 field limits, kept in EXACT lockstep with the backend UpdateProfileDto (POO-700): a private
 * name is 5-60, the public Handle 5-25, and an email 6-200. Every field is optional with the same
 * semantics as Email: empty CLEARS the field; a non-empty value must satisfy the bounds. Below-min
 * errors + blocks Save; above-max is capped (maxLength on input + sanitizeText on save).
 */
export const PERSONAL_INFO_LIMITS = {
  nameMin: 5,
  nameMax: 60,
  displayNameMin: 5,
  displayNameMax: 25,
  emailMin: 6,
  emailMax: 200,
} as const;

/**
 * POO-707 [R6]: hard ceiling on the chained upload→signed-PATCH Save so a wedged/hung wallet provider
 * (the POO-702 silent-hang) fails VISIBLY instead of spinning forever. 60s comfortably covers a real
 * wallet prompt + S3 upload; past it, we surface the save-failed error.
 */
const SAVE_TIMEOUT_MS = 60_000;

/** A titled form card. */
function FormCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </h2>
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
        {children}
      </div>
    </section>
  );
}

/** Public props for {@link PersonalInfoScreen}. */
export interface PersonalInfoScreenProps {
  /** The signed-in user. */
  user: ProfileUser;
  /**
   * Persists the Name/Email edits (POO-356 R4). Defaults to the mock session action; tests and
   * future real-mode wiring inject their own.
   */
  onSave?: (patch: ProfilePatch) => Promise<unknown>;
  /**
   * Real-mode only (POO-580): uploads a cropped avatar Blob and resolves its trusted CDN URL, which is
   * staged into the save patch. Omitted in mock mode / Storybook, where the crop is a session-local
   * preview only (no signing, no network — the real-mode `PersonalInfoDataLoader` injects this).
   */
  onUploadAvatar?: AvatarUploadFn;
}

/** Personal information editor. */
export function PersonalInfoScreen({
  user,
  onSave = updateProfileAction,
  onUploadAvatar,
}: PersonalInfoScreenProps) {
  const t = useTranslations("profile");
  // The crop dialog reuses the manager-profile crop strings (generic Zoom / Apply / Cancel) to avoid
  // duplicating those keys across all 11 locales.
  const tm = useTranslations("manager");
  // POO-586 R3: the shared image-limit error copy lives in the `common` namespace.
  const tCommon = useTranslations("common");
  // Name + Display name + Email are editable + optional (POO-356 / POO-693). POO-693: the PRIVATE
  // comms-only `name` and the PUBLIC `displayName` are two separate fields. Email: empty is fine, but a
  // non-empty value that isn't email-shaped shows an inline error so an obvious typo is caught before save.
  const [name, setName] = useState(user.name);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email);
  // Country is a single-select autocomplete (POO-410); persisted with the rest on save.
  const [country, setCountry] = useState(user.country);
  // Phone is optional with country-code selection (POO-699 [R4]); the PhoneField lifts the value to
  // persist ("" when cleared, else canonical E.164) plus whether it is acceptable. Seed both from the
  // stored value so an untouched form still persists the canonical E.164 and gates on real validity.
  const [phone, setPhone] = useState(() => toE164(user.phone));
  const [phoneValid, setPhoneValid] = useState(() => isAcceptablePhone(user.phone));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // POO-702 Secondary #1: a rejected persist must be VISIBLE, not swallowed. Set when the save fails so
  // the user sees an explicit error (and the caught error is structured-logged, never discarded).
  const [saveFailed, setSaveFailed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The rendered avatar: seeds from the persisted `user.avatar` (POO-580) so an uploaded avatar shows
  // after reload, then reflects the cropped preview / freshly-uploaded CDN URL for this session.
  const [avatar, setAvatar] = useState<string | null>(user.avatar || null);
  // POO-707 [R4]: crop-apply STAGES the cropped image locally as its `data:` URL (no upload, no
  // signature) — the upload is deferred to Save, where the blob is materialized and sent. Non-null
  // means "a new image is staged", which both drives the Save upload and marks the form dirty ([R3]).
  // Real-mode only (mock keeps the crop as a session-local preview with nothing staged).
  const [stagedAvatarDataUrl, setStagedAvatarDataUrl] = useState<string | null>(null);
  // Set when the deferred avatar upload fails on Save (e.g. 503 MEDIA_NOT_CONFIGURED); the local crop
  // preview is kept and the signed PATCH never runs, so a broken URL is never persisted ([R6]).
  const [avatarError, setAvatarError] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  // POO-586 R3: set when a picked photo is rejected (wrong type or too large); cleared on a valid pick.
  const [uploadError, setUploadError] = useState(false);
  // POO-699 [R1-R3/R6]: per-field validation with a uniform "empty allowed; else enforce bounds" rule.
  // Names sanitize (strip control/bidi, collapse whitespace) then cap at their max — the sanitized
  // length is what "empty" and the min check see, so a spaces-only value is treated as a clear (R6).
  const cleanName = sanitizeText(name, { maxLength: PERSONAL_INFO_LIMITS.nameMax });
  const nameError =
    cleanName.length > 0 && cleanName.length < PERSONAL_INFO_LIMITS.nameMin
      ? t("personal.nameInvalid", { min: PERSONAL_INFO_LIMITS.nameMin })
      : undefined;
  const cleanDisplayName = sanitizeText(displayName, {
    maxLength: PERSONAL_INFO_LIMITS.displayNameMax,
  });
  const displayNameError =
    cleanDisplayName.length > 0 && cleanDisplayName.length < PERSONAL_INFO_LIMITS.displayNameMin
      ? t("personal.displayNameInvalid", { min: PERSONAL_INFO_LIMITS.displayNameMin })
      : undefined;
  // [R3]: keep the existing @/shape check AND add the 6-200 length bounds.
  const trimmedEmail = email.trim();
  const emailError =
    trimmedEmail !== "" &&
    (!isValidEmail(email) ||
      trimmedEmail.length < PERSONAL_INFO_LIMITS.emailMin ||
      trimmedEmail.length > PERSONAL_INFO_LIMITS.emailMax)
      ? t("personal.emailInvalid")
      : undefined;
  // [R4]: a non-empty phone that is not a valid country-code number blocks Save (empty stays neutral).
  const phoneError = phone.trim() !== "" && !phoneValid ? t("personal.phoneInvalid") : undefined;
  // [R6]: Save is blocked whenever ANY field is non-empty-and-invalid; an all-empty form still saves.
  const hasBlockingError =
    nameError != null || displayNameError != null || emailError != null || phoneError != null;
  // POO-707 [R3]: Save is dirty-tracked. It is enabled only when something actually changed vs the
  // loaded profile — a text field differs from its seed OR a new image is staged — AND the form is
  // valid. An all-unchanged form keeps Save disabled (no no-op save). Each comparison uses the same
  // transform the seed used (phone → canonical E.164), so an untouched field never reads as dirty.
  const isDirty =
    name !== user.name ||
    displayName !== user.displayName ||
    email !== user.email ||
    country !== user.country ||
    phone !== toE164(user.phone) ||
    stagedAvatarDataUrl !== null;

  // POO-751: warn before leaving this screen with unsaved edits — the in-app confirm modal (nav
  // links / back-link) + the browser's native prompt on close/refresh (`beforeunload`).
  useUnsavedChanges(isDirty);

  // POO-707 [R5]: the ONE-signature deferred Save. First upload the staged avatar blob (session-auth,
  // NO wallet signature) to get its trusted CDN URL, THEN run the SINGLE existing signed PATCH with the
  // URL + only the changed text — so a full edit (image + text) costs exactly one wallet signature.
  // Persist Name (private) + Handle (public `displayName`) + Email + Country + Phone (POO-356 R4 /
  // POO-675 / POO-693 / POO-699). Names persist sanitized + capped; the phone is already "" or canonical
  // E.164. Both steps are timeout-bounded ([R6]) so a wedged wallet/upload fails visibly.
  async function handleSave() {
    if (hasBlockingError || !isDirty || saving) return;
    setSaving(true);
    setSaved(false);
    setSaveFailed(false);
    setAvatarError(false);
    try {
      // Step 1 — upload the staged image (deferred from crop): materialize the blob from its staged
      // `data:` URL, then upload. On failure keep the staged preview and surface it, and DO NOT run the
      // PATCH: never persist a broken URL or a partial (text-only) save.
      let uploadedAvatarUrl: string | undefined;
      if (stagedAvatarDataUrl && onUploadAvatar) {
        try {
          const blob = await (await fetch(stagedAvatarDataUrl)).blob();
          uploadedAvatarUrl = await withTimeout(onUploadAvatar(blob), SAVE_TIMEOUT_MS);
        } catch (error) {
          setAvatarError(true);
          console.error("PP-MEDIA-UPLOAD failed", {
            surface: "investor",
            asset: "avatar",
            ...describeError(error),
          });
          return;
        }
      }
      // Step 2 — the single signed PATCH (the only wallet signature in the whole save).
      try {
        await withTimeout(
          onSave({
            name: cleanName,
            displayName: cleanDisplayName,
            email: trimmedEmail,
            country: country.trim(),
            phone,
            ...(uploadedAvatarUrl ? { avatarUrl: uploadedAvatarUrl } : {}),
          }),
          SAVE_TIMEOUT_MS,
        );
      } catch (error) {
        // POO-702 Secondary #1: surface an explicit save-failed error AND structured-log the caught
        // error (never swallow it) — incl. a TimeoutError from a wedged wallet ([R6]). Real-mode
        // server-action rejections are redacted to a generic Error + `digest` that ties this line to
        // the PP-MEDIA-SAVE server log carrying the actual status/failure-class.
        setSaveFailed(true);
        console.error("PP-PROFILE-SAVE failed", {
          surface: "investor",
          action: "save",
          ...describeError(error),
        });
        return;
      }
      // Persisted: swap the preview for the trusted CDN URL and clear the staged image (no re-upload).
      if (uploadedAvatarUrl) {
        setAvatar(uploadedAvatarUrl);
        setStagedAvatarDataUrl(null);
      }
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  // POO-707 [R4]: apply the cropped photo as a LOCAL preview and STAGE its blob for the deferred Save
  // upload — no upload, no signature here. Mock mode (no upload fn) keeps the crop a session-local
  // preview only, with nothing staged (the mock save never persists an avatar, R7).
  function handleCropApply(dataUrl: string) {
    setAvatar(dataUrl);
    setCropSrc(null);
    setAvatarError(false);
    setSaved(false);
    if (!onUploadAvatar) return; // Mock mode: session-local preview only, nothing staged.
    setStagedAvatarDataUrl(dataUrl);
  }

  return (
    <SettingsLayout title={t("personal.title")}>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label={t("personal.changePhoto")}
          className="size-16 shrink-0 overflow-hidden rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {avatar ? (
            <img src={avatar} alt="" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center bg-primary/15 font-semibold text-2xl text-primary">
              {user.initial}
            </span>
          )}
        </button>
        <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
          {t("personal.changePhoto")}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept={IMAGE_ACCEPT_ATTR}
          className="sr-only"
          aria-label={t("personal.changePhoto")}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // POO-586 R1/R2: reject a wrong-type or >10 MB file before the crop opens; surface the
            // error and never build an object URL for it.
            if (file && !validateImageFile(file).ok) {
              setUploadError(true);
            } else if (
              file &&
              typeof URL !== "undefined" &&
              typeof URL.createObjectURL === "function"
            ) {
              setUploadError(false);
              setCropSrc(URL.createObjectURL(file));
            }
            // Reset so re-picking the same file fires onChange again.
            event.target.value = "";
          }}
        />
      </div>
      {/* POO-586 R3: the image-limit error, below the photo controls (cleared on the next valid pick). */}
      {uploadError ? (
        <p className="text-destructive text-xs">{tCommon("validation.imageTooLargeOrType")}</p>
      ) : null}
      {/* POO-580: the avatar upload failed (e.g. media hosting not configured); the local crop preview
          is kept so the user does not lose their edit. Cleared when a new crop is applied. */}
      {avatarError ? (
        <p className="text-destructive text-xs">{t("personal.avatarUploadFailed")}</p>
      ) : null}

      <FormCard label={t("personal.sectionPersonal")}>
        {/* POO-693: the PRIVATE comms-only name — never shown publicly, bound to `user.name`. POO-699
            [R1]: optional; 5-60 when non-empty (maxLength caps typing, sanitizeText caps the save). */}
        <Input
          label={`${t("personal.fullName")} ${t("personal.optional")}`}
          value={name}
          maxLength={PERSONAL_INFO_LIMITS.nameMax}
          onChange={(event) => {
            setName(event.target.value);
            setSaved(false);
          }}
          description={t("personal.nameHelper")}
          error={nameError}
        />
        {/* POO-693: the PUBLIC display name — shown on the profile / greeting, bound to `user.displayName`
            (the code/state/API variable stays `displayName`; only the LABEL is "Handle", POO-699 [R5]).
            [R2]: optional; 5-25 when non-empty. */}
        <Input
          label={`${t("personal.displayName")} ${t("personal.optional")}`}
          value={displayName}
          maxLength={PERSONAL_INFO_LIMITS.displayNameMax}
          onChange={(event) => {
            setDisplayName(event.target.value);
            setSaved(false);
          }}
          description={t("personal.displayNameHelper")}
          error={displayNameError}
        />
        <CountrySelect
          label={t("personal.country")}
          value={country}
          onChange={(next) => {
            setCountry(next);
            setSaved(false);
          }}
          placeholder={t("personal.countrySearch")}
          noResultsLabel={t("personal.countryNoResults")}
        />
      </FormCard>

      <FormCard label={t("personal.sectionContact")}>
        {/* [R3]: optional; when non-empty must be email-shaped (contain @) AND 6-200 chars. */}
        <Input
          label={`${t("personal.email")} ${t("personal.optional")}`}
          type="email"
          value={email}
          maxLength={PERSONAL_INFO_LIMITS.emailMax}
          onChange={(event) => {
            setEmail(event.target.value);
            setSaved(false);
          }}
          error={emailError}
          description={t("personal.emailHelper")}
        />
        {/* [R4]: optional phone with country-code selection; PhoneField lifts "" (cleared) or canonical
            E.164, plus whether it is acceptable to save. */}
        <PhoneField
          label={`${t("personal.phone")} ${t("personal.optional")}`}
          countryLabel={t("personal.phoneCountry")}
          initialValue={user.phone}
          error={phoneError}
          onChange={(next, isValid) => {
            setPhone(next);
            setPhoneValid(isValid);
            setSaved(false);
          }}
        />
        {user.emailVerified ? (
          <p className="flex items-center gap-1 text-success text-xs">
            <BadgeCheck className="size-3.5" aria-hidden="true" />
            {t("personal.verified")}
          </p>
        ) : null}
      </FormCard>

      {/* Mock mode: persists Name + Email for the session via the mock service (POO-356 R4). Real mode:
          the injected `onSave` signs + PATCHes /users/me, forwarding a staged avatar URL (POO-580). */}
      <div className="flex items-center justify-end gap-3">
        {/* POO-707 [R6]: a visible uploading/saving state through the chained upload → signed PATCH. */}
        {saving ? <p className="text-muted-foreground text-sm">{t("personal.saving")}</p> : null}
        {saved ? <p className="text-success text-sm">{t("saved")}</p> : null}
        {/* POO-702 Secondary #1: a failed save now shows an explicit error instead of silently doing
            nothing under an unchanged form (the old try/finally swallowed the rejection). */}
        {saveFailed ? <p className="text-destructive text-sm">{t("personal.saveFailed")}</p> : null}
        <Button variant="ghost">{t("cancel")}</Button>
        {/* POO-707 [R3]: dirty-tracked — Save is disabled unless something changed (a text field or a
            staged image) AND the form is valid, so an all-unchanged form can't trigger a no-op save. */}
        <Button onClick={handleSave} disabled={saving || hasBlockingError || !isDirty}>
          {t("save")}
        </Button>
      </div>

      {/* Crop the picked photo (round, with zoom-out) before it's applied — same behavior as the
          manager profile + the strategy-builder logo. */}
      <ImageCropModal
        open={cropSrc !== null}
        onOpenChange={(open) => {
          if (!open) setCropSrc(null);
        }}
        src={cropSrc ?? ""}
        aspect={1}
        round
        minZoom={0.5}
        title={tm("profileTab.crop.titleAvatar")}
        description={tm("profileTab.crop.help")}
        zoomLabel={tm("profileTab.crop.zoom")}
        applyLabel={tm("profileTab.crop.apply")}
        cancelLabel={tm("profileTab.crop.cancel")}
        outputWidth={512}
        onApply={handleCropApply}
      />
    </SettingsLayout>
  );
}
