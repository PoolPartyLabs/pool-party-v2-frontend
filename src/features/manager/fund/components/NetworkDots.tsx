/**
 * @id PP-MGR-CMP-042
 * @name NetworkDots
 * @implements-rules-version v2 (POO-2142 rules v2)
 * @analytics-events none, the shell emits
 *
 * POO-2123 [R10], epic POO-2119. Network logos that say which network they are.
 *
 * A 16 px coloured circle is not a network name. R10 makes the name reachable three ways at once,
 * and all three are needed: the Radix tooltip (side top, offset 4) for a mouse, `title` for a touch
 * long-press, and an accessible name on a `role="img"` wrapper for a screen reader. The logo itself
 * stays `aria-hidden` (that is {@link NetworkLogo}'s own contract), so the wrapper carries the
 * meaning.
 *
 * The one half of R10 this does NOT do is the tooltip on keyboard focus, deliberately: a dot is not
 * a control, and a Protocols row can carry five of them, so making each a tab stop would bury the
 * row's own checkbox under twenty decorative stops. The name is in the accessible name instead,
 * which reaches a keyboard and screen-reader user without any tooltip opening at all.
 *
 * Names come from a LITERAL record of `t()` calls. `MandateNetwork.name` holds a translation key,
 * and `t(network.name)` would be a dynamic key the i18n usage scan cannot see, so the key would rot
 * silently the day a network is renamed. {@link useNetworkNames} is that record, exported so the
 * steps use the same one rather than each declaring a copy that can drift.
 *
 * Brand colours come from the catalog (`PP-MGR-LIB-018`), never from a local map: a network with no
 * committed mark under `public/networks` (Unichain, commented out of the buildathon scope by POO-2142)
 * falls back to a monogram, and the monogram must be the brand's colour, which only the catalog knows.
 */
"use client";

import { useTranslations } from "next-intl";
import { NetworkLogo } from "@/components/data-display/NetworkLogo";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils/cn";
import type { MandateCatalog } from "../mandateCatalog";
import type { NetworkId } from "../mandateDraft";

/**
 * The translated network names, keyed by id (R10).
 *
 * Every key is a literal so the i18n usage scan binds it; indexing the result by a dynamic id is
 * what the catalog's key-shaped `name` field is for.
 */
export function useNetworkNames(): Record<NetworkId, string> {
  const t = useTranslations("manager");
  return {
    arbitrum: t("fundBuilder.networkNames.arbitrum"),
    robinhood: t("fundBuilder.networkNames.robinhood"),
    // PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
    // base: t("fundBuilder.networkNames.base"),
    // polygon: t("fundBuilder.networkNames.polygon"),
    // unichain: t("fundBuilder.networkNames.unichain"),
  };
}

/** Public props for {@link NetworkLogoWithName}. */
export interface NetworkLogoWithNameProps {
  /** The network to draw. */
  network: NetworkId;
  /** Source of the brand colour used when the network has no committed mark. */
  catalog: MandateCatalog;
  /** Logo edge size in px. Defaults to 16. */
  size?: number;
  /** Extra classes on the wrapper. */
  className?: string;
}

/** One network logo that carries its name: tooltip on hover, `title`, and an accessible name. */
export function NetworkLogoWithName({
  network,
  catalog,
  size = 16,
  className,
}: NetworkLogoWithNameProps) {
  const names = useNetworkNames();
  const name = names[network];
  const brandColor = catalog.networks.find((entry) => entry.id === network)?.brandColor;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* The wrapper carries the name; `NetworkLogo` inside it is aria-hidden by its own
              contract. NOT focusable on purpose: a protocol row can show five of these, and making
              each a tab stop would put twenty decorative stops between two checkboxes. The name is
              already in the accessible name, so a keyboard or screen-reader user has it without the
              tooltip ever opening; the tooltip and `title` serve the mouse and the long-press. */}
          <span
            role="img"
            aria-label={name}
            title={name}
            className={cn("inline-flex shrink-0 rounded-full", className)}
          >
            <NetworkLogo
              network={network}
              name={name}
              size={size}
              fallbackColor={brandColor}
              className="pointer-events-none"
            />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {name}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Public props for {@link NetworkDots}. */
export interface NetworkDotsProps {
  /** The networks to draw, in the order they should appear. */
  networks: NetworkId[];
  /** Source of the brand colours. */
  catalog: MandateCatalog;
  /** Logo edge size in px. Defaults to 16. */
  size?: number;
  /**
   * How many logos to draw. Defaults to 5, the size of the whole network universe before the
   * buildathon scope (POO-2142), so nothing is dropped today; a caller with less room passes a
   * smaller number.
   */
  max?: number;
  /** Extra classes on the row. */
  className?: string;
}

/** A compact row of network logos, each carrying its name (R10). */
export function NetworkDots({
  networks,
  catalog,
  size = 16,
  max = 5,
  className,
}: NetworkDotsProps) {
  const shown = networks.slice(0, max);
  if (shown.length === 0) return null;

  return (
    <span className={cn("inline-flex items-center", className)}>
      {shown.map((network, index) => (
        <NetworkLogoWithName
          key={network}
          network={network}
          catalog={catalog}
          size={size}
          // 4 px overlap, so a long row of networks stays compact beside the row title.
          className={index > 0 ? "-ml-1" : undefined}
        />
      ))}
    </span>
  );
}
