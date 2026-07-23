/**
 * @id PP-ADM-MCK-002
 * @name moderation service — tests
 * Behavior (POO-590): the queue lists only pending images; approve marks approved and leaves the
 * queue; remove soft-hides with an optional reason and leaves the queue; a non-pending image cannot
 * be approved or removed.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { moderationService, resetMockModerationState } from "./index";

beforeEach(() => {
  resetMockModerationState();
});

describe("moderationService (mock)", () => {
  it("lists only pending images", async () => {
    const queue = await moderationService.listQueue();
    expect(queue.length).toBeGreaterThan(0);
    expect(queue.every((image) => image.status === "pending")).toBe(true);
  });

  it("approve marks the image approved and drops it from the queue", async () => {
    const decided = await moderationService.approve("mod-avatar-apex", "admin@pool-party.xyz");
    expect(decided.status).toBe("approved");
    expect(decided.reviewedBy).toBe("admin@pool-party.xyz");
    expect(decided.reviewedAt).toBeTypeOf("string");
    const queue = await moderationService.listQueue();
    expect(queue.some((image) => image.id === "mod-avatar-apex")).toBe(false);
  });

  it("remove soft-hides with a reason and drops it from the queue", async () => {
    const decided = await moderationService.remove(
      "mod-banner-sofia",
      "admin@pool-party.xyz",
      "Off-brand banner",
    );
    expect(decided.status).toBe("removed");
    expect(decided.removedReason).toBe("Off-brand banner");
    const queue = await moderationService.listQueue();
    expect(queue.some((image) => image.id === "mod-banner-sofia")).toBe(false);
  });

  it("cannot approve or remove an image that is not pending", async () => {
    await moderationService.approve("mod-strategy-ethusdc", "admin@pool-party.xyz");
    await expect(
      moderationService.approve("mod-strategy-ethusdc", "admin@pool-party.xyz"),
    ).rejects.toThrow();
    await expect(
      moderationService.remove("mod-strategy-ethusdc", "admin@pool-party.xyz"),
    ).rejects.toThrow();
  });
});
