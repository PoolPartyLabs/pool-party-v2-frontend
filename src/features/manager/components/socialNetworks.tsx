/**
 * @id PP-MGR-CMP-032 (POO-552, POO-572, POO-593)
 * @name socialNetworks
 * @implements-rules-version v3
 *
 * v3 (POO-851): TikTok + LinkedIn coming-soon placeholders. Add {@link TikTokMark}/{@link LinkedInMark}
 * brand glyphs (lucide ships no brand glyphs, POO-593 trap) and a {@link COMING_SOON_SOCIALS} list
 * (Instagram + TikTok + LinkedIn) that {@link ManagerProfileTabView} maps into DISABLED "coming soon"
 * rows. These are placeholders ONLY: intentionally NOT in {@link SOCIAL_NETWORKS} (no backend column
 * yet), so nothing persists.
 *
 * v2 (POO-657): Discord gains a `handleBase` (`https://discord.gg/`) so it's prefix-based, and helpers
 * ({@link socialInputPrefix}, {@link socialHandlePlaceholder}, {@link socialHandleValue}) drive the
 * profile's fixed-prefix + handle-only inputs.
 *
 * The single source of truth for the manager's social networks: order, label, input placeholder,
 * brand icon AND link validation config (POO-572 R5). Shared by the PUBLIC profile chips
 * ({@link ManagerProfileScreen}) and the console Profile edit form ({@link ManagerProfileTabView}) so
 * the two never drift. Network names are proper nouns, never translated. Icons are inline SVGs
 * (lucide ships no X / YouTube / Discord brand glyph; POO-746 replaced Discord's generic bubble).
 *
 * POO-572: each entry declares its accepted `domains` (subdomain-aware, R1) and an optional
 * `handleBase` (the URL prefix a bare @handle expands into, R2). {@link normalizeSocialUrl} is the pure
 * per-network validator/normalizer layered on top of `safeHttpUrl` (scheme/host safety is kept there).
 */
import { Globe, Send } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import type { ManagerSocials } from "@/lib/schemas";
import { safeHttpUrl } from "@/lib/utils/sanitize";

/** A YouTube play mark (lucide ships no YouTube glyph). */
export function YoutubeMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
      <path d="m10 15 5-3-5-3z" />
    </svg>
  );
}

/** The official X mark (lucide has no X-network glyph). */
export function XMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.451-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z" />
    </svg>
  );
}

/** The Discord mark (POO-746; lucide ships no Discord glyph — it fell back to a generic bubble). */
export function DiscordMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.927 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.955 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
    </svg>
  );
}

/**
 * The Instagram glyph (lucide ships only a generic camera outline; this is the recognizable brand
 * mark, matching the {@link XMark}/{@link YoutubeMark}/{@link DiscordMark} treatment). PP-TODO(POO-748):
 * Instagram is NOT a persisted social network yet; this mark exists ONLY for the DISABLED "coming
 * soon" placeholder in {@link ManagerProfileTabView}, mapped from {@link COMING_SOON_SOCIALS}. When the
 * backend registry adds the instagram column (POO-747), add a real `instagram` entry to
 * SOCIAL_NETWORKS (it will reuse this mark) and drop it from the placeholder list.
 */
export function InstagramMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

/**
 * The TikTok glyph (lucide ships no TikTok brand glyph; POO-593 trap). Recognizable brand mark,
 * matching the {@link XMark}/{@link DiscordMark}/{@link InstagramMark} treatment. PP-TODO(POO-748):
 * TikTok is NOT a persisted social network (added as a DISABLED "coming soon" placeholder by POO-851);
 * this mark exists ONLY for that placeholder in {@link ManagerProfileTabView}, mapped from
 * {@link COMING_SOON_SOCIALS}. When the backend registry adds the tiktok column, add a real `tiktok`
 * entry to SOCIAL_NETWORKS (it will reuse this mark) and drop it from the placeholder list.
 */
export function TikTokMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </svg>
  );
}

/**
 * The LinkedIn glyph (lucide ships no LinkedIn brand glyph; POO-593 trap). Recognizable brand mark,
 * matching the {@link XMark}/{@link DiscordMark}/{@link InstagramMark} treatment. PP-TODO(POO-748):
 * LinkedIn is NOT a persisted social network (added as a DISABLED "coming soon" placeholder by
 * POO-851); this mark exists ONLY for that placeholder in {@link ManagerProfileTabView}, mapped from
 * {@link COMING_SOON_SOCIALS}. When the backend registry adds the linkedin column, add a real
 * `linkedin` entry to SOCIAL_NETWORKS (it will reuse this mark) and drop it from the placeholder list.
 */
export function LinkedInMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z" />
    </svg>
  );
}

/** One manager social network: its profile key, label, placeholder, icon and link validation config. */
export interface SocialNetwork {
  key: keyof ManagerSocials;
  label: string;
  placeholder: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  /**
   * POO-572 R1: accepted hostnames, subdomain-aware (host === d OR host endsWith "." + d). `null`
   * means no domain restriction (Website accepts any safe http(s) URL).
   */
  domains: string[] | null;
  /**
   * POO-572 R2: the URL prefix a bare @handle expands into (a leading `@` is stripped from the
   * handle first; for YouTube the base ends in `@` so exactly one `@` remains). `null` means the
   * network has no handle concept, so a bare handle is invalid (require a full matching URL).
   */
  handleBase: string | null;
}

/**
 * Networks in display order (chips + edit inputs). Config (domains + handleBase) is POO-572 R5 and
 * MIRRORS the deployed pool-party-api `social-links.ts` allow-list byte-for-byte (POO-582/POO-579), so
 * an invalid link fails locally instead of a server 400. POO-593: the identity network (X) leads the
 * list — the verification gate reads it. Instagram is intentionally absent: the registry persists only
 * these five columns (x/telegram/discord/youtube/website), so an Instagram link would be silently
 * stripped on write. Backend Instagram support is a separate product/schema decision (POO-593 note).
 * PP-TODO(POO-748): the DISABLED "coming soon" placeholders (Instagram, plus TikTok + LinkedIn from
 * POO-851) render in {@link ManagerProfileTabView} from {@link COMING_SOON_SOCIALS} (not wired here, so
 * nothing persists). When a network's backend column lands (Instagram POO-747), add its entry HERE
 * (with its brand mark) and drop it from COMING_SOON_SOCIALS.
 */
export const SOCIAL_NETWORKS: SocialNetwork[] = [
  {
    key: "x",
    label: "X",
    placeholder: "https://x.com/yourhandle",
    Icon: XMark,
    domains: ["x.com", "twitter.com"],
    handleBase: "https://x.com/",
  },
  {
    key: "telegram",
    label: "Telegram",
    placeholder: "https://t.me/yourchannel",
    Icon: Send,
    domains: ["t.me", "telegram.me"],
    handleBase: "https://t.me/",
  },
  {
    key: "discord",
    label: "Discord",
    placeholder: "https://discord.gg/yourserver",
    Icon: DiscordMark,
    domains: ["discord.gg", "discord.com", "discordapp.com"],
    // POO-657: the profile input is prefix-based (`discord.gg/` + the invite), so a bare token expands
    // to a discord.gg invite URL — the most common manager share. The deployed backend `social-links.ts`
    // has Discord `handleBase: null` (it rejects a *bare* handle), but the FE always emits the EXPANDED
    // `https://discord.gg/<token>` URL, which the backend accepts (discord.gg is an allowed host) — so
    // the wire payload never 400s despite the input-affordance divergence (POO-579).
    handleBase: "https://discord.gg/",
  },
  {
    key: "youtube",
    label: "YouTube",
    placeholder: "https://youtube.com/@yourchannel",
    Icon: YoutubeMark,
    domains: ["youtube.com", "youtu.be", "m.youtube.com"],
    handleBase: "https://youtube.com/@",
  },
  {
    key: "website",
    label: "Website",
    placeholder: "https://yourdomain.xyz",
    Icon: Globe,
    // Any safe http(s) URL; a website has no handle concept.
    domains: null,
    handleBase: null,
  },
];

/** One DISABLED "coming soon" social placeholder: its i18n key, display label, fixed prefix and mark. */
export interface ComingSoonSocial {
  /** Selects the `profileTab.<messageKey>.{comingSoon,hint}` i18n copy in {@link ManagerProfileTabView}. */
  messageKey: "instagram" | "tiktok" | "linkedin";
  /** The proper-noun network name, shown next to the mark. NEVER translated. */
  label: string;
  /** The fixed, non-editable domain prefix shown before the disabled input (e.g. `tiktok.com/@`). */
  prefix: string;
  /** The inline brand glyph. */
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

/**
 * PP-TODO(POO-748): the DISABLED "coming soon" social placeholders (Instagram, plus TikTok + LinkedIn
 * from POO-851). Each network has NO backend column yet, so it is intentionally ABSENT from
 * {@link SOCIAL_NETWORKS} / ManagerSocials (a wired value would be silently stripped on save = data
 * loss). {@link ManagerProfileTabView} maps this list into locked, dashed placeholder rows (never
 * hand-rolled, so all three stay identical). When a network's backend column lands (Instagram POO-747),
 * DELETE its entry here and add a real {@link SOCIAL_NETWORKS} row (reusing its mark) so it becomes
 * editable + persisted.
 */
export const COMING_SOON_SOCIALS: ComingSoonSocial[] = [
  { messageKey: "instagram", label: "Instagram", prefix: "instagram.com/", Icon: InstagramMark },
  { messageKey: "tiktok", label: "TikTok", prefix: "tiktok.com/@", Icon: TikTokMark },
  { messageKey: "linkedin", label: "LinkedIn", prefix: "linkedin.com/in/", Icon: LinkedInMark },
];

/** True when the string has a leading URL scheme like `http:` / `mailto:` (mirrors sanitize.ts). */
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

/** The per-network validation config {@link normalizeSocialUrl} needs (a subset of {@link SocialNetwork}). */
export type SocialUrlConfig = Pick<SocialNetwork, "domains" | "handleBase">;

/** True when `host` equals `domain` or is a subdomain of it (POO-572 R1, subdomain-aware). */
function hostMatchesDomain(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  const d = domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

/**
 * Validate + normalize one social link for a given network (POO-572 R1/R2). Pure. Returns the
 * normalized/built absolute http(s) URL when valid, or `null` when invalid (wrong domain, a bare
 * handle where the network allows none, or not a URL at all). Empty input returns `null` too: the
 * caller treats "no value" separately (an empty field stays neutral, never flagged; see R4).
 *
 * - Bare handle: no scheme AND (starts with `@` OR has no `.` and no `/`). If `handleBase` is null the
 *   handle is invalid; otherwise strip a leading `@`, reject an empty/space-containing handle, and
 *   build `handleBase + handle`, still validated through `safeHttpUrl`.
 * - Otherwise treat as a URL: run `safeHttpUrl` (keeps the scheme/host/stored-XSS guard); then, when
 *   `domains` is set, require the host to match one of them (subdomain-aware).
 */
export function normalizeSocialUrl(
  raw: string | null | undefined,
  { domains, handleBase }: SocialUrlConfig,
): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;

  const hasScheme = HAS_SCHEME.test(trimmed);
  const isBareHandle = !hasScheme && (trimmed.startsWith("@") || !/[./]/.test(trimmed));
  if (isBareHandle) {
    if (handleBase === null) return null; // network has no handle concept
    const handle = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
    // Reject an empty handle ("@") or one with internal whitespace (defense in depth; a space would
    // have been caught by the URL branch, but a bare "@ x" reaches here).
    if (!handle || /\s/.test(handle)) return null;
    return safeHttpUrl(`${handleBase}${handle}`);
  }

  // Full URL path: scheme/host safety first (rejects javascript:, data:, non-dotted hosts).
  const safe = safeHttpUrl(trimmed);
  if (safe === null) return null;
  if (domains === null) return safe; // no domain restriction (Website)
  const { hostname } = new URL(safe);
  return domains.some((d) => hostMatchesDomain(hostname, d)) ? safe : null;
}

/**
 * POO-657: the fixed, non-editable display prefix for a handle-based network — the `handleBase` minus
 * its scheme, e.g. `https://x.com/` → `x.com/`. `null` for networks with no handle concept (Website),
 * which take a full-URL input instead.
 */
export function socialInputPrefix(net: Pick<SocialNetwork, "handleBase">): string | null {
  return net.handleBase ? net.handleBase.replace(/^https?:\/\//, "") : null;
}

/**
 * POO-657: the handle-only placeholder for a prefixed input — the network's example placeholder minus
 * its `handleBase` prefix, e.g. `https://x.com/yourhandle` → `yourhandle`. Falls back to the full
 * placeholder for no-handle networks (Website).
 */
export function socialHandlePlaceholder(net: SocialNetwork): string {
  return net.handleBase && net.placeholder.startsWith(net.handleBase)
    ? net.placeholder.slice(net.handleBase.length)
    : net.placeholder;
}

/**
 * POO-657: strip the `handleBase` prefix off a stored URL so the prefixed input shows just the handle
 * (`https://x.com/carlos` → `carlos`). Returns the raw value when it doesn't match the base (edge) or
 * for no-handle networks; empty for no value.
 */
export function socialHandleValue(
  value: string | undefined,
  net: Pick<SocialNetwork, "handleBase">,
): string {
  if (!value) return "";
  const base = net.handleBase;
  return base && value.startsWith(base) ? value.slice(base.length) : value;
}
