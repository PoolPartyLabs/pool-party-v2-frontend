/**
 * @id PP-PROF-SCR-002 (POO-233, POO-426)
 * @name Personal-info data loader test
 * @implements-rules-version v1
 *
 * The real-mode boundary injects the signed-write save (`useUpdateProfile`) and the signed-write avatar
 * upload (`useUploadAvatar`, POO-580) into the untouched presentational `PersonalInfoScreen` as its
 * `onSave` / `onUploadAvatar`, and passes the server-read user straight through. Pins that wiring
 * contract so neither injected function can silently detach from the screen.
 */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProfileUser } from "@/lib/schemas";

const save = vi.fn();
vi.mock("./hooks/useUpdateProfile", () => ({ useUpdateProfile: () => save }));

const uploadAvatar = vi.fn();
vi.mock("./hooks/useUploadAvatar", () => ({ useUploadAvatar: () => uploadAvatar }));

const screenProps = vi.fn();
vi.mock("./PersonalInfoScreen", () => ({
  PersonalInfoScreen: (props: unknown) => {
    screenProps(props);
    return null;
  },
}));

import { PersonalInfoDataLoader } from "./PersonalInfoDataLoader";

const user = { name: "Ana", initial: "A" } as ProfileUser;

describe("PersonalInfoDataLoader", () => {
  it("renders PersonalInfoScreen with the injected save + avatar upload and the passed-through user", () => {
    render(<PersonalInfoDataLoader user={user} />);
    expect(screenProps).toHaveBeenCalledWith({ user, onSave: save, onUploadAvatar: uploadAvatar });
  });
});
