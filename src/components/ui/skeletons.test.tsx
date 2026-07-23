import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  SettingsLayoutSkeleton,
  SkeletonCard,
  SkeletonHeading,
  SkeletonHero,
  SkeletonListRow,
  SkeletonRows,
  SkeletonTable,
  SkeletonTile,
  SkeletonTiles,
} from "./skeletons";

describe("skeleton building blocks", () => {
  it("renders every piece without crashing and exposes decorative placeholders", () => {
    const { container } = render(
      <>
        <SkeletonHeading back />
        <SkeletonHeading subtitle={false} />
        <SkeletonTile />
        <SkeletonTiles count={3} />
        <SkeletonHero />
        <SkeletonCard lines={4} />
        <SkeletonListRow />
        <SkeletonRows count={2} />
        <SkeletonTable rows={2} />
        <SettingsLayoutSkeleton />
      </>,
    );
    // Each placeholder is the decorative Skeleton (role="presentation", aria-hidden).
    expect(container.querySelectorAll('[role="presentation"]').length).toBeGreaterThan(10);
  });

  it("renders custom detail passed to SettingsLayoutSkeleton", () => {
    const { getByTestId } = render(
      <SettingsLayoutSkeleton>
        <div data-testid="detail" />
      </SettingsLayoutSkeleton>,
    );
    expect(getByTestId("detail")).toBeInTheDocument();
  });
});
