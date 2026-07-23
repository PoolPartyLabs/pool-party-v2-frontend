import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("joins truthy class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, undefined, null, "b")).toBe("a b");
  });

  it("de-conflicts conflicting Tailwind utilities (last one wins)", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-sm text-foreground", "text-lg")).toBe("text-foreground text-lg");
  });
});
