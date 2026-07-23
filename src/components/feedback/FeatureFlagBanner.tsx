/**
 * @id PP-CORE-CMP-015
 * @name FeatureFlagBanner
 * @implements-rules-version v1
 *
 * TEMP — a prominent banner shown at the top of a dark-launched (flag-gated, not-yet-live) area, so
 * anyone viewing the preview knows it sits behind a feature flag and is not live yet. Every
 * flag-gated page renders it above its content (next to `requireFeature`). It auto-hides once the
 * feature's stage is `live` or `core` (the area has launched), and the whole component is removed
 * before GA. Presentational + server-safe (reads the static flag registry; no hooks).
 */
import { FlaskConical } from "lucide-react";
import { FEATURES, type FeatureKey } from "@/lib/features/registry";

/** Public props for {@link FeatureFlagBanner}. */
export interface FeatureFlagBannerProps {
  /** The feature flag gating the area this banner sits in. */
  feature: FeatureKey;
}

/** A prominent "preview / behind a feature flag" notice for dark-launched areas. */
export function FeatureFlagBanner({ feature }: FeatureFlagBannerProps) {
  const { area, envVar, stage } = FEATURES[feature];
  // Launched areas (core / live) are not previews — render nothing.
  if (stage === "core" || stage === "live") return null;

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4"
    >
      <FlaskConical className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
      <div className="text-sm">
        <p className="font-semibold text-warning">{area} · Preview</p>
        <p className="mt-0.5 text-muted-foreground">
          This area is dark-launched behind the{" "}
          <code className="font-mono text-foreground">{feature}</code> feature flag ({envVar}) and
          is not live yet. This banner is removed before launch.
        </p>
      </div>
    </div>
  );
}
