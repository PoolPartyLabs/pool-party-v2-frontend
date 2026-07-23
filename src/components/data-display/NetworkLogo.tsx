/**
 * @id PP-CORE-CMP-041
 * @name NetworkLogo
 * @implements-rules-version v1
 *
 * The blockchain network a strategy/pool runs on, shown as a small brand-logo avatar. Maps a
 * network slug to a committed official logo asset (public/networks); an unknown slug falls back
 * to a brand-colored monogram so the UI never breaks. Decorative (aria-hidden); the network name
 * is carried by adjacent text. V1 supports Arbitrum, Base and Polygon (the launch chains).
 */
import { cn } from "@/lib/utils/cn";

/** Brand identity (logo asset + color) for one network. */
interface NetworkVisual {
  /** Committed official logo asset under public/networks. */
  src: string;
  /** Brand color, used only by the monogram fallback. */
  color: string;
}

// PP-NOTE: brand identity (logo + color), not theme tokens. Logos are official marks committed
// under public/networks. Keep these slugs in sync with the builder NETWORKS + supportedChains.
const NETWORK_VISUALS: Record<string, NetworkVisual> = {
  ethereum: { src: "/networks/ethereum.png", color: "#627EEA" },
  base: { src: "/networks/base.png", color: "#0052FF" },
  arbitrum: { src: "/networks/arbitrum.png", color: "#28A0F0" },
  polygon: { src: "/networks/polygon.png", color: "#8247E5" },
};

/** Public props for {@link NetworkLogo}. */
export interface NetworkLogoProps {
  /** Network slug, e.g. "base" | "arbitrum" | "polygon". */
  network: string;
  /** Display name, used for the monogram fallback (first letter) and as the a11y meaning carrier. */
  name: string;
  /** Logo edge size in px. Defaults to 16. */
  size?: number;
  /** Brand color for the monogram fallback when the network has no committed logo. */
  fallbackColor?: string;
  /** Extra classes on the element. */
  className?: string;
}

/** A small network logo avatar; brand-colored monogram fallback for an unmapped network. */
export function NetworkLogo({
  network,
  name,
  size = 16,
  fallbackColor = "#737373",
  className,
}: NetworkLogoProps) {
  const visual = NETWORK_VISUALS[network.toLowerCase()];

  if (visual) {
    return (
      // Decorative; the adjacent network name carries the meaning.
      <img
        src={visual.src}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        className={cn("shrink-0 rounded-full", className)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold text-[8px] text-white",
        className,
      )}
      style={{ width: size, height: size, backgroundColor: fallbackColor }}
    >
      {(name.charAt(0) || "?").toUpperCase()}
    </span>
  );
}
