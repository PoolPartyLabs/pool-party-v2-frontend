/**
 * @id PP-MGR-SCR-006
 * @name ManagerProfileTabView
 * @implements-rules-version v10
 *
 * POO-851 v1: TikTok and LinkedIn join Instagram as DISABLED "coming soon" placeholders. The
 *   hand-rolled Instagram block is generalized into a mapped {@link COMING_SOON_SOCIALS} list (all
 *   three render from it, so they stay identical); none is wired to `socials`/persistence (no backend
 *   column yet), so none can enter the saved payload. Brand glyphs are inline SVG marks in
 *   socialNetworks.tsx (lucide has no brand glyphs, POO-593 trap). Remove a placeholder when its
 *   backend column ships (Instagram POO-747).
 * POO-745 v1: the "Request verification" control moves to the code-DM model (POO-744), replacing the
 *   admin-queue mock (POO-593). Status is read from the profile's `managerVerification`
 *   (`none|pending|valid`) instead of `verificationService.getRequest`; requesting calls the real signed
 *   {@link useRequestManagerVerification} ([R3]) which persists edits first then POSTs, and surfaces the
 *   returned one-time code in {@link VerificationCodeModal} ([R4]). While `pending` the button reads
 *   "Pending validation" ([R5]) and re-opens the SAME code via an idempotent re-request ([R6], the code
 *   is never on a public read). `valid` shows the verified badge IN PLACE of the button; the X-only gate
 *   ({@link hasVerificationIdentitySocial}) is unchanged ([R2]). `pending -> valid` is out of scope ([R7]).
 *
 * POO-707 v1: ONE-signature deferred Save. Cropping now STAGES the avatar/banner blob locally (preview
 *   only, no upload, no signature — the POO-694 on-crop upload is gone, [R4]); Save is dirty-tracked
 *   ([R3], enabled only when something changed AND the form is valid); on Save the staged blobs upload
 *   (session-auth, no signature) then the SINGLE existing signed PATCH persists the URL(s) + changed
 *   text ([R5]) — a full edit (both images + text) costs exactly one wallet signature. An upload OR
 *   PATCH failure surfaces a visible error, keeps the staged preview, never persists a broken URL, and
 *   times out so a wedged wallet fails visibly ([R6]). The verification-request path uploads staged
 *   media before its single write too. Mock mode keeps the crop a session-local preview (R7).
 * POO-694 v1: real-mode avatar/banner PERSISTENCE. A crop was a session-local `data:` URL that the
 *   registry write dropped (non-https), so photos/banners vanished on refresh while Save still showed
 *   "Profile saved". The manager-console data loader now injects `onUploadAvatar`/`onUploadBanner`
 *   (mirroring PersonalInfoDataLoader); on crop-apply the bytes upload to media storage (POO-580 mint +
 *   S3) and the returned https `publicUrl` REPLACES the `data:` value so `buildManagerProfileBody`
 *   forwards it. Save is blocked while an upload is in flight; a failed upload keeps the local preview
 *   and surfaces an inline error instead of silently persisting nothing. Mock mode injects no upload fn
 *   (the crop stays a session-local preview, R7).
 * POO-695 v1: prefixed-social input honesty. A full URL pasted into a prefixed handle input (X,
 *   Telegram, Discord, YouTube) was stored verbatim — a matching-domain paste rendered as an injected
 *   link and a FOREIGN-domain paste was silently DROPPED on save (clearing a previously-valid link =
 *   data loss). onChange now normalizes a pasted URL for its network: a matching-domain URL is stored
 *   normalized (the input shows just the handle, prefix honest); a foreign/unsafe URL is kept verbatim
 *   so it flags inline (never fabricated into a bogus handle) AND blocks Save. Website keeps its
 *   flag-and-drop-on-save behavior (its error was already visible).
 *
 * POO-659 v1: the console keys the manager's reads/writes off the stable id (the address when present,
 *   else the handle), threaded to updateProfile / requestVerification / isHandleAvailable as
 *   `managerId = profile.address ?? profile.handle`, so an unfilled, address-based manager (empty
 *   handle) still plumbs correctly. The handle is a mutable, possibly-empty display field.
 * POO-657 v1: the handle-based social networks (X, Instagram, Telegram, YouTube, Discord) render a
 *   FIXED, non-editable domain prefix (`x.com/`, …) + a handle-only input and show NO validation error
 *   (a handle always resolves; the stored value is the built URL). Website stays a full-URL input with
 *   its inline error (POO-648). The prefixed input shows only the handle (prefix stripped for display).
 * POO-572 v1: per-network social link validation + bare @handle normalization.
 * POO-575 v1: handle editable until first save, then locked.
 * POO-648 v1: the invalid-link error is per-network ("Enter a valid {network} link, e.g. {example}",
 *   built from each network's label + placeholder) instead of the misleading generic "starting with
 *   https://" (which fired even for a valid-https wrong-domain URL). The description textarea uses the
 *   `scrollbar-dark` utility so its scrollbar is not white on the dark theme.
 *
 * The console "Profile" tab (POO-227 R1): the manager edits their public page — banner (YouTube
 * channel-art pattern, R2), photo, display name, bio and social links. The handle is editable until
 * the manager saves a valid one for the first time, then it locks (read-only) — POO-575: while
 * unlocked it is a live slug (R2), seeded from the display name (R3), validated for shape + backend
 * uniqueness (R4/R5), and it locks on the first save (R6). Uploads go through {@link ImageCropModal}
 * (R3, POO-227) and stay as data URLs in mock session state via `managerService.updateProfile`. Save
 * is the single CTA. The photo circle and the banner area are themselves picker click targets
 * (a `label` bound to the hidden file input via `htmlFor`), alongside the visible buttons.
 * Figma: `5840:235`.
 *
 * POO-593 (SUPERSEDED by POO-745): a "Request verification" control sits to the right of the photo.
 * The lifecycle + data source were reworked to the code-DM model (see the POO-745 note above): status
 * now comes from `profile.managerVerification`, not the admin-queue `verificationService`, and the
 * request returns a one-time code shown in a modal. The X-only gate ({@link hasVerificationIdentitySocial})
 * carried over unchanged.
 *
 * POO-816 v1 (interim; PP-TODO(POO-748) removal marker): Instagram renders as a DISABLED "coming
 * soon" field only, NOT wired to `socials`/persistence (the manager registry has no instagram column
 * yet, POO-747; a wired value would be silently stripped on save). Delete the placeholder and add
 * Instagram to SOCIAL_NETWORKS once POO-747 ships.
 */
"use client";

import { BadgeCheck, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CtaWithMissing } from "@/components/ui/CtaWithMissing";
import { ImageCropModal } from "@/components/ui/ImageCropModal";
import { Link } from "@/i18n/navigation";
import { useUnsavedChanges } from "@/lib/hooks/unsavedChanges";
import type { MediaUploadFn } from "@/lib/media/useUploadMedia";
import { describeError } from "@/lib/observability/describeError";
import type { ManagerProfile, ManagerSocials } from "@/lib/schemas";
import { managerProfileUrl } from "@/lib/urls";
import { cn } from "@/lib/utils/cn";
import { IMAGE_ACCEPT_ATTR, validateImageFile } from "@/lib/utils/imageUpload";
import { hasUrlScheme, sanitizeText } from "@/lib/utils/sanitize";
import { toHandleSlug } from "@/lib/utils/slug";
import { withTimeout } from "@/lib/utils/withTimeout";
import { useManagerProfileWrite } from "../hooks/useManagerProfileWrite";
import { useRequestManagerVerification } from "../hooks/useRequestManagerVerification";
import { hasVerificationIdentitySocial } from "../lib/verificationEligibility";
import {
  COMING_SOON_SOCIALS,
  normalizeSocialUrl,
  SOCIAL_NETWORKS,
  socialHandlePlaceholder,
  socialHandleValue,
  socialInputPrefix,
} from "./socialNetworks";
import { VerificationCodeModal } from "./VerificationCodeModal";

/**
 * POO-552 field limits. Max values are chosen (Murilo delegated "determine um max"): a display name is
 * a headline label, a bio is a short paragraph capped at 2,000, and the handle slug is URL-safe.
 */
export const PROFILE_LIMITS = {
  nameMin: 3,
  nameMax: 50,
  handleMin: 3,
  handleMax: 30,
  bioMax: 2000,
  urlMax: 200,
} as const;

/**
 * POO-707 [R6]: hard ceiling on the chained upload(s)→signed-PATCH Save so a wedged/hung wallet provider
 * (the POO-702 silent-hang) fails VISIBLY instead of spinning forever. 60s comfortably covers a real
 * wallet prompt + the S3 uploads; past it, we surface the save-failed error.
 */
const SAVE_TIMEOUT_MS = 60_000;

/**
 * POO-707 [R6]: a staged avatar/banner upload that failed on Save, tagged with which asset so the caller
 * surfaces the inline error and structured-logs the right `asset` — while aborting BEFORE the signed
 * PATCH, so a broken URL is never persisted.
 */
class StagedUploadError extends Error {
  constructor(
    readonly asset: "avatar" | "banner",
    readonly cause: unknown,
  ) {
    super(`staged ${asset} upload failed`);
    this.name = "StagedUploadError";
  }
}

/** Public props for {@link ManagerProfileTabView}. */
export interface ManagerProfileTabViewProps {
  /** The manager's current public profile. */
  profile: ManagerProfile;
  /** Called with the updated profile after a successful save. */
  onSaved?: (profile: ManagerProfile) => void;
  /**
   * Real-mode only (POO-694): uploads a cropped avatar Blob and resolves its trusted CDN URL, which
   * replaces the local `data:` preview so the registry write persists it. Omitted in mock mode /
   * Storybook, where the crop is a session-local preview (no signing, no network — the real-mode
   * `ManagerConsoleDataLoader` injects this via `useUploadMedia("avatar")`).
   */
  onUploadAvatar?: MediaUploadFn;
  /** Real-mode only (POO-694): the banner counterpart of {@link onUploadAvatar} (`useUploadMedia("banner")`). */
  onUploadBanner?: MediaUploadFn;
}

/** Which upload is being cropped. */
type CropTarget = { kind: "avatar" | "banner"; src: string } | null;

/** The console Profile tab: edit the public manager page. */
export function ManagerProfileTabView({
  profile,
  onSaved,
  onUploadAvatar,
  onUploadBanner,
}: ManagerProfileTabViewProps) {
  const t = useTranslations("manager");
  // POO-586 R3: the image-limit error copy is shared across every crop surface, so it lives in the
  // `common` namespace (read here alongside the manager namespace).
  const tCommon = useTranslations("common");
  // POO-579: the profile WRITE + handle-availability CHECK. Mock mode persists to the session service
  // (unchanged); real mode signs `manager.update` with the connected wallet and PATCHes the registry,
  // so edits persist per-wallet across pp_api restarts instead of living in the shared in-memory mock.
  const { updateProfile, checkHandle } = useManagerProfileWrite();
  // POO-745: the signed request-verification runner (mock or real). Both the first request and the
  // pending re-show call it (idempotent), so [R6] re-show is just a second invocation.
  const requestVerification = useRequestManagerVerification();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(profile.name);
  // POO-575: the handle is editable until the profile locks. Seed from the current handle (already a
  // slug). `handleTouched` records a MANUAL edit so the display-name suggestion stops overwriting it
  // (R3). `handleLocked` is the established state (R1).
  const handleLocked = profile.handleLocked === true;
  // POO-659: the manager's STABLE id for service reads/writes — the wallet address when present (the
  // unfilled dev manager has no handle yet), else the handle. Threaded to updateProfile / getRequest /
  // requestVerification / isHandleAvailable so the write + verification plumbing keys off the address,
  // never the (mutable, possibly-empty) handle.
  const managerId = profile.address ?? profile.handle;
  const [handle, setHandle] = useState(() => toHandleSlug(profile.handle));
  // A profile that already carries a handle is treated as pre-set (do not auto-suggest over it); an
  // empty handle starts untouched so the display-name suggestion drives it (R3).
  const [handleTouched, setHandleTouched] = useState(() => toHandleSlug(profile.handle).length > 0);
  // R5: async uniqueness result for the currently-typed handle (null = not yet checked / unchanged).
  const [handleTaken, setHandleTaken] = useState(false);
  const [bio, setBio] = useState(profile.bio);
  const [socials, setSocials] = useState<ManagerSocials>({ ...profile.socials });
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl);
  const [bannerUrl, setBannerUrl] = useState(profile.bannerUrl);
  const [crop, setCrop] = useState<CropTarget>(null);
  // POO-586 R3: set when a pick is rejected (wrong type or too large); cleared on the next valid pick.
  const [uploadError, setUploadError] = useState(false);
  // POO-707 [R4]: crop-apply STAGES the cropped image locally as its `data:` URL (no upload, no
  // signature) — the upload is deferred to Save, where the blob is materialized and sent. Non-null
  // means "a new image is staged" (real mode only; mock keeps just the data:-URL preview). The upload
  // runs at Save, so a full edit costs a single wallet signature ([R5]).
  const [stagedAvatarDataUrl, setStagedAvatarDataUrl] = useState<string | null>(null);
  const [stagedBannerDataUrl, setStagedBannerDataUrl] = useState<string | null>(null);
  // POO-694/POO-707: set when a staged avatar/banner upload fails on Save (e.g. 503 MEDIA_NOT_CONFIGURED,
  // an S3 error); the local crop preview is kept, the signed PATCH never runs, and this surfaces instead
  // of a silent drop or a broken persisted URL ([R6]).
  const [mediaUploadFailed, setMediaUploadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // POO-702 Secondary #1: set when a save / verification-request persist REJECTS, so the manager sees an
  // explicit save-failed error instead of the old try/finally silently doing nothing.
  const [saveFailed, setSaveFailed] = useState(false);
  // POO-745: the verification lifecycle is read from the profile (`managerVerification`), not the old
  // admin-queue service. `verificationStatus` seeds from it and advances to `pending` after a request;
  // `verificationCode` holds the one-time code from the request-verification response (never a public
  // read) so the modal can (re-)show it; `verifyError` surfaces a failed re-show.
  const [verificationStatus, setVerificationStatus] = useState(profile.managerVerification);
  const [verificationCode, setVerificationCode] = useState<string | null>(null);
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);
  const [verifyError, setVerifyError] = useState(false);
  const [requesting, setRequesting] = useState(false);

  /**
   * Opens the crop dialog for a freshly picked file. POO-586 R1/R2: a wrong-type or >10 MB file is
   * rejected before the crop opens (nothing is cropped/uploaded); the error surfaces instead.
   */
  function handleFile(kind: "avatar" | "banner", file: File | undefined) {
    if (!file) return;
    if (!validateImageFile(file).ok) {
      setUploadError(true);
      return;
    }
    setUploadError(false);
    // PP-NOTE: this object URL is only the crop source. On crop-apply real mode uploads the result to
    // media storage (POO-694, handleCropApplied); mock mode keeps the crop session-local (R7).
    setCrop({ kind, src: URL.createObjectURL(file) });
  }

  /**
   * POO-707 [R4]: apply the cropped image as a LOCAL `data:` preview and STAGE its blob for the deferred
   * Save upload — no upload, no signature here (that was the POO-694 on-crop flow). `buildManagerProfileBody`
   * drops the non-https `data:` preview, so nothing broken can be persisted before Save resolves the real
   * URL. Mock mode has no upload fn: the crop stays a session-local `data:` preview with nothing staged
   * (POO-227 R7).
   */
  function handleCropApplied(dataUrl: string) {
    if (!crop) return;
    const kind = crop.kind;
    if (kind === "avatar") setAvatarUrl(dataUrl);
    else setBannerUrl(dataUrl);
    setMediaUploadFailed(false);
    setSaved(false);
    const upload = kind === "avatar" ? onUploadAvatar : onUploadBanner;
    if (!upload) return; // Mock mode / Storybook: session-local preview only, nothing staged.
    if (kind === "avatar") setStagedAvatarDataUrl(dataUrl);
    else setStagedBannerDataUrl(dataUrl);
  }

  /**
   * POO-707 [R5]: upload any staged avatar/banner blob (session-auth, NO wallet signature) and resolve
   * the URLs the signed PATCH will persist. Runs BEFORE the single signed write in both Save and the
   * verification request, so a full edit costs one signature. Throws a {@link StagedUploadError} tagged
   * with the failing asset on the first upload failure, so the caller aborts before the PATCH and never
   * persists a broken URL ([R6]). Each upload is timeout-bounded so a stalled upload fails visibly.
   */
  async function uploadStagedMedia(): Promise<{ avatarUrl?: string; bannerUrl?: string }> {
    let resolvedAvatar = avatarUrl;
    let resolvedBanner = bannerUrl;
    if (stagedAvatarDataUrl && onUploadAvatar) {
      try {
        const blob = await (await fetch(stagedAvatarDataUrl)).blob();
        resolvedAvatar = await withTimeout(onUploadAvatar(blob), SAVE_TIMEOUT_MS);
      } catch (error) {
        throw new StagedUploadError("avatar", error);
      }
    }
    if (stagedBannerDataUrl && onUploadBanner) {
      try {
        const blob = await (await fetch(stagedBannerDataUrl)).blob();
        resolvedBanner = await withTimeout(onUploadBanner(blob), SAVE_TIMEOUT_MS);
      } catch (error) {
        throw new StagedUploadError("banner", error);
      }
    }
    return { avatarUrl: resolvedAvatar, bannerUrl: resolvedBanner };
  }

  /**
   * Surface + structured-log a staged-media upload failure ([R6]): keep the local preview, flag the
   * inline error, and log the tagged `asset`. Returns nothing — the caller has already aborted before
   * the signed PATCH, so no broken URL is persisted.
   */
  function reportMediaUploadFailure(error: unknown) {
    const asset = error instanceof StagedUploadError ? error.asset : "avatar";
    const cause = error instanceof StagedUploadError ? error.cause : error;
    setMediaUploadFailed(true);
    console.error("PP-MEDIA-UPLOAD failed", {
      surface: "manager",
      asset,
      ...describeError(cause),
    });
  }

  // POO-552 / POO-572: derived validation. The display name must be >= 3 chars once sanitized. A
  // social link that is present but does not normalize for ITS network (wrong domain, a bare handle
  // where the network allows none, or not a URL) is flagged inline (POO-572 R1/R2/R4). An empty
  // field stays neutral. Save is gated on a valid name.
  const cleanName = sanitizeText(name, { maxLength: PROFILE_LIMITS.nameMax });
  const nameValid = cleanName.length >= PROFILE_LIMITS.nameMin;
  const isSocialInvalid = (key: keyof ManagerSocials): boolean => {
    const raw = socials[key]?.trim();
    const net = SOCIAL_NETWORKS.find((entry) => entry.key === key);
    return Boolean(raw && net && normalizeSocialUrl(raw, net) === null);
  };
  // POO-695: a PREFIXED handle input (X/Telegram/Discord/YouTube) whose stored value carries a
  // foreign/unsafe URL (present but doesn't normalize for its network) blocks Save, so a bad paste can
  // never silently CLEAR a previously-valid link on write (data loss). Website (no handleBase) keeps
  // its flag-and-drop-on-save behavior — its inline error is already visible.
  const hasInvalidPrefixedSocial = SOCIAL_NETWORKS.some(
    (net) => net.handleBase !== null && isSocialInvalid(net.key),
  );

  // POO-575 R4: shape validity. After slugify the handle is charset-clean, so only the length matters.
  const handleShapeValid =
    handle.length >= PROFILE_LIMITS.handleMin && handle.length <= PROFILE_LIMITS.handleMax;
  // The handle is unchanged from the seed → it is trivially the manager's own, never a collision.
  const handleUnchanged = handle === toHandleSlug(profile.handle);
  // R4: while editable, Save needs a valid, unique handle (in addition to nameValid). Locked profiles
  // skip the gate (the field is read-only). "Present but invalid" surfaces the inline error.
  const handleValid = handleLocked || (handleShapeValid && (handleUnchanged || !handleTaken));

  // POO-707 [R3]: Save is dirty-tracked — enabled only when something actually changed vs the loaded
  // profile (a text/handle/social field, or a freshly cropped avatar/banner preview) AND the form is
  // valid. An all-unchanged profile keeps Save disabled (no no-op save). A crop sets `avatarUrl`/
  // `bannerUrl` to the `data:` preview in BOTH modes, so this catches a staged image in mock + real.
  const socialsChanged = SOCIAL_NETWORKS.some(
    (net) => (socials[net.key] ?? "") !== (profile.socials?.[net.key] ?? ""),
  );
  const isDirty =
    name !== profile.name ||
    bio !== profile.bio ||
    (!handleLocked && !handleUnchanged) ||
    socialsChanged ||
    avatarUrl !== profile.avatarUrl ||
    bannerUrl !== profile.bannerUrl;

  // POO-751: warn before leaving the Profile tab with unsaved edits — the in-app confirm modal (nav
  // links / console tab switch) + the browser's native prompt on close/refresh (`beforeunload`).
  useUnsavedChanges(isDirty);

  // POO-575 R3: seed the handle from the display name while the manager has not manually edited the
  // handle field (and it is not a pre-set/locked handle). Tracks the name until the first manual edit
  // flips `handleTouched`, after which it never overwrites the user's value.
  useEffect(() => {
    if (handleLocked || handleTouched) return;
    setHandle(toHandleSlug(name, PROFILE_LIMITS.handleMax));
    // Re-run as the name changes; `handleTouched` guards against clobbering a real edit.
  }, [name, handleTouched, handleLocked]);

  // POO-575 R5: check uniqueness whenever the (valid-shaped, changed) handle settles. PP-MOCK scans
  // the local profile map; PP-INTEGRATION-POINT (POO-576): the backend registry availability check.
  useEffect(() => {
    if (handleLocked || handleUnchanged || !handleShapeValid) {
      setHandleTaken(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const available = await checkHandle(handle, managerId);
      if (!cancelled) setHandleTaken(!available);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [handle, handleLocked, handleUnchanged, handleShapeValid, managerId, checkHandle]);

  /** R2: apply the live slug and record the manual edit so the suggestion stops (R3). */
  function handleHandleChange(raw: string) {
    setHandle(toHandleSlug(raw));
    setHandleTouched(true);
    setHandleTaken(false);
  }

  // R4: show the inline error only for a present-but-invalid handle while editable (empty stays
  // neutral, matching the social-link pattern). Distinguish shape vs uniqueness for the message.
  const handleShowShapeError = !handleLocked && handle.length > 0 && !handleShapeValid;
  const handleShowTakenError = !handleLocked && handleShapeValid && !handleUnchanged && handleTaken;
  const handleInvalidShown = handleShowShapeError || handleShowTakenError;

  /**
   * Builds the sanitized profile write shared by Save and the verification request (POO-593 R5).
   * POO-552 / POO-572: sanitize every field before it leaves the client (strip control/bidi chars,
   * cap lengths) and persist the NORMALIZED/built per-network URL (POO-572 R3): a bare @handle
   * becomes its network URL, a wrong-domain or unsafe link is dropped (never persisted). On the first
   * save while unlocked, claim the chosen handle so the mock commits + locks it (POO-575 R6).
   * PP-INTEGRATION-POINT: profile write goes to the manager registry/backend.
   */
  function buildProfileUpdate(media?: { avatarUrl?: string; bannerUrl?: string }) {
    const cleanSocials = Object.fromEntries(
      SOCIAL_NETWORKS.map((net) => [
        net.key,
        normalizeSocialUrl(socials[net.key], net) ?? undefined,
      ]),
    ) as ManagerSocials;
    const claimHandle = !handleLocked && handle.length > 0;
    return {
      name: cleanName,
      bio: sanitizeText(bio, { maxLength: PROFILE_LIMITS.bioMax, allowNewlines: true }),
      // POO-707 [R5]: prefer the freshly-uploaded CDN URL(s) resolved at Save over the local `data:`
      // preview held in state (which buildManagerProfileBody would drop as non-https).
      avatarUrl: media?.avatarUrl ?? avatarUrl,
      bannerUrl: media?.bannerUrl ?? bannerUrl,
      socials: cleanSocials,
      ...(claimHandle ? { handle, handleLocked: true } : {}),
    };
  }

  // POO-707 [R5]: the ONE-signature deferred Save. Upload any staged avatar/banner (session-auth, NO
  // wallet signature) → collect the CDN URL(s) → THEN run the SINGLE existing signed PATCH with the
  // URL(s) + changed text, so a full edit (both images + text) costs exactly one wallet signature.
  async function handleSave() {
    if (!nameValid || !handleValid || hasInvalidPrefixedSocial || !isDirty || saving) return;
    setSaving(true);
    setSaved(false);
    setSaveFailed(false);
    setMediaUploadFailed(false);
    try {
      // Step 1 — upload staged media. On failure keep the preview + surface it and DO NOT run the PATCH:
      // never persist a broken URL or a partial (text-only) save ([R6]).
      let media: { avatarUrl?: string; bannerUrl?: string };
      try {
        media = await uploadStagedMedia();
      } catch (error) {
        reportMediaUploadFailure(error);
        return;
      }
      // Step 2 — the single signed PATCH (the only wallet signature), timeout-bounded so a wedged wallet
      // fails visibly ([R6]).
      const updated = await withTimeout(
        updateProfile(managerId, buildProfileUpdate(media)),
        SAVE_TIMEOUT_MS,
      );
      // Persisted: swap the previews for the trusted CDN URLs and clear the staged blobs (no re-upload).
      if (media.avatarUrl) setAvatarUrl(media.avatarUrl);
      if (media.bannerUrl) setBannerUrl(media.bannerUrl);
      setStagedAvatarDataUrl(null);
      setStagedBannerDataUrl(null);
      setSaved(true);
      onSaved?.(updated);
    } catch (error) {
      // POO-702 Secondary #1: surface an explicit save-failed error AND structured-log the caught error
      // (never swallow it), incl. a TimeoutError from a wedged wallet. The real-mode signed PATCH rejects
      // with the API status/failure-class; on the client it may be redacted to a generic Error + `digest`
      // that ties back to the PP-MEDIA-SAVE log.
      setSaveFailed(true);
      console.error("PP-PROFILE-SAVE failed", {
        surface: "manager",
        action: "save",
        ...describeError(error),
      });
    } finally {
      setSaving(false);
    }
  }

  // POO-745 [R3]: request account verification. Persist the current edits first (so the socials the
  // request is based on are saved — same gates + media-upload flow as Save), then POST the signed
  // request and surface the returned one-time code in the modal. The X-only gate (R2) is enforced by
  // CtaWithMissing's `missing` list AND re-checked here.
  async function handleRequestVerification() {
    // The request persists the current edits (buildProfileUpdate), so the same gates as Save apply: an
    // invalid prefixed social (POO-695) would drop/clear a value on write.
    if (!nameValid || hasInvalidPrefixedSocial || !hasVerificationIdentitySocial(socials)) return;
    setRequesting(true);
    setSaveFailed(false);
    setMediaUploadFailed(false);
    setVerifyError(false);
    try {
      // POO-707 [R5]: like Save, upload any staged media first (session-auth, no signature) then persist
      // the edits with the resolved URL(s) via the single signed PATCH — so the request never persists a
      // dropped `data:` preview. An upload failure surfaces + aborts before the write ([R6]).
      let media: { avatarUrl?: string; bannerUrl?: string };
      try {
        media = await uploadStagedMedia();
      } catch (error) {
        reportMediaUploadFailure(error);
        return;
      }
      const updated = await withTimeout(
        updateProfile(managerId, buildProfileUpdate(media)),
        SAVE_TIMEOUT_MS,
      );
      if (media.avatarUrl) setAvatarUrl(media.avatarUrl);
      if (media.bannerUrl) setBannerUrl(media.bannerUrl);
      setStagedAvatarDataUrl(null);
      setStagedBannerDataUrl(null);
      onSaved?.(updated);
      // PP-ANALYTICS: manager_verification_requested (taxonomy + docs/ANALYTICS_EVENTS.md sync deferred).
      // PP-INTEGRATION-POINT: requestVerification ← POST /api/v1/managers/me/verification/request (POO-744).
      const result = await requestVerification(managerId);
      setVerificationStatus(result.status);
      setVerificationCode(result.code);
      setVerifyModalOpen(true);
    } catch (error) {
      // POO-702 Secondary #1: the persist-then-request chain failed (incl. a wedged-wallet TimeoutError);
      // surface an explicit error AND structured-log it — never swallow it. The write is the risky step,
      // so it lands on the save-failed indicator.
      setSaveFailed(true);
      console.error("PP-PROFILE-SAVE failed", {
        surface: "manager",
        action: "verification-request",
        ...describeError(error),
      });
    } finally {
      setRequesting(false);
    }
  }

  // POO-745 [R6]: re-show the SAME code while pending. Idempotent re-request (the API returns the same
  // code; the code is never on a public read), so this does NOT persist edits — it just re-fetches the
  // code and reopens the modal. A failure surfaces inline next to the control.
  async function handleShowVerificationCode() {
    setRequesting(true);
    setVerifyError(false);
    try {
      const result = await requestVerification(managerId);
      setVerificationStatus(result.status);
      setVerificationCode(result.code);
      setVerifyModalOpen(true);
    } catch (error) {
      setVerifyError(true);
      console.error("PP-VERIFICATION-REQUEST failed", {
        surface: "manager",
        action: "verification-reshow",
        ...describeError(error),
      });
    } finally {
      setRequesting(false);
    }
  }

  // POO-745 [R2]: the request is available once the X identity social is a valid link (X-only gate,
  // unchanged); otherwise the CTA stays tappable and reveals what to add.
  const canRequestVerification = hasVerificationIdentitySocial(socials);
  const verificationMissing = canRequestVerification ? [] : [t("profileTab.verify.missingSocial")];

  /**
   * POO-745: the verification control, driven by `managerVerification`.
   * - `valid`: the verified badge, shown IN PLACE of the button (resolved decision);
   * - `pending`: a "Pending validation" button that re-opens the same code ([R5]/[R6]);
   * - `none`: the request CTA, gated on the X identity social ([R2]/[R3]).
   */
  function renderVerification() {
    if (verificationStatus === "valid") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-info/40 bg-info/10 px-3 py-1.5 font-medium text-foreground text-sm">
          {/* Label uses text-foreground for AA contrast on bg-info/10; the icon carries the info accent. */}
          <BadgeCheck className="size-4 text-info" aria-hidden="true" />
          {t("profileTab.verify.verified")}
        </span>
      );
    }
    if (verificationStatus === "pending") {
      return (
        <div className="flex flex-col items-end gap-1.5">
          <Button
            data-testid="verification-pending"
            variant="secondary"
            size="sm"
            loading={requesting}
            onClick={handleShowVerificationCode}
          >
            {t("profileTab.verify.pendingValidation")}
          </Button>
          <p className="max-w-64 text-muted-foreground text-xs">
            {t("profileTab.verify.pendingHelp")}
          </p>
          {verifyError ? (
            <p className="text-destructive text-xs">{t("profileTab.verify.reshowError")}</p>
          ) : null}
        </div>
      );
    }
    // `none`: offer the request, gated on the X identity social (R2/R3).
    return (
      <CtaWithMissing
        missing={verificationMissing}
        missingTitle={t("profileTab.verify.missingTitle")}
        size="sm"
        loading={requesting}
        disabled={!nameValid || saving}
        onClick={handleRequestVerification}
        wrapperClassName="items-end"
      >
        {t("profileTab.verify.request")}
      </CtaWithMissing>
    );
  }

  const inputClasses =
    "w-full rounded-xl border border-border bg-surface-raised px-3.5 py-2.5 text-foreground text-sm placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {/* Banner (R2) */}
      <section className="flex flex-col gap-2">
        <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {t("profileTab.banner.label")}
        </span>
        <div
          data-testid="banner-preview"
          className="relative h-44 overflow-hidden rounded-2xl bg-gradient-to-br from-primary/50 via-surface to-brand-grape/40"
        >
          {/* The whole banner is a click target for the picker, sharing the hidden input below via
              htmlFor (builder-logo idiom). The visible button stays the keyboard control. */}
          <label
            htmlFor="manager-banner-input"
            data-testid="banner-upload"
            className="absolute inset-0 cursor-pointer"
          >
            {bannerUrl ? <img src={bannerUrl} alt="" className="size-full object-cover" /> : null}
          </label>
          <div className="absolute right-3 bottom-3">
            <Button variant="secondary" size="sm" onClick={() => bannerInputRef.current?.click()}>
              {t("profileTab.banner.change")}
            </Button>
          </div>
        </div>
        <p className="text-muted-foreground text-xs">{t("profileTab.banner.help")}</p>
        <input
          id="manager-banner-input"
          ref={bannerInputRef}
          type="file"
          accept={IMAGE_ACCEPT_ATTR}
          aria-label={t("profileTab.banner.change")}
          className="hidden"
          onChange={(event) => {
            handleFile("banner", event.target.files?.[0]);
            // POO-506 R1: reset so re-picking the SAME file fires change again (the browser
            // suppresses the event when the input value is unchanged).
            event.target.value = "";
          }}
        />
      </section>

      {/* Photo */}
      <section className="flex items-center gap-4">
        {/* The photo circle is itself a click target for the picker, sharing the hidden input below
            via htmlFor (builder-logo idiom). The visible button stays the keyboard control. */}
        <label
          htmlFor="manager-avatar-input"
          data-testid="avatar-upload"
          className="block size-20 shrink-0 cursor-pointer overflow-hidden rounded-full"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="size-full object-cover" />
          ) : (
            <span
              aria-hidden="true"
              className="flex size-full items-center justify-center rounded-full bg-surface-raised font-bold text-2xl text-muted-foreground"
            >
              {name.charAt(0).toUpperCase()}
            </span>
          )}
        </label>
        <div className="flex flex-col gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => avatarInputRef.current?.click()}>
            {t("profileTab.photo.change")}
          </Button>
          <p className="text-muted-foreground text-xs">{t("profileTab.photo.help")}</p>
        </div>
        {/* POO-593: verification request / status, to the right of the photo. */}
        <div className="ml-auto">{renderVerification()}</div>
        <input
          id="manager-avatar-input"
          ref={avatarInputRef}
          type="file"
          accept={IMAGE_ACCEPT_ATTR}
          aria-label={t("profileTab.photo.change")}
          className="hidden"
          onChange={(event) => {
            handleFile("avatar", event.target.files?.[0]);
            // POO-506 R1: reset so re-picking the SAME file fires change again.
            event.target.value = "";
          }}
        />
      </section>

      {/* POO-586 R3: one combined image-limit error, shared by the banner + photo pickers (cleared on
          the next valid pick). Sits below both controls, matching the surface's inline-error pattern. */}
      {uploadError ? (
        <p className="text-destructive text-xs">{tCommon("validation.imageTooLargeOrType")}</p>
      ) : null}
      {/* POO-694: the avatar/banner upload failed (e.g. media hosting not configured, a declined
          signature, an S3 error); the local crop preview is kept so the edit isn't lost, and this
          surfaces instead of a silent drop under a green "Profile saved". Cleared on the next crop. */}
      {mediaUploadFailed ? (
        <p className="text-destructive text-xs">{t("profileTab.mediaUploadFailed")}</p>
      ) : null}

      {/* Identity fields */}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            {t("profileTab.fields.name")}
          </span>
          {/* POO-552: min 3 / max 50 (browser enforces the cap; a short name gates Save + hints). */}
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={PROFILE_LIMITS.nameMax}
            aria-invalid={!nameValid}
            className={inputClasses}
          />
          {!nameValid ? (
            <span className="text-destructive text-xs">
              {t("profileTab.validation.nameMin", { min: PROFILE_LIMITS.nameMin })}
            </span>
          ) : null}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            {t("profileTab.fields.handle")} · {managerProfileUrl("")}
          </span>
          {/* POO-575: the handle is editable until the first save, then locks (R1). While locked it is
              the read-only identity (as before, value from the persisted profile); while unlocked it
              is a live slug (R2) seeded from the display name (R3) and validated for shape +
              uniqueness (R4/R5). One input, toggled by the lock, so the label association is static. */}
          <input
            value={handleLocked ? profile.handle : handle}
            onChange={(event) => handleHandleChange(event.target.value)}
            readOnly={handleLocked}
            disabled={handleLocked}
            maxLength={PROFILE_LIMITS.handleMax}
            inputMode="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={handleInvalidShown}
            className={cn(inputClasses, handleInvalidShown && "ring-1 ring-destructive")}
          />
          {handleShowShapeError ? (
            <span className="text-destructive text-xs">
              {t("profileTab.validation.handleInvalid")}
            </span>
          ) : null}
          {handleShowTakenError ? (
            <span className="text-destructive text-xs">
              {t("profileTab.validation.handleTaken")}
            </span>
          ) : null}
          {/* POO-575 R1/R6: warn (muted helper text, distinct from the red validation error) that the
              handle is permanent — shown ONLY while editable, hidden once locked / read-only. */}
          {!handleLocked ? (
            <span className="text-muted-foreground text-xs">
              {t("profileTab.handleLockWarning")}
            </span>
          ) : null}
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        {/* POO-552: description capped at 2,000 (browser-enforced) with a live counter. */}
        <span className="flex items-center justify-between gap-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
          <span>{t("profileTab.fields.bio")}</span>
          <span className="normal-case tabular-nums tracking-normal">
            {bio.length} / {PROFILE_LIMITS.bioMax}
          </span>
        </span>
        <textarea
          value={bio}
          onChange={(event) => setBio(event.target.value)}
          maxLength={PROFILE_LIMITS.bioMax}
          rows={3}
          className={cn(inputClasses, "scrollbar-dark")}
        />
      </label>

      {/* Socials (R4) — POO-552: a brand logo per network + minimal link validation. A link must be a
          safe http(s) URL; an invalid one is flagged inline and dropped on save (never persisted). */}
      <section className="flex flex-col gap-2">
        <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {t("profileTab.fields.socials")}
        </span>
        <div className="flex flex-col gap-2">
          {SOCIAL_NETWORKS.map((net) => {
            const { key, label, placeholder, Icon } = net;
            const prefix = socialInputPrefix(net);
            const invalid = isSocialInvalid(key);
            // POO-695: a present-but-invalid social flags inline for EVERY network — including the
            // prefixed handle inputs, whose error used to be suppressed so a foreign-domain paste was
            // dropped silently on save. A valid bare handle / matching-domain URL always normalizes, so
            // an error only shows for a genuine foreign/unsafe value the manager can see and fix.
            const showError = invalid;
            // Bind the label to its input via htmlFor/id (the visible network name sits in a nested
            // span, and for prefixed networks the input is one span deeper, so the association is
            // explicit rather than by-nesting).
            const inputId = `manager-social-${key}`;
            return (
              <label key={key} htmlFor={inputId} className="flex flex-col gap-1">
                <span className="flex items-center gap-3">
                  <span className="flex w-24 shrink-0 items-center gap-1.5 font-medium text-muted-foreground text-sm">
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    {label}
                  </span>
                  {prefix ? (
                    <span
                      className={cn(
                        "flex w-full items-center gap-1 rounded-xl border border-border bg-surface-raised px-3.5 text-sm focus-within:ring-2 focus-within:ring-ring",
                        invalid && "border-destructive ring-1 ring-destructive",
                      )}
                    >
                      <span className="shrink-0 select-none text-muted-foreground">{prefix}</span>
                      <input
                        id={inputId}
                        aria-label={label}
                        value={socialHandleValue(socials[key], net)}
                        placeholder={socialHandlePlaceholder(net)}
                        inputMode="text"
                        maxLength={PROFILE_LIMITS.urlMax}
                        aria-invalid={invalid}
                        onChange={(event) => {
                          const typed = event.target.value.trim();
                          if (hasUrlScheme(typed)) {
                            // POO-695: a full URL was pasted. Normalize it for THIS network: a
                            // matching-domain URL is stored normalized (socialHandleValue then shows
                            // just the handle, the fixed prefix stays honest); a foreign/unsafe URL is
                            // kept verbatim so it flags inline (never fabricated into a bogus handle)
                            // and blocks Save — instead of being silently dropped on write (POO-657
                            // stored it as-is, which cleared a valid link).
                            const normalized = normalizeSocialUrl(typed, net);
                            setSocials((current) => ({ ...current, [key]: normalized ?? typed }));
                            return;
                          }
                          // Bare handle: strip a leading @ and expand with the fixed prefix.
                          const handle = typed.replace(/^@+/, "");
                          setSocials((current) => ({
                            ...current,
                            [key]: handle ? `${net.handleBase}${handle}` : undefined,
                          }));
                        }}
                        className="min-w-0 flex-1 bg-transparent py-2.5 text-foreground outline-none placeholder:text-muted-foreground/60"
                      />
                    </span>
                  ) : (
                    <input
                      id={inputId}
                      aria-label={label}
                      value={socials[key] ?? ""}
                      placeholder={placeholder}
                      inputMode="url"
                      maxLength={PROFILE_LIMITS.urlMax}
                      aria-invalid={invalid}
                      onChange={(event) =>
                        setSocials((current) => ({
                          ...current,
                          [key]: event.target.value || undefined,
                        }))
                      }
                      className={cn(inputClasses, invalid && "ring-1 ring-destructive")}
                    />
                  )}
                </span>
                {showError ? (
                  <span className="pl-[6.75rem] text-destructive text-xs">
                    {prefix
                      ? // POO-695: the prefixed input takes a handle, so the error asks for a handle
                        // (not a full URL) — a foreign-domain paste doesn't belong to this network.
                        t("profileTab.validation.linkWrongNetwork", { network: label })
                      : t("profileTab.validation.linkInvalidFor", {
                          network: label,
                          example: placeholder,
                        })}
                  </span>
                ) : null}
              </label>
            );
          })}
          {/* PP-TODO(POO-748): DISABLED "coming soon" social placeholders (Instagram, plus TikTok +
              LinkedIn from POO-851), rendered from COMING_SOON_SOCIALS so all three stay identical.
              They are intentionally NOT part of `socials`/SOCIAL_NETWORKS/ManagerSocials, because the
              manager registry has no column for them yet (Instagram POO-747, BE) and a wired value
              would be silently stripped on save (data loss). When a network's backend column ships:
              drop it from COMING_SOON_SOCIALS and add a real SOCIAL_NETWORKS entry (it then renders
              like the others, editable + persisted). */}
          {COMING_SOON_SOCIALS.map(({ messageKey, label, prefix: brandPrefix, Icon }) => (
            <div key={messageKey} className="flex flex-col gap-1">
              <span className="flex items-center gap-3">
                <span className="flex w-24 shrink-0 items-center gap-1.5 font-medium text-muted-foreground text-sm">
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {label}
                </span>
                <span className="flex w-full items-center gap-1 rounded-xl border border-border border-dashed bg-surface-raised px-3.5 text-muted-foreground/60 text-sm">
                  <span className="shrink-0 select-none">{brandPrefix}</span>
                  <input
                    aria-label={label}
                    disabled
                    placeholder="yourhandle"
                    className="min-w-0 flex-1 cursor-not-allowed bg-transparent py-2.5 text-muted-foreground/60 outline-none placeholder:text-muted-foreground/40"
                  />
                  <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                    {t(`profileTab.${messageKey}.comingSoon`)}
                  </span>
                </span>
              </span>
              <span className="pl-[6.75rem] text-muted-foreground text-xs">
                {t(`profileTab.${messageKey}.hint`)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <p className="text-muted-foreground text-xs">{t("profileTab.autoList")}</p>

      {/* Footer: view-public link + the single Save CTA */}
      <div className="flex items-center justify-between gap-4">
        <Link
          href={`/m/${profile.handle}`}
          className="inline-flex items-center gap-1.5 font-medium text-primary text-sm hover:underline"
        >
          {t("profileTab.viewPublic")}
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </Link>
        <div className="flex items-center gap-3">
          {/* POO-707 [R6]: a visible uploading/saving state through the chained upload(s) → signed PATCH. */}
          {saving ? (
            <span className="text-muted-foreground text-sm">{t("profileTab.saving")}</span>
          ) : null}
          {saved ? <span className="text-success text-sm">{t("profileTab.saved")}</span> : null}
          {/* POO-702 Secondary #1: a failed save / verification-request now shows an explicit error
              instead of the old try/finally silently doing nothing. */}
          {saveFailed ? (
            <span className="text-destructive text-sm">{t("profileTab.saveFailed")}</span>
          ) : null}
          {/* POO-593: also block Save while a verification request is in flight so the two writes
              can't run concurrently and desync the profile via out-of-order onSaved. POO-707 [R3]:
              dirty-tracked — disabled until something changed AND the form is valid (no no-op save). */}
          <Button
            onClick={handleSave}
            disabled={
              saving ||
              requesting ||
              !isDirty ||
              !nameValid ||
              !handleValid ||
              hasInvalidPrefixedSocial
            }
          >
            {t("profileTab.save")}
          </Button>
        </div>
      </div>

      {crop ? (
        <ImageCropModal
          open
          onOpenChange={(next) => {
            if (!next) setCrop(null);
          }}
          src={crop.src}
          aspect={crop.kind === "banner" ? 16 / 9 : 1}
          // Avatar crops round; both allow zooming out below the cover fit (consistent with the
          // builder logo + investor avatar — murilo 2026-06-29).
          round={crop.kind !== "banner"}
          minZoom={0.5}
          title={
            crop.kind === "banner"
              ? t("profileTab.crop.titleBanner")
              : t("profileTab.crop.titleAvatar")
          }
          description={t("profileTab.crop.help")}
          showSafeArea={crop.kind === "banner"}
          safeAreaLabel={t("profileTab.crop.safeArea")}
          zoomLabel={t("profileTab.crop.zoom")}
          applyLabel={t("profileTab.crop.apply")}
          cancelLabel={t("profileTab.crop.cancel")}
          onApply={handleCropApplied}
        />
      ) : null}

      {/* POO-745 [R4]/[R6]: the one-time verification code (from the request response). Kept mounted
          once a code exists so a pending re-show reopens the SAME code; never regenerated here. */}
      {verificationCode ? (
        <VerificationCodeModal
          open={verifyModalOpen}
          onOpenChange={setVerifyModalOpen}
          code={verificationCode}
        />
      ) : null}
    </div>
  );
}
