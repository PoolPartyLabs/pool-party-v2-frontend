import { describe, expect, it } from "vitest";
import * as plan from "./plan";

describe("catalog tick alignment POO-2181", () => {
  it("R10 refuses misaligned, missing endpoint and nonfinite ticks", () => {
    expect(plan).toHaveProperty("validateTickAlignment");
    for (const ticks of [
      { tickLower: -101, tickUpper: 100 },
      { tickLower: -100 },
      { tickLower: -Infinity, tickUpper: 100 },
      { tickLower: 100, tickUpper: 100 },
      { tickLower: -887280, tickUpper: 887270 },
    ]) {
      expect(() => plan.validateTickAlignment(ticks, 10)).toThrow("BUILD_TICK_ALIGNMENT");
    }
  });
  it("R10 accepts finite aligned full-range extremes and legacy price ranges", () => {
    expect(plan).toHaveProperty("validateTickAlignment");
    expect(() =>
      plan.validateTickAlignment({ tickLower: -887270, tickUpper: 887270 }, 10),
    ).not.toThrow();
    expect(() => plan.validateTickAlignment({}, 10)).not.toThrow();
    expect(() => plan.validateTickAlignment({ tickLower: -100, tickUpper: 100 }, 0)).toThrow(
      "BUILD_TICK_ALIGNMENT",
    );
  });
  it("requires Full to carry the exact finite aligned extremes", () => {
    expect(() =>
      plan.validateTickAlignment({ tickLower: -887270, tickUpper: 887270, fullRange: true }, 10),
    ).not.toThrow();
    expect(() =>
      plan.validateTickAlignment({ tickLower: -100, tickUpper: 100, fullRange: true }, 10),
    ).toThrow("BUILD_TICK_ALIGNMENT");
    expect(() => plan.validateTickAlignment({ fullRange: true }, 10)).toThrow(
      "BUILD_TICK_ALIGNMENT",
    );
  });
});
