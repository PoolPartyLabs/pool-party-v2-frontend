/**
 * @id PP-STR (POO-453)
 * @name revalidatePositionsAction tests
 * @implements-rules-version v1
 *
 * [R2] After a write, invalidates ONLY the signed-in wallet's positions tag; a no-wallet call is a
 * no-op (never busts another wallet's cache).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  wallet: null as string | null,
}));

vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock("@/lib/auth/session", () => ({ getSessionWallet: async () => mocks.wallet }));

import { positionsTag } from "./fetchPositions";
import { revalidatePositionsAction } from "./revalidatePositions";

describe("revalidatePositionsAction", () => {
  beforeEach(() => {
    mocks.revalidateTag.mockReset();
    mocks.wallet = null;
  });

  it("[R2] invalidates the signed-in wallet's positions tag", async () => {
    mocks.wallet = "0xWALLET";
    await revalidatePositionsAction();
    expect(mocks.revalidateTag).toHaveBeenCalledWith(positionsTag("0xWALLET"));
    expect(mocks.revalidateTag).toHaveBeenCalledTimes(1);
  });

  it("[R2] is a no-op when not signed in", async () => {
    await revalidatePositionsAction();
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });
});
