/**
 * @id PP-PROF-SCR-002
 * @name Personal information - tests
 * @implements-rules-version v1
 * POO-699: per-field input validation + the "Handle" label. Every field is optional with the same
 * semantics (empty clears; non-empty enforces the bounds), mirroring how Email already behaved:
 * R1 Name 5-60 (below-min errors + blocks Save, above-max is capped); R2 Handle (renamed from
 * "Display name") 5-25, same error/cap; R3 Email 6-200 AND contains @; R4 Phone optional, else a valid
 * country-code number persisted as canonical E.164; R6 Save is blocked whenever ANY field is
 * non-empty-and-invalid, and an all-empty form still saves (clears every field).
 * Earlier behavior kept: R4 (POO-356) persists via the injected action; POO-693 private Name + public
 * Handle; POO-580 avatar upload + staging; POO-586 image-limit guard.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { GuardedLink } from "@/components/layout/GuardedLink";
import { UnsavedChangesProvider } from "@/lib/hooks/unsavedChanges";
import { mockProfileUser } from "@/mocks/data/profile";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../tests/utils/renderWithProviders";
import { PersonalInfoScreen } from "./PersonalInfoScreen";

// Canonical E.164 of the mock seed phone ("+55 11 90000-0000"); the save now normalizes it.
const SEED_PHONE_E164 = "+5511900000000";
// A real US number entered as its NATIONAL part (POO-730 R1: the dial code lives in the selector, not
// the input), plus its canonical E.164. Pick the country in the selector, then type the national digits.
const VALID_PHONE_NATIONAL = "2133734253";
const VALID_PHONE_E164 = "+12133734253";

// The default onSave is a "use server" action; tests inject their own and never load it.
vi.mock("./actions", () => ({ updateProfileAction: vi.fn(async () => {}) }));

// SettingsLayout renders Link + usePathname from the i18n nav; mock it so the test doesn't load
// next-intl's real navigation (which imports next/navigation, unresolved in vitest).
vi.mock("@/i18n/navigation", () => ({
  // POO-751: SettingsLayout's back-link is now a GuardedLink, which reads useRouter().
  useRouter: () => ({ push: vi.fn() }),
  Link: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  usePathname: () => "/profile/personal",
}));

function renderScreen(onSave = vi.fn(async () => {})) {
  renderWithProviders(<PersonalInfoScreen user={mockProfileUser} onSave={onSave} />);
  return { onSave };
}

describe("PersonalInfoScreen", () => {
  // @rule R2: the Email field is editable (not read-only).
  it("renders the Email field as editable, not read-only", () => {
    renderWithProviders(<PersonalInfoScreen user={mockProfileUser} />);
    expect(screen.getByRole("textbox", { name: "Email (optional)" })).not.toHaveAttribute(
      "readonly",
    );
  });

  // @rule R2: the Email helper text renders.
  it("renders the Email helper text", () => {
    renderWithProviders(<PersonalInfoScreen user={mockProfileUser} />);
    expect(screen.getByText("Optional. Used for account notices.")).toBeInTheDocument();
  });

  // @rule R2: the verified badge shows when the email is verified.
  it("shows the verified badge when the email is verified", () => {
    renderWithProviders(<PersonalInfoScreen user={{ ...mockProfileUser, emailVerified: true }} />);
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });

  // @rule R2: the verified badge is hidden when the email is not verified.
  it("hides the verified badge when the email is not verified", () => {
    renderWithProviders(<PersonalInfoScreen user={{ ...mockProfileUser, emailVerified: false }} />);
    expect(screen.queryByText("Verified")).toBeNull();
  });

  // @rule R1: the Name field is editable and optional (no read-only, no required marker).
  it("renders the Name field as editable and optional", () => {
    renderWithProviders(<PersonalInfoScreen user={mockProfileUser} />);
    const name = screen.getByRole("textbox", { name: "Name (optional)" });
    expect(name).not.toHaveAttribute("readonly");
    expect(name).not.toBeRequired();
  });

  // @rule R5: the public field's label is "Handle (optional)" (renamed from "Display name"), while the
  // private Name keeps its label; both seed from the user with their own public/private helper copy.
  it("renders the private Name and the public Handle inputs seeded from the user (R5)", () => {
    renderWithProviders(
      <PersonalInfoScreen
        user={{ ...mockProfileUser, name: "Maria Priv", displayName: "Maria Pub" }}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Name (optional)" })).toHaveValue("Maria Priv");
    expect(screen.getByRole("textbox", { name: "Handle (optional)" })).toHaveValue("Maria Pub");
    expect(
      screen.getByText("Not shown publicly. Used only for communication. Optional."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Your public handle, shown on your profile. Optional."),
    ).toBeInTheDocument();
  });

  // @rule R5: the code/state/API variable stays `displayName` — editing the Handle input sends the
  // PUBLIC value under the unchanged `displayName` key alongside the private `name`.
  it("sends the private name and the Handle value under the unchanged displayName key (R5)", async () => {
    const { onSave } = renderScreen();
    fireEvent.change(screen.getByLabelText("Name (optional)"), { target: { value: "Priv Name" } });
    fireEvent.change(screen.getByLabelText("Handle (optional)"), {
      target: { value: "Pub Name" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Priv Name", displayName: "Pub Name" }),
      ),
    );
  });

  it("shows an inline error and blocks Save for an invalid email (R3)", () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText("Email (optional)"), {
      target: { value: "not-an-email" },
    });
    expect(screen.getByText("Enter a valid email.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  // @rule R3: an @ is required — a 6-char value without @ still fails.
  it("blocks Save when Email has no @ even at 6+ chars (R3)", () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText("Email (optional)"), { target: { value: "abcdef" } });
    expect(screen.getByText("Enter a valid email.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  // @rule R3: the 6-char lower bound bites even for an @-shaped value ("a@b.c" is 5 chars).
  it("blocks Save when Email is shorter than 6 chars (R3)", () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText("Email (optional)"), { target: { value: "a@b.c" } });
    expect(screen.getByText("Enter a valid email.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  // @rule R3: the Email input caps length at 200 via maxLength.
  it("caps the Email input at 200 characters via maxLength (R3)", () => {
    renderScreen();
    expect(screen.getByLabelText("Email (optional)")).toHaveAttribute("maxlength", "200");
  });

  it("allows an empty email with no error (optional, R3/R6)", () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText("Email (optional)"), { target: { value: "" } });
    expect(screen.queryByText("Enter a valid email.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  // @rule R1: a non-empty Name below the 5-char minimum shows an inline error and blocks Save.
  it("shows an inline error and blocks Save when Name is below 5 chars (R1)", () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText("Name (optional)"), { target: { value: "abc" } });
    expect(screen.getByText("Name must be at least 5 characters.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  // @rule R1: the Name input caps length at 60 via maxLength, and the save sanitizes to <= 60.
  it("caps the Name input at 60 characters (R1)", async () => {
    const { onSave } = renderScreen();
    const name = screen.getByLabelText("Name (optional)");
    expect(name).toHaveAttribute("maxlength", "60");
    fireEvent.change(name, { target: { value: "a".repeat(70) } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: "a".repeat(60) })),
    );
  });

  // @rule R2: a non-empty Handle below the 5-char minimum shows an inline error and blocks Save.
  it("shows an inline error and blocks Save when Handle is below 5 chars (R2)", () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText("Handle (optional)"), { target: { value: "ab" } });
    expect(screen.getByText("Handle must be at least 5 characters.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  // @rule R2: the Handle input caps length at 25 via maxLength, and the save sanitizes to <= 25.
  it("caps the Handle input at 25 characters (R2)", async () => {
    const { onSave } = renderScreen();
    const handle = screen.getByLabelText("Handle (optional)");
    expect(handle).toHaveAttribute("maxlength", "25");
    fireEvent.change(handle, { target: { value: "b".repeat(40) } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ displayName: "b".repeat(25) })),
    );
  });

  // @rule POO-730 R4: an invalid phone blocks Save immediately, but the error is blur-gated — hidden
  // while typing, shown only after the field loses focus.
  it("blocks Save immediately and shows the invalid-phone error on blur (R4)", () => {
    renderScreen();
    const input = screen.getByLabelText("Phone (optional)");
    // Seed is a BR number; overwrite with an incomplete number.
    fireEvent.change(input, { target: { value: "555" } });
    // Error stays hidden while the user is still typing, but Save is already gated on validity.
    expect(screen.queryByText("Enter a valid phone number.")).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    // Leaving the field surfaces the error.
    fireEvent.blur(input);
    expect(screen.getByText("Enter a valid phone number.")).toBeInTheDocument();
  });

  // @rule R4: a valid phone is persisted as canonical E.164 (country in the selector, national typed).
  it("persists a valid phone as canonical E.164 (R4)", async () => {
    const { onSave } = renderScreen();
    fireEvent.change(screen.getByLabelText("Phone country code"), { target: { value: "us" } });
    fireEvent.change(screen.getByLabelText("Phone (optional)"), {
      target: { value: VALID_PHONE_NATIONAL },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ phone: VALID_PHONE_E164 })),
    );
  });

  // @rule POO-730 R1: the dial code lives ONLY in the selector — it is never inside the number input.
  it("keeps the dial code out of the number input (R1)", () => {
    renderScreen();
    const input = screen.getByLabelText("Phone (optional)") as HTMLInputElement;
    // Seed is a BR (+55) number; the input shows the national part only, no "+55".
    expect(input.value.startsWith("+")).toBe(false);
    expect(input.value).not.toContain("+55");
  });

  // @rule R4/R6: emptying the phone clears the field (persists "").
  it("clears the phone when emptied (R4/R6)", async () => {
    const { onSave } = renderScreen();
    fireEvent.change(screen.getByLabelText("Phone (optional)"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ phone: "" })),
    );
  });

  // @rule R6: an all-empty form still saves, clearing every field.
  it("saves an all-empty form and clears every field (R6)", async () => {
    const { onSave } = renderScreen();
    fireEvent.change(screen.getByLabelText("Name (optional)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Handle (optional)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Email (optional)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Phone (optional)"), { target: { value: "" } });
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ name: "", displayName: "", email: "", phone: "" }),
      ),
    );
  });

  it("persists Name + Email + Country + Phone via the service and confirms saved (R4 / POO-410 / POO-675)", async () => {
    const { onSave } = renderScreen();
    fireEvent.change(screen.getByLabelText("Name (optional)"), { target: { value: "Maria R." } });
    fireEvent.change(screen.getByLabelText("Email (optional)"), {
      target: { value: "maria.r@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    // Handle + Country come along unchanged (seeded from the user); the untouched phone persists as E.164.
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        name: "Maria R.",
        displayName: mockProfileUser.displayName,
        email: "maria.r@example.com",
        country: "Brazil",
        phone: SEED_PHONE_E164,
      }),
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  // @rule R4: phone is validated + canonicalized to E.164 before it is included in the save patch.
  it("includes an edited phone as canonical E.164 in the save patch (R4)", async () => {
    const { onSave } = renderScreen();
    fireEvent.change(screen.getByLabelText("Phone country code"), { target: { value: "us" } });
    fireEvent.change(screen.getByLabelText("Phone (optional)"), {
      target: { value: VALID_PHONE_NATIONAL },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ phone: VALID_PHONE_E164, name: mockProfileUser.name }),
      ),
    );
  });

  // @rule POO-675: the dead Username input was removed (no backend column); the others stay optional.
  it("marks name, email and phone as optional and drops the username input", () => {
    renderWithProviders(<PersonalInfoScreen user={mockProfileUser} />);
    expect(screen.getByRole("textbox", { name: "Name (optional)" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Email (optional)" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Phone (optional)" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Username (optional)" })).toBeNull();
  });

  // @rule POO-580: a persisted avatar URL renders as the avatar image (so it shows after a reload).
  it("renders a persisted avatar image from user.avatar", () => {
    const url = "https://cdn.pool-party.xyz/avatars/0xw.png?v=1";
    renderWithProviders(<PersonalInfoScreen user={{ ...mockProfileUser, avatar: url }} />);
    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(url);
  });

  // @rule POO-707 [R4/R5]: cropping STAGES the blob (no upload); Save uploads it then runs the single
  // PATCH with the trusted CDN URL — one signature for image + text.
  it("stages the cropped avatar and uploads it only on Save, then patches its URL", async () => {
    const realCreate = URL.createObjectURL;
    const realFetch = global.fetch;
    URL.createObjectURL = () => "blob:mock";
    // The screen turns the crop data URL into a Blob via fetch(); stub it to a PNG blob in jsdom.
    global.fetch = vi.fn(async () => ({
      blob: async () => new Blob(["x"], { type: "image/png" }),
    })) as unknown as typeof fetch;
    const publicUrl = "https://cdn.pool-party.xyz/avatars/0xw.png?v=2";
    const onUploadAvatar = vi.fn(async () => publicUrl);
    const onSave = vi.fn(async () => {});
    try {
      renderWithProviders(
        <PersonalInfoScreen
          user={mockProfileUser}
          onSave={onSave}
          onUploadAvatar={onUploadAvatar}
        />,
      );
      fireEvent.change(screen.getByLabelText("Change photo", { selector: "input" }), {
        target: { files: [new File(["x"], "avatar.png", { type: "image/png" })] },
      });
      // POO-707 [R4]: Apply STAGES the crop locally — no upload, no signature yet. Staging awaits
      // fetch(dataUrl).blob(), so Save flips to enabled asynchronously once the blob is staged.
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
      expect(onUploadAvatar).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());

      // POO-707 [R5]: Save uploads the staged blob (once) THEN runs the single PATCH with the CDN URL.
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(onUploadAvatar).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(onSave).toHaveBeenCalledWith({
          name: mockProfileUser.name,
          displayName: mockProfileUser.displayName,
          email: mockProfileUser.email,
          country: mockProfileUser.country,
          phone: SEED_PHONE_E164,
          avatarUrl: publicUrl,
        }),
      );
      // The uploaded CDN URL becomes the rendered avatar after the save resolves.
      await waitFor(() =>
        expect(document.querySelector("img")?.getAttribute("src")).toBe(publicUrl),
      );
    } finally {
      URL.createObjectURL = realCreate;
      global.fetch = realFetch;
    }
  });

  // @rule POO-707 [R6]: a deferred upload that fails on Save keeps the staged preview, surfaces the
  // error, and NEVER runs the PATCH — no broken URL, no partial (text-only) persist.
  it("keeps the staged preview and shows an error without patching when the upload fails on Save", async () => {
    const realCreate = URL.createObjectURL;
    const realFetch = global.fetch;
    URL.createObjectURL = () => "blob:mock";
    global.fetch = vi.fn(async () => ({
      blob: async () => new Blob(["x"], { type: "image/png" }),
    })) as unknown as typeof fetch;
    const onUploadAvatar = vi.fn(async () => {
      throw new Error("503 MEDIA_NOT_CONFIGURED");
    });
    const onSave = vi.fn(async () => {});
    try {
      renderWithProviders(
        <PersonalInfoScreen
          user={mockProfileUser}
          onSave={onSave}
          onUploadAvatar={onUploadAvatar}
        />,
      );
      fireEvent.change(screen.getByLabelText("Change photo", { selector: "input" }), {
        target: { files: [new File(["x"], "avatar.png", { type: "image/png" })] },
      });
      // [R4]: Apply only stages — no upload, so no error yet.
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
      expect(screen.queryByText("Couldn't upload your photo. Try again.")).toBeNull();
      expect(onUploadAvatar).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
      // [R5/R6]: Save triggers the deferred upload, which fails and surfaces the error.
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByText("Couldn't upload your photo. Try again.")).toBeInTheDocument();
      // The staged crop preview is kept (an <img> is shown, not the initial fallback).
      expect(document.querySelector("img")).not.toBeNull();
      // A failed upload never persists — the single PATCH is not called at all.
      expect(onSave).not.toHaveBeenCalled();
    } finally {
      URL.createObjectURL = realCreate;
      global.fetch = realFetch;
    }
  });

  // POO-702 Secondary #1 (observability): a failing save must be VISIBLE + diagnosable, not swallowed.
  describe("[POO-702] save + upload failure observability", () => {
    // @rule R1: a rejected onSave surfaces the inline save-failed error and does NOT show "Saved".
    it("surfaces a visible error when the save fails (R1)", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const onSave = vi.fn(async () => {
        throw new Error("PATCH /users/me failed");
      });
      try {
        renderWithProviders(<PersonalInfoScreen user={mockProfileUser} onSave={onSave} />);
        // POO-707 [R3]: Save is dirty-gated, so make a real change first to enable it.
        fireEvent.change(screen.getByLabelText("Name (optional)"), {
          target: { value: "Maria Updated" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        expect(
          await screen.findByText("Couldn't save your changes. Try again."),
        ).toBeInTheDocument();
        // The success indicator is never shown for a failed save.
        expect(screen.queryByText("Saved")).toBeNull();
      } finally {
        errorSpy.mockRestore();
      }
    });

    // @rule R1: the caught save error is structured-logged (not discarded) under the PP-PROFILE-SAVE prefix.
    it("structured-logs the save failure under PP-PROFILE-SAVE (R1)", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const onSave = vi.fn(async () => {
        throw new Error("PATCH /users/me failed");
      });
      try {
        renderWithProviders(<PersonalInfoScreen user={mockProfileUser} onSave={onSave} />);
        // POO-707 [R3]: Save is dirty-gated, so make a real change first to enable it.
        fireEvent.change(screen.getByLabelText("Name (optional)"), {
          target: { value: "Maria Updated" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() =>
          expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining("PP-PROFILE-SAVE"),
            expect.objectContaining({
              surface: "investor",
              action: "save",
              message: "PATCH /users/me failed",
            }),
          ),
        );
      } finally {
        errorSpy.mockRestore();
      }
    });

    // @rule R4: the avatar-upload catch keeps its UI flag AND logs the error (no longer discarded).
    it("structured-logs an avatar-upload failure under PP-MEDIA-UPLOAD (R4)", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const realCreate = URL.createObjectURL;
      const realFetch = global.fetch;
      URL.createObjectURL = () => "blob:mock";
      global.fetch = vi.fn(async () => ({
        blob: async () => new Blob(["x"], { type: "image/png" }),
      })) as unknown as typeof fetch;
      const onUploadAvatar = vi.fn(async () => {
        throw new Error("503 MEDIA_NOT_CONFIGURED");
      });
      try {
        renderWithProviders(
          <PersonalInfoScreen user={mockProfileUser} onUploadAvatar={onUploadAvatar} />,
        );
        fireEvent.change(screen.getByLabelText("Change photo", { selector: "input" }), {
          target: { files: [new File(["x"], "avatar.png", { type: "image/png" })] },
        });
        // POO-707 [R4/R5]: Apply stages; the upload runs on Save, where it fails.
        fireEvent.click(screen.getByRole("button", { name: "Apply" }));
        await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        // The UI flag shows...
        expect(
          await screen.findByText("Couldn't upload your photo. Try again."),
        ).toBeInTheDocument();
        // ...and the caught error is now logged instead of swallowed.
        await waitFor(() =>
          expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining("PP-MEDIA-UPLOAD"),
            expect.objectContaining({
              surface: "investor",
              asset: "avatar",
              message: "503 MEDIA_NOT_CONFIGURED",
            }),
          ),
        );
      } finally {
        URL.createObjectURL = realCreate;
        global.fetch = realFetch;
        errorSpy.mockRestore();
      }
    });
  });

  // Picking a photo opens the ROUND cropper (same behavior as the manager profile + builder logo).
  it("opens a round photo cropper when a file is picked", () => {
    const realCreate = URL.createObjectURL;
    // jsdom doesn't implement createObjectURL; stub it so the picked-file → crop path runs.
    URL.createObjectURL = () => "blob:mock";
    try {
      renderWithProviders(<PersonalInfoScreen user={mockProfileUser} />);
      fireEvent.change(screen.getByLabelText("Change photo", { selector: "input" }), {
        target: { files: [new File(["x"], "avatar.png", { type: "image/png" })] },
      });
      const viewport = screen.getByTestId("crop-viewport");
      expect(viewport).toBeInTheDocument();
      expect(viewport.className).toContain("rounded-full");
    } finally {
      URL.createObjectURL = realCreate;
    }
  });

  // POO-586: image upload limit (10 MB, PNG/JPG only) on the avatar pick handler.
  describe("[POO-586] image upload limit", () => {
    /** A File whose reported size is `bytes` without allocating that much (jsdom reads File.size). */
    function fileOfSize(bytes: number, type: string, name = "x"): File {
      const file = new File(["x"], name, { type });
      Object.defineProperty(file, "size", { value: bytes, configurable: true });
      return file;
    }

    // @rule POO-586 R1: the avatar input advertises PNG/JPG only via the accept attribute.
    it("sets accept=image/png,image/jpeg on the avatar input", () => {
      renderWithProviders(<PersonalInfoScreen user={mockProfileUser} />);
      expect(screen.getByLabelText("Change photo", { selector: "input" })).toHaveAttribute(
        "accept",
        "image/png,image/jpeg",
      );
    });

    // @rule POO-586 R2/R3: a >10 MB file does not open the crop, shows the error, and resets the input.
    it("rejects an oversized file: no crop, shows the error, resets the input", () => {
      const createObjectURL = vi.fn(() => "blob:mock");
      const realCreate = URL.createObjectURL;
      URL.createObjectURL = createObjectURL;
      try {
        renderWithProviders(<PersonalInfoScreen user={mockProfileUser} />);
        const input = screen.getByLabelText("Change photo", {
          selector: "input",
        }) as HTMLInputElement;
        fireEvent.change(input, {
          target: { files: [fileOfSize(11 * 1024 * 1024, "image/png", "big.png")] },
        });
        expect(createObjectURL).not.toHaveBeenCalled();
        expect(screen.queryByTestId("crop-viewport")).not.toBeInTheDocument();
        expect(screen.getByText("Use a PNG or JPG under 10 MB.")).toBeInTheDocument();
        expect(input.value).toBe("");
      } finally {
        URL.createObjectURL = realCreate;
      }
    });

    // @rule POO-586 R1/R3: a wrong-type file (SVG) does not open the crop and shows the error.
    it("rejects a wrong-type file: no crop, shows the error", () => {
      const createObjectURL = vi.fn(() => "blob:mock");
      const realCreate = URL.createObjectURL;
      URL.createObjectURL = createObjectURL;
      try {
        renderWithProviders(<PersonalInfoScreen user={mockProfileUser} />);
        fireEvent.change(screen.getByLabelText("Change photo", { selector: "input" }), {
          target: { files: [fileOfSize(1024, "image/svg+xml", "a.svg")] },
        });
        expect(createObjectURL).not.toHaveBeenCalled();
        expect(screen.queryByTestId("crop-viewport")).not.toBeInTheDocument();
        expect(screen.getByText("Use a PNG or JPG under 10 MB.")).toBeInTheDocument();
      } finally {
        URL.createObjectURL = realCreate;
      }
    });

    // @rule POO-586 R1/R2: a valid JPEG under the limit opens the crop (no error).
    it("accepts a valid JPEG: opens the crop, no error", () => {
      const realCreate = URL.createObjectURL;
      URL.createObjectURL = () => "blob:mock";
      try {
        renderWithProviders(<PersonalInfoScreen user={mockProfileUser} />);
        fireEvent.change(screen.getByLabelText("Change photo", { selector: "input" }), {
          target: { files: [fileOfSize(3 * 1024 * 1024, "image/jpeg", "ok.jpg")] },
        });
        expect(screen.getByTestId("crop-viewport")).toBeInTheDocument();
        expect(screen.queryByText("Use a PNG or JPG under 10 MB.")).not.toBeInTheDocument();
      } finally {
        URL.createObjectURL = realCreate;
      }
    });
  });

  // POO-707 [R3]: Save is dirty-tracked — disabled unless a field changed or an image is staged, AND
  // the form is valid. An all-unchanged form gets no no-op save.
  describe("[POO-707] dirty-tracked Save", () => {
    it("disables Save when nothing has changed", () => {
      renderWithProviders(<PersonalInfoScreen user={mockProfileUser} />);
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });

    it("enables Save when a text field changes", () => {
      renderWithProviders(<PersonalInfoScreen user={mockProfileUser} />);
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      fireEvent.change(screen.getByLabelText("Name (optional)"), {
        target: { value: "Maria Updated" },
      });
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    });

    it("re-disables Save when the changed field is reverted to its seed", () => {
      renderWithProviders(<PersonalInfoScreen user={mockProfileUser} />);
      const email = screen.getByLabelText("Email (optional)");
      fireEvent.change(email, { target: { value: "new@email.com" } });
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
      fireEvent.change(email, { target: { value: mockProfileUser.email } });
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });

    it("enables Save when a cropped image is staged (no text change)", async () => {
      const realCreate = URL.createObjectURL;
      const realFetch = global.fetch;
      URL.createObjectURL = () => "blob:mock";
      global.fetch = vi.fn(async () => ({
        blob: async () => new Blob(["x"], { type: "image/png" }),
      })) as unknown as typeof fetch;
      const onUploadAvatar = vi.fn(async () => "https://cdn.pool-party.xyz/a.png");
      try {
        renderWithProviders(
          <PersonalInfoScreen user={mockProfileUser} onUploadAvatar={onUploadAvatar} />,
        );
        expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
        fireEvent.change(screen.getByLabelText("Change photo", { selector: "input" }), {
          target: { files: [new File(["x"], "avatar.png", { type: "image/png" })] },
        });
        // Staging awaits fetch(dataUrl).blob(), so Save flips to enabled asynchronously.
        fireEvent.click(screen.getByRole("button", { name: "Apply" }));
        await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
        // The upload is deferred to Save (not on crop).
        expect(onUploadAvatar).not.toHaveBeenCalled();
      } finally {
        URL.createObjectURL = realCreate;
        global.fetch = realFetch;
      }
    });
  });

  // POO-751 [R3]/[R5]: PersonalInfoScreen registers its dirty flag via useUnsavedChanges, so a
  // GuardedLink in the same provider tree must open the confirm modal once a field is edited, and
  // navigate straight through while the form is still pristine.
  describe("[POO-751] unsaved-changes guard", () => {
    function renderGuarded(onSave = vi.fn(async () => {})) {
      renderWithProviders(
        <UnsavedChangesProvider>
          <PersonalInfoScreen user={mockProfileUser} onSave={onSave} />
          <GuardedLink href="/portfolio">Leave profile</GuardedLink>
        </UnsavedChangesProvider>,
      );
    }

    it("[R5] navigates a guarded link straight through while the form is clean", () => {
      renderGuarded();
      fireEvent.click(screen.getByRole("link", { name: "Leave profile" }));
      expect(screen.queryByText("Unsaved changes")).toBeNull();
    });

    it("[R3]/[R5] opens the confirm modal when a guarded link is clicked with a dirty field", () => {
      renderGuarded();
      fireEvent.change(screen.getByLabelText("Name (optional)"), {
        target: { value: "Maria Updated" },
      });
      fireEvent.click(screen.getByRole("link", { name: "Leave profile" }));
      expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    });
  });
});
