/**
 * @id PP-CORE (POO-158)
 * @name TrackView.test
 * @implements-rules-version v1
 * Unit tests for TrackView: pushes its event on mount and renders nothing.
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { TrackView } from "./TrackView";

describe("TrackView", () => {
  beforeEach(() => {
    window.dataLayer = [];
  });

  it("pushes its event once and renders nothing", () => {
    const { container } = render(<TrackView event="home_viewed" />);
    expect(container).toBeEmptyDOMElement();
    expect(window.dataLayer).toContainEqual(expect.objectContaining({ event: "home_viewed" }));
  });

  it("forwards params", () => {
    render(<TrackView event="position_detail_viewed" params={{ position_id: "pos_9" }} />);
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "position_detail_viewed", position_id: "pos_9" }),
    );
  });
});
