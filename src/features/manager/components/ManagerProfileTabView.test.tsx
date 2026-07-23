/**
 * @id PP-MGR-SCR-006
 * @name ManagerProfileTabView — tests
 * Behavior: renders the editable fields prefilled, saves through managerService.updateProfile and
 * confirms; the handle stays read-only.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GuardedLink } from "@/components/layout/GuardedLink";
import { UnsavedChangesProvider } from "@/lib/hooks/unsavedChanges";
import { DEV_MANAGER_ADDRESS, managerProfiles } from "@/mocks/data/manager";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import { ManagerProfileTabView } from "./ManagerProfileTabView";

const { updateProfile, isHandleAvailable, requestVerification } = vi.hoisted(() => ({
  updateProfile: vi.fn(async (_handle: string, input: Record<string, unknown>) => ({
    ...managerProfiles[0],
    ...input,
    handleLocked: true,
  })),
  // Default: every handle is free. Individual tests override to simulate a collision.
  isHandleAvailable: vi.fn(async (_handle: string, _self?: string) => true),
  // POO-745: the code-DM request lives on `managerService.requestVerification` (the mock path the
  // useRequestManagerVerification hook delegates to). Returns a pending status + a one-time code.
  requestVerification: vi.fn(async (_id: string) => ({
    status: "pending" as const,
    code: "K7QF2M9X",
    message: "DM this code: K7QF2M9X",
  })),
}));

vi.mock("@/lib/services", () => ({
  // isMockMode true so `useManagerProfileWrite` / `useRequestManagerVerification` take their mock
  // branches (delegating to this managerService) instead of the real signed-write path (POO-579/POO-745).
  isMockMode: true,
  managerService: { updateProfile, isHandleAvailable, requestVerification },
}));

vi.mock("@/i18n/navigation", () => ({
  // POO-751: the guard test renders a GuardedLink, which reads useRouter().
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
}));

// POO-659: the dev-login manager is now the UNFILLED, address-based identity — found by its stable
// wallet address, not the retired "carlos" handle. name / handle / socials start empty; `address` is
// the manager's stable id every service call keys off (updateProfile / requestVerification /
// isHandleAvailable).
const MANAGER_ID = DEV_MANAGER_ADDRESS;

function unfilled() {
  const profile = managerProfiles.find((candidate) => candidate.address === DEV_MANAGER_ADDRESS);
  if (!profile) throw new Error("expected the unfilled dev-manager mock profile");
  // POO-575 R7: the dev-login manager is unlocked (editable) unless a test opts into the locked
  // state. The seed sets handleLocked:false; keep the object test-local so mutations never leak.
  return { ...profile, handleLocked: false as boolean };
}

/** POO-575: an established manager whose handle is already fixed (read-only). */
function lockedUnfilled() {
  return { ...unfilled(), handleLocked: true };
}

describe("ManagerProfileTabView", () => {
  beforeEach(() => {
    updateProfile.mockClear();
    isHandleAvailable.mockClear();
    isHandleAvailable.mockResolvedValue(true);
    requestVerification.mockClear();
    requestVerification.mockResolvedValue({
      status: "pending" as const,
      code: "K7QF2M9X",
      message: "DM this code: K7QF2M9X",
    });
  });

  // @rule POO-506 R1: the file inputs reset after handling so re-picking the SAME file fires
  // change again. jsdom cannot reproduce the browser's same-value suppression, so the contract
  // asserted here is: two consecutive picks of one file both reach the crop flow AND the input
  // value is cleared after each pick.
  it("resets the banner and photo file inputs after a pick (POO-506 R1)", () => {
    const createObjectURL = vi.fn(() => "blob:mock-crop-src");
    vi.stubGlobal("URL", Object.assign(Object.create(URL), { createObjectURL }));
    try {
      renderWithProviders(<ManagerProfileTabView profile={unfilled()} />);
      const file = new File(["img"], "same-photo.png", { type: "image/png" });
      for (const label of ["Change banner", "Change photo"]) {
        const input = screen.getByLabelText(label) as HTMLInputElement;
        fireEvent.change(input, { target: { files: [file] } });
        expect(input.value).toBe("");
        fireEvent.change(input, { target: { files: [file] } });
        expect(input.value).toBe("");
      }
      // Both picks of both inputs reached the crop flow.
      expect(createObjectURL).toHaveBeenCalledTimes(4);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // The photo circle and the banner area are themselves picker click targets: each is a <label>
  // whose htmlFor points at the matching hidden file input (builder-logo idiom), so a click on the
  // image opens the same picker as the visible button. Asserted structurally because jsdom cannot
  // open the OS file dialog.
  it("wires the photo circle as a label bound to the photo input", () => {
    renderWithProviders(<ManagerProfileTabView profile={unfilled()} />);
    expect(screen.getByLabelText("Change photo")).toHaveAttribute("id", "manager-avatar-input");
    const label = screen.getByTestId("avatar-upload");
    expect(label.tagName).toBe("LABEL");
    expect(label).toHaveAttribute("for", "manager-avatar-input");
  });

  it("wires the banner area as a label bound to the banner input", () => {
    renderWithProviders(<ManagerProfileTabView profile={unfilled()} />);
    expect(screen.getByLabelText("Change banner")).toHaveAttribute("id", "manager-banner-input");
    const label = screen.getByTestId("banner-upload");
    expect(label.tagName).toBe("LABEL");
    expect(label).toHaveAttribute("for", "manager-banner-input");
  });

  // POO-575 R1: a locked (established) manager keeps the read-only, disabled handle field. POO-659: the
  // dev manager is now the unfilled identity, so the persisted name / handle / socials are empty — the
  // fields render blank and the read-only handle field is still disabled.
  it("renders the prefilled fields with a read-only handle when locked", () => {
    renderWithProviders(<ManagerProfileTabView profile={lockedUnfilled()} />);
    expect(screen.getByLabelText(/Display name/)).toHaveValue("");
    expect(screen.getByLabelText(/Handle/)).toBeDisabled();
    // POO-659: the dev manager is the unfilled, address-based identity, so the persisted handle and
    // socials are empty. POO-657's prefixed X input still renders (handle-only), just with no value.
    expect(screen.getByLabelText(/Handle/)).toHaveValue("");
    expect(screen.getByLabelText("X")).toHaveValue("");
    expect(screen.getByRole("link", { name: /View public profile/ })).toHaveAttribute(
      "href",
      "/m/",
    );
  });

  it("saves the edits through managerService.updateProfile and confirms", async () => {
    renderWithProviders(<ManagerProfileTabView profile={unfilled()} />);
    fireEvent.change(screen.getByLabelText(/Display name/), {
      target: { value: "Carlos M. Mendes" },
    });
    // POO-659: the unfilled manager has no seeded socials, so type the X link the save should persist.
    fireEvent.change(screen.getByLabelText("X"), {
      target: { value: "https://x.com/carlosyield" },
    });
    fireEvent.change(screen.getByLabelText("YouTube"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.getByText("Profile saved")).toBeInTheDocument());
    // POO-659: keyed by the manager's stable id (the wallet address), not the retired "carlos" handle.
    expect(updateProfile).toHaveBeenCalledWith(
      MANAGER_ID,
      expect.objectContaining({
        name: "Carlos M. Mendes",
        socials: expect.objectContaining({ x: "https://x.com/carlosyield", youtube: undefined }),
      }),
    );
  });

  // PP-TODO(POO-748): Instagram, TikTok and LinkedIn are DISABLED "coming soon" placeholders: present +
  // locked, but NOT wired to persistence (the manager registry has no column for them yet, Instagram
  // POO-747, TikTok/LinkedIn POO-851). Guards they stay non-editable and never enter the saved socials
  // payload (no silent data loss). Remove a network from this test together with its placeholder when
  // its backend column ships and it becomes a real SOCIAL_NETWORKS entry.
  it("[POO-748/POO-851] shows Instagram, TikTok and LinkedIn as locked coming-soon fields, never persisted", async () => {
    renderWithProviders(<ManagerProfileTabView profile={unfilled()} />);
    for (const label of ["Instagram", "TikTok", "LinkedIn"]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    // One "Coming soon" pill per placeholder network.
    expect(screen.getAllByText("Coming soon")).toHaveLength(3);

    // A valid name lets Save proceed; the saved socials must carry none of the placeholder keys.
    fireEvent.change(screen.getByLabelText(/Display name/), { target: { value: "Delta Desk" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText("Profile saved")).toBeInTheDocument());
    const input = updateProfile.mock.lastCall?.[1] as { socials: Record<string, unknown> };
    expect(input.socials).not.toHaveProperty("instagram");
    expect(input.socials).not.toHaveProperty("tiktok");
    expect(input.socials).not.toHaveProperty("linkedin");
  });

  // POO-552 R1: the display name must be >= 3 chars — a shorter one disables Save and shows a hint.
  // POO-659: the unfilled manager starts with an empty (invalid) name, so type a valid one first to
  // reach the enabled baseline before shortening it.
  it("[POO-552 R1] gates Save on a display name of at least 3 characters", () => {
    renderWithProviders(<ManagerProfileTabView profile={unfilled()} />);
    const save = screen.getByRole("button", { name: "Save changes" });
    fireEvent.change(screen.getByLabelText(/Display name/), { target: { value: "Carlos" } });
    expect(save).toBeEnabled();
    fireEvent.change(screen.getByLabelText(/Display name/), { target: { value: "ab" } });
    expect(save).toBeDisabled();
    expect(screen.getByText(/at least 3 characters/i)).toBeInTheDocument();
  });

  // POO-552 R4/R5 / POO-657: an unsafe/invalid link is flagged + dropped on save ONLY on the Website
  // field (the one full-URL input). Handle-based networks are prefix + handle, so a user can never
  // enter an unsafe scheme there and they never error. POO-659: the unfilled manager starts blank, so
  // seed a valid name + a handle-based X sibling to prove the "valid link retained" half of the rule.
  it("[POO-552 R4/R5] flags an unsafe Website link and drops it on save", async () => {
    const profile = {
      ...unfilled(),
      name: "Delta Desk",
      socials: { x: "https://x.com/deltadesk" },
    };
    renderWithProviders(<ManagerProfileTabView profile={profile} />);
    fireEvent.change(screen.getByLabelText("Website"), {
      target: { value: "javascript:alert(1)" },
    });
    expect(screen.getByText(/valid Website link/i)).toBeInTheDocument();
    // The name is still valid, so Save proceeds and drops the bad Website link.
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText("Profile saved")).toBeInTheDocument());
    const input = updateProfile.mock.lastCall?.[1] as { socials: Record<string, unknown> };
    expect(input.socials.website).toBeUndefined();
    // A valid handle-based sibling (X) is retained.
    expect(String(input.socials.x)).toMatch(/^https:\/\//);
  });

  // POO-648: the Website field keeps the per-network error (names Website + shows its example).
  it("[POO-648] flags an invalid Website URL with a per-network error", () => {
    renderWithProviders(<ManagerProfileTabView profile={unfilled()} />);
    fireEvent.change(screen.getByLabelText("Website"), { target: { value: "notaurl" } });
    expect(screen.getByText(/valid Website link/i)).toBeInTheDocument();
    expect(screen.getByText(/yourdomain\.xyz/)).toBeInTheDocument();
    expect(screen.getByLabelText("Website")).toHaveAttribute("aria-invalid", "true");
  });

  // POO-657: handle-based networks render a fixed domain prefix + a handle-only input and never error.
  // POO-659: seed a neutral X handle so the prefixed input shows a value (the persona is retired).
  it("[POO-657] shows a prefixed handle input with no error for handle-based networks", () => {
    const profile = { ...unfilled(), socials: { x: "https://x.com/deltadesk" } };
    renderWithProviders(<ManagerProfileTabView profile={profile} />);
    // The X input shows only the handle (prefix stripped) beside the fixed "x.com/" prefix.
    expect(screen.getByLabelText("X")).toHaveValue("deltadesk");
    expect(screen.getByText("x.com/")).toBeInTheDocument();
    // A bare/odd handle never surfaces an error for a prefixed network.
    fireEvent.change(screen.getByLabelText("X"), { target: { value: "anything" } });
    expect(screen.queryByText(/valid X link/i)).toBeNull();
  });

  // POO-657: pasting a FULL URL into a prefixed input stores it as-is (no double-prefix) — the
  // scheme guard keeps it from becoming https://x.com/https://x.com/foo. POO-659: type a valid name
  // first so Save can proceed (the unfilled manager starts nameless).
  it("[POO-657] stores a pasted full URL as-is in a prefixed input (no double prefix)", async () => {
    renderWithProviders(<ManagerProfileTabView profile={unfilled()} />);
    fireEvent.change(screen.getByLabelText(/Display name/), { target: { value: "Delta Desk" } });
    fireEvent.change(screen.getByLabelText("X"), {
      target: { value: "https://x.com/foo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText("Profile saved")).toBeInTheDocument());
    const input = updateProfile.mock.lastCall?.[1] as { socials: Record<string, unknown> };
    expect(input.socials.x).toBe("https://x.com/foo");
  });

  // POO-572 R2/R3: a bare @handle in X shows NO error and persists as the built URL.
  it("[POO-572 R2/R3] accepts a bare @handle in X and persists https://x.com/eu", async () => {
    renderWithProviders(<ManagerProfileTabView profile={unfilled()} />);
    // POO-659: type a valid name so Save can proceed (the unfilled manager starts nameless).
    fireEvent.change(screen.getByLabelText(/Display name/), { target: { value: "Carlos" } });
    fireEvent.change(screen.getByLabelText("X"), { target: { value: "@eu" } });
    // No inline error for the X field's built URL.
    expect(screen.queryByText(/valid X link/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText("Profile saved")).toBeInTheDocument());
    const input = updateProfile.mock.lastCall?.[1] as { socials: Record<string, unknown> };
    expect(input.socials.x).toBe("https://x.com/eu");
  });

  // POO-575 R1: while unlocked the handle field is an editable (not disabled) input.
  // POO-659: the unfilled manager has no seeded handle, so the editable field starts empty.
  it("[POO-575 R1] renders an editable handle input while unlocked", () => {
    renderWithProviders(<ManagerProfileTabView profile={unfilled()} />);
    const handle = screen.getByLabelText(/Handle/);
    expect(handle).toBeEnabled();
    expect(handle).not.toHaveAttribute("readonly");
    expect(handle).toHaveValue("");
  });

  // POO-575 R2: typing uppercase / spaces / invalid chars slugifies live in the field.
  it("[POO-575 R2] slugifies the handle live as the manager types", () => {
    renderWithProviders(<ManagerProfileTabView profile={unfilled()} />);
    const handle = screen.getByLabelText(/Handle/);
    fireEvent.change(handle, { target: { value: "Carlos Mendes!! ⚡" } });
    expect(handle).toHaveValue("carlos-mendes");
    fireEvent.change(handle, { target: { value: "MY_FUND_2024" } });
    expect(handle).toHaveValue("my-fund-2024");
  });

  // POO-575 R3: with an empty handle, the suggestion tracks the display name; once the manager edits
  // the handle, the suggestion stops overwriting it.
  it("[POO-575 R3] seeds the handle from the display name until manually edited", () => {
    // Start from a profile with a blank handle so the suggestion seeds it.
    renderWithProviders(<ManagerProfileTabView profile={{ ...unfilled(), handle: "" }} />);
    const handle = screen.getByLabelText(/Handle/);
    const name = screen.getByLabelText(/Display name/);
    // Suggestion follows the name while the handle is untouched.
    fireEvent.change(name, { target: { value: "Blue Chip" } });
    expect(handle).toHaveValue("blue-chip");
    fireEvent.change(name, { target: { value: "Blue Chip Fund" } });
    expect(handle).toHaveValue("blue-chip-fund");
    // Manual edit takes over; further name changes no longer touch the handle.
    fireEvent.change(handle, { target: { value: "my-desk" } });
    fireEvent.change(name, { target: { value: "Something Else" } });
    expect(handle).toHaveValue("my-desk");
  });

  // POO-575 R4: a too-short handle (after slugify) blocks Save and shows the inline error.
  it("[POO-575 R4] blocks Save and flags a too-short handle", () => {
    renderWithProviders(<ManagerProfileTabView profile={unfilled()} />);
    const handle = screen.getByLabelText(/Handle/);
    fireEvent.change(handle, { target: { value: "ab" } });
    expect(handle).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/3-30/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  // POO-575 R5: a handle taken by another manager shows the "taken" error and blocks Save.
  it("[POO-575 R5] flags a taken handle and blocks Save", async () => {
    isHandleAvailable.mockResolvedValue(false);
    renderWithProviders(<ManagerProfileTabView profile={unfilled()} />);
    fireEvent.change(screen.getByLabelText(/Handle/), { target: { value: "aave-labs" } });
    await waitFor(() => expect(screen.getByText(/already taken/i)).toBeInTheDocument());
    expect(screen.getByLabelText(/Handle/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    // POO-659: uniqueness excludes the manager's own id, now the wallet address (was "carlos").
    expect(isHandleAvailable).toHaveBeenCalledWith("aave-labs", MANAGER_ID);
  });

  // POO-575 R5: uniqueness excludes the manager's own current handle — no false "taken" on save.
  // POO-659: give the (address-keyed) manager a name + seeded handle so the "unchanged handle saves"
  // path is reachable; the write still keys off the wallet address, not the handle.
  it("[POO-575 R5] does not flag the manager's own current handle", async () => {
    isHandleAvailable.mockResolvedValue(true);
    renderWithProviders(
      <ManagerProfileTabView profile={{ ...unfilled(), name: "Carlos", handle: "carlos" }} />,
    );
    // POO-707 [R3]: Save is dirty-gated — edit the (still-valid) name so it enables while the seeded
    // handle "carlos" stays unchanged (handleTouched, so the name edit never re-suggests it).
    fireEvent.change(screen.getByLabelText(/Display name/), { target: { value: "Carlos M" } });
    // The seeded handle "carlos" is unchanged; save proceeds without flagging it as taken.
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText("Profile saved")).toBeInTheDocument());
    expect(updateProfile).toHaveBeenCalledWith(
      MANAGER_ID,
      expect.objectContaining({ handle: "carlos" }),
    );
  });

  // POO-575 R6: a valid, unique handle saves with the chosen handle, then the field locks (the
  // parent re-renders the saved, now-locked profile → read-only).
  it("[POO-575 R6] saves the chosen handle then locks the field", async () => {
    isHandleAvailable.mockResolvedValue(true);
    function Harness() {
      const [p, setP] = require("react").useState(unfilled());
      return <ManagerProfileTabView profile={p} onSaved={setP} />;
    }
    renderWithProviders(<Harness />);
    // POO-659: type a valid name first (unfilled manager), then the chosen handle — the handle edit
    // sets `handleTouched` so the name-suggestion never overwrites it.
    fireEvent.change(screen.getByLabelText(/Display name/), { target: { value: "Carlos" } });
    fireEvent.change(screen.getByLabelText(/Handle/), { target: { value: "carlos-defi" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText("Profile saved")).toBeInTheDocument());
    expect(updateProfile).toHaveBeenCalledWith(
      MANAGER_ID,
      expect.objectContaining({ handle: "carlos-defi", handleLocked: true }),
    );
    // The mock returns handleLocked:true; the parent re-render locks the field.
    await waitFor(() => expect(screen.getByLabelText(/Handle/)).toBeDisabled());
  });

  // POO-575 R8: while editable, a muted permanence warning shows below the handle; once locked it is
  // gone (the handle can no longer change).
  it("[POO-575 R8] warns the handle is permanent while editable, not once locked", () => {
    const { rerender } = renderWithProviders(<ManagerProfileTabView profile={unfilled()} />);
    expect(screen.getByText(/handle is permanent/i)).toBeInTheDocument();

    rerender(<ManagerProfileTabView profile={lockedUnfilled()} />);
    expect(screen.queryByText(/handle is permanent/i)).not.toBeInTheDocument();
  });

  // POO-586: image upload limit (10 MB, PNG/JPG only) on the banner + photo pick handlers.
  describe("[POO-586] image upload limit", () => {
    /** A File whose reported size is `bytes` without allocating that much (jsdom reads File.size). */
    function fileOfSize(bytes: number, type: string, name = "x"): File {
      const file = new File(["x"], name, { type });
      Object.defineProperty(file, "size", { value: bytes, configurable: true });
      return file;
    }

    // @rule POO-586 R1: the file inputs advertise PNG/JPG only via the accept attribute.
    it("sets accept=image/png,image/jpeg on the banner and photo inputs", () => {
      renderWithProviders(<ManagerProfileTabView profile={unfilled()} />);
      for (const label of ["Change banner", "Change photo"]) {
        expect(screen.getByLabelText(label)).toHaveAttribute("accept", "image/png,image/jpeg");
      }
    });

    // @rule POO-586 R2/R3: a >10 MB file does not open the crop, shows the error, and resets the input.
    it("rejects an oversized file: no crop, shows the error, resets the input", () => {
      const createObjectURL = vi.fn(() => "blob:mock-crop-src");
      vi.stubGlobal("URL", Object.assign(Object.create(URL), { createObjectURL }));
      try {
        renderWithProviders(<ManagerProfileTabView profile={unfilled()} />);
        const input = screen.getByLabelText("Change photo") as HTMLInputElement;
        fireEvent.change(input, {
          target: { files: [fileOfSize(11 * 1024 * 1024, "image/png", "big.png")] },
        });
        expect(createObjectURL).not.toHaveBeenCalled();
        expect(screen.queryByTestId("crop-viewport")).not.toBeInTheDocument();
        expect(screen.getByText("Use a PNG or JPG under 10 MB.")).toBeInTheDocument();
        expect(input.value).toBe("");
      } finally {
        vi.unstubAllGlobals();
      }
    });

    // @rule POO-586 R1/R3: a wrong-type file (GIF) does not open the crop and shows the error.
    it("rejects a wrong-type file: no crop, shows the error", () => {
      const createObjectURL = vi.fn(() => "blob:mock-crop-src");
      vi.stubGlobal("URL", Object.assign(Object.create(URL), { createObjectURL }));
      try {
        renderWithProviders(<ManagerProfileTabView profile={unfilled()} />);
        const input = screen.getByLabelText("Change banner") as HTMLInputElement;
        fireEvent.change(input, {
          target: { files: [fileOfSize(1024, "image/gif", "a.gif")] },
        });
        expect(createObjectURL).not.toHaveBeenCalled();
        expect(screen.queryByTestId("crop-viewport")).not.toBeInTheDocument();
        expect(screen.getByText("Use a PNG or JPG under 10 MB.")).toBeInTheDocument();
        expect(input.value).toBe("");
      } finally {
        vi.unstubAllGlobals();
      }
    });

    // @rule POO-586 R1/R2: a valid PNG under the limit opens the crop (no error).
    it("accepts a valid PNG: opens the crop, no error", () => {
      const createObjectURL = vi.fn(() => "blob:mock-crop-src");
      vi.stubGlobal("URL", Object.assign(Object.create(URL), { createObjectURL }));
      try {
        renderWithProviders(<ManagerProfileTabView profile={unfilled()} />);
        fireEvent.change(screen.getByLabelText("Change photo"), {
          target: { files: [fileOfSize(2 * 1024 * 1024, "image/png", "ok.png")] },
        });
        expect(createObjectURL).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId("crop-viewport")).toBeInTheDocument();
        expect(screen.queryByText("Use a PNG or JPG under 10 MB.")).not.toBeInTheDocument();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    // @rule POO-586 R3: the error clears once a valid file is picked after a rejection.
    it("clears the error after a valid pick following a rejection", () => {
      const createObjectURL = vi.fn(() => "blob:mock-crop-src");
      vi.stubGlobal("URL", Object.assign(Object.create(URL), { createObjectURL }));
      try {
        renderWithProviders(<ManagerProfileTabView profile={unfilled()} />);
        const input = screen.getByLabelText("Change photo") as HTMLInputElement;
        fireEvent.change(input, {
          target: { files: [fileOfSize(1024, "image/webp", "a.webp")] },
        });
        expect(screen.getByText("Use a PNG or JPG under 10 MB.")).toBeInTheDocument();
        fireEvent.change(input, {
          target: { files: [fileOfSize(1024, "image/jpeg", "ok.jpg")] },
        });
        expect(screen.queryByText("Use a PNG or JPG under 10 MB.")).not.toBeInTheDocument();
        expect(screen.getByTestId("crop-viewport")).toBeInTheDocument();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  // POO-745: the "Request verification" control reads status from the profile's `managerVerification`
  // (none|pending|valid) and requests via the signed code-DM flow (useRequestManagerVerification →
  // managerService.requestVerification in mock). The X-only gate (hasVerificationIdentitySocial) is
  // unchanged; `valid` shows the badge IN PLACE of the button. `pending -> valid` is out of scope.
  describe("[POO-745] request verification (code-DM model)", () => {
    // POO-745 R2 / POO-579: the shared SOCIAL_NETWORKS leads with the identity network (X), so the edit
    // form renders an X input prefilled from the profile (the X-only gate reads this value).
    // POO-657: the prefixed X input shows only the handle (the "x.com/" prefix is fixed alongside it).
    it("[R2] renders the X social input prefilled", () => {
      const profile = { ...unfilled(), socials: { x: "https://x.com/deltadesk" } };
      renderWithProviders(<ManagerProfileTabView profile={profile} />);
      expect(screen.getByLabelText("X")).toHaveValue("deltadesk");
    });

    // POO-745 R3/R4: an unrequested manager (managerVerification 'none') with an X link may request;
    // clicking persists the edits then POSTs the request, the returned one-time code shows in the modal,
    // and the control advances to "Pending validation".
    it("[R3/R4] persists edits, requests, shows the code modal and moves to pending", async () => {
      const profile = {
        ...unfilled(),
        name: "Carlos",
        managerVerification: "none" as const,
        socials: { x: "https://x.com/carlosyield" },
      };
      renderWithProviders(<ManagerProfileTabView profile={profile} />);
      fireEvent.click(screen.getByRole("button", { name: "Request verification" }));

      // R4: the modal renders the returned one-time code.
      expect(await screen.findByTestId("verification-code")).toHaveTextContent("K7QF2M9X");
      expect(updateProfile).toHaveBeenCalledWith(
        MANAGER_ID,
        expect.objectContaining({
          socials: expect.objectContaining({ x: "https://x.com/carlosyield" }),
        }),
      );
      expect(requestVerification).toHaveBeenCalledWith(MANAGER_ID);

      // Close the modal (it aria-hides the page behind it) to assert the control advanced to pending.
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
      // R5: the control is now "Pending validation", not "Request verification".
      expect(screen.queryByRole("button", { name: "Request verification" })).toBeNull();
      expect(screen.getByRole("button", { name: "Pending validation" })).toBeInTheDocument();
    });

    // POO-745 R2: with no X link, the CTA stays tappable but blocks, revealing what to add.
    it("[R2] blocks the request and reveals the missing X link", () => {
      const profile = {
        ...unfilled(),
        name: "Carlos",
        managerVerification: "none" as const,
        socials: { telegram: "https://t.me/channel" },
      };
      renderWithProviders(<ManagerProfileTabView profile={profile} />);
      expect(screen.queryByText(/Add your X link/)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Request verification" }));
      expect(screen.getByText(/Add your X link/)).toBeInTheDocument();
      expect(requestVerification).not.toHaveBeenCalled();
    });

    // POO-745 R7 + resolved decision: a valid manager shows the Verified badge IN PLACE of the button.
    it("[R7] shows Verified and no request/pending button when valid", () => {
      const profile = { ...unfilled(), managerVerification: "valid" as const };
      renderWithProviders(<ManagerProfileTabView profile={profile} />);
      expect(screen.getByText("Verified")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Request verification" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Pending validation" })).toBeNull();
    });

    // POO-745 R5: a pending manager shows the "Pending validation" button, not the request CTA.
    it("[R5] shows the Pending validation button while pending", () => {
      const profile = { ...unfilled(), managerVerification: "pending" as const };
      renderWithProviders(<ManagerProfileTabView profile={profile} />);
      expect(screen.getByRole("button", { name: "Pending validation" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Request verification" })).toBeNull();
    });

    // POO-745 R6: re-clicking while pending re-shows the SAME code via an idempotent re-request, without
    // persisting profile edits (no updateProfile call on the re-show path).
    it("[R6] re-shows the same code on a pending re-click without re-saving", async () => {
      const profile = { ...unfilled(), managerVerification: "pending" as const };
      renderWithProviders(<ManagerProfileTabView profile={profile} />);
      fireEvent.click(screen.getByRole("button", { name: "Pending validation" }));

      expect(await screen.findByTestId("verification-code")).toHaveTextContent("K7QF2M9X");
      expect(requestVerification).toHaveBeenCalledWith(MANAGER_ID);
      expect(updateProfile).not.toHaveBeenCalled();
    });
  });

  // POO-707 [R4/R5]: the manager-console data loader injects onUploadAvatar/onUploadBanner in real mode.
  // A crop now STAGES the image locally (no upload, no signature); the upload is DEFERRED to Save, which
  // uploads the staged blob(s) (session-auth) then forwards the returned https CDN URL(s) through the
  // single signed PATCH (buildManagerProfileBody forwards only https). jsdom can't rasterize the canvas,
  // so ImageCropModal.Apply ships the crop source through onApply → staged. A locked, named profile keeps
  // Save enabled with no async handle check, isolating the media behavior under test.
  describe("[POO-707] deferred avatar/banner media upload", () => {
    /** Stub createObjectURL + fetch().blob() so the pick → crop → (deferred) upload path runs in jsdom. */
    function stubUploadEnv() {
      const realCreate = URL.createObjectURL;
      const realFetch = global.fetch;
      URL.createObjectURL = () => "blob:mock";
      global.fetch = vi.fn(async () => ({
        blob: async () => new Blob(["x"], { type: "image/png" }),
      })) as unknown as typeof fetch;
      return () => {
        URL.createObjectURL = realCreate;
        global.fetch = realFetch;
      };
    }

    const namedLocked = () => ({ ...lockedUnfilled(), name: "Carlos" });

    it("stages a cropped avatar and uploads it only on Save, forwarding the CDN url", async () => {
      const restore = stubUploadEnv();
      const publicUrl = "https://cdn.pool-party.xyz/managers/0xw/avatar.png?v=2";
      const onUploadAvatar = vi.fn(async () => publicUrl);
      const onUploadBanner = vi.fn(
        async () => "https://cdn.pool-party.xyz/managers/0xw/banner.png",
      );
      try {
        renderWithProviders(
          <ManagerProfileTabView
            profile={namedLocked()}
            onUploadAvatar={onUploadAvatar}
            onUploadBanner={onUploadBanner}
          />,
        );
        fireEvent.change(screen.getByLabelText("Change photo"), {
          target: { files: [new File(["x"], "avatar.png", { type: "image/png" })] },
        });
        // [R4]: Apply stages only — no upload on crop.
        fireEvent.click(screen.getByRole("button", { name: "Apply" }));
        expect(onUploadAvatar).not.toHaveBeenCalled();
        // [R5]: Save uploads the staged avatar (once) then the single PATCH forwards its CDN url.
        fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
        await waitFor(() => expect(onUploadAvatar).toHaveBeenCalledTimes(1));
        expect(onUploadBanner).not.toHaveBeenCalled();
        await waitFor(() => expect(screen.getByText("Profile saved")).toBeInTheDocument());
        const input = updateProfile.mock.lastCall?.[1] as { avatarUrl?: string };
        expect(input.avatarUrl).toBe(publicUrl);
        // The uploaded CDN URL becomes the rendered avatar after the save resolves.
        await waitFor(() =>
          expect(document.querySelector("img")?.getAttribute("src")).toBe(publicUrl),
        );
      } finally {
        restore();
      }
    });

    it("stages a cropped banner and uploads it on Save, forwarding its url", async () => {
      const restore = stubUploadEnv();
      const bannerUrl = "https://cdn.pool-party.xyz/managers/0xw/banner.png?v=3";
      const onUploadBanner = vi.fn(async () => bannerUrl);
      try {
        renderWithProviders(
          <ManagerProfileTabView
            profile={namedLocked()}
            onUploadAvatar={vi.fn(async () => "https://cdn.pool-party.xyz/a.png")}
            onUploadBanner={onUploadBanner}
          />,
        );
        fireEvent.change(screen.getByLabelText("Change banner"), {
          target: { files: [new File(["x"], "banner.png", { type: "image/png" })] },
        });
        fireEvent.click(screen.getByRole("button", { name: "Apply" }));
        expect(onUploadBanner).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
        await waitFor(() => expect(onUploadBanner).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.getByText("Profile saved")).toBeInTheDocument());
        const input = updateProfile.mock.lastCall?.[1] as { bannerUrl?: string };
        expect(input.bannerUrl).toBe(bannerUrl);
      } finally {
        restore();
      }
    });

    it("keeps the staged preview + shows an error, without patching, when the upload fails on Save", async () => {
      const restore = stubUploadEnv();
      const onUploadAvatar = vi.fn(async () => {
        throw new Error("503 MEDIA_NOT_CONFIGURED");
      });
      try {
        renderWithProviders(
          <ManagerProfileTabView
            profile={namedLocked()}
            onUploadAvatar={onUploadAvatar}
            onUploadBanner={vi.fn(async () => "https://cdn.pool-party.xyz/b.png")}
          />,
        );
        fireEvent.change(screen.getByLabelText("Change photo"), {
          target: { files: [new File(["x"], "avatar.png", { type: "image/png" })] },
        });
        // [R4]: staged, no error yet.
        fireEvent.click(screen.getByRole("button", { name: "Apply" }));
        expect(screen.queryByText("Couldn't upload the image. Try again.")).toBeNull();
        // [R5/R6]: Save triggers the deferred upload, which fails and surfaces the error.
        fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
        expect(
          await screen.findByText("Couldn't upload the image. Try again."),
        ).toBeInTheDocument();
        // The local crop preview is kept (an <img> is shown, not the initials fallback).
        expect(document.querySelector("img")).not.toBeNull();
        // [R6]: a failed upload never persists — the single PATCH is not called at all.
        expect(updateProfile).not.toHaveBeenCalled();
      } finally {
        restore();
      }
    });
  });

  // POO-695: a full URL pasted into a prefixed handle input is normalized for its network. A
  // matching-domain paste is stored normalized (the input shows just the handle, the fixed prefix stays
  // honest); a FOREIGN-domain paste flags inline and blocks Save so it can never silently CLEAR a
  // previously-valid link on write (data loss).
  describe("[POO-695] prefixed social input normalize/reject", () => {
    it("rejects a foreign-domain paste with an inline error and blocks Save", () => {
      // A manager with a valid, saved X link. Pasting a foreign URL must not silently clear it.
      const profile = {
        ...lockedUnfilled(),
        name: "Carlos",
        socials: { x: "https://x.com/carlos" },
      };
      renderWithProviders(<ManagerProfileTabView profile={profile} />);
      const save = screen.getByRole("button", { name: "Save changes" });
      // POO-707 [R3]: make a valid change so Save is dirty-enabled — then the foreign paste must still
      // block it (the point of this rule), proving the block is the invalid social, not just dirtiness.
      fireEvent.change(screen.getByLabelText(/Display name/), { target: { value: "Carlos M" } });
      expect(save).toBeEnabled();
      fireEvent.change(screen.getByLabelText("X"), {
        target: { value: "https://instagram.com/carlos" },
      });
      expect(screen.getByText(/not a valid X link/i)).toBeInTheDocument();
      expect(screen.getByLabelText("X")).toHaveAttribute("aria-invalid", "true");
      expect(save).toBeDisabled();
      expect(updateProfile).not.toHaveBeenCalled();
    });

    it("normalizes a matching-domain full URL to just the handle with no error", () => {
      renderWithProviders(
        <ManagerProfileTabView profile={{ ...lockedUnfilled(), name: "Carlos" }} />,
      );
      fireEvent.change(screen.getByLabelText("X"), { target: { value: "https://x.com/carlos" } });
      // The fixed "x.com/" prefix stays honest: the input shows only the handle.
      expect(screen.getByLabelText("X")).toHaveValue("carlos");
      expect(screen.queryByText(/not a valid X link/i)).toBeNull();
      expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
    });
  });

  // POO-702 Secondary #1 (observability): a failing save / verification-request / upload must be
  // VISIBLE + diagnosable, not swallowed. A locked, named profile keeps Save enabled with no async
  // handle check, isolating the failure behavior under test.
  describe("[POO-702] save + upload failure observability", () => {
    const namedLocked = () => ({ ...lockedUnfilled(), name: "Carlos" });

    // @rule R2: a rejected updateProfile on Save surfaces the inline error, hides "Profile saved", and logs.
    it("surfaces a visible error and logs when the manager save fails (R2)", async () => {
      updateProfile.mockRejectedValueOnce(new Error("PATCH /managers/me failed"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        renderWithProviders(<ManagerProfileTabView profile={namedLocked()} />);
        // POO-707 [R3]: Save is dirty-gated, so make a real change first to enable it.
        fireEvent.change(screen.getByLabelText(/Display name/), { target: { value: "Carlos M" } });
        fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
        expect(
          await screen.findByText("Couldn't save your changes. Try again."),
        ).toBeInTheDocument();
        expect(screen.queryByText("Profile saved")).toBeNull();
        await waitFor(() =>
          expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining("PP-PROFILE-SAVE"),
            expect.objectContaining({
              surface: "manager",
              action: "save",
              message: "PATCH /managers/me failed",
            }),
          ),
        );
      } finally {
        errorSpy.mockRestore();
      }
    });

    // @rule R3: a rejected updateProfile on the verification-request path surfaces the error and logs it.
    it("surfaces a visible error and logs when the verification request fails (R3)", async () => {
      updateProfile.mockRejectedValueOnce(new Error("PATCH /managers/me failed"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const profile = { ...namedLocked(), socials: { x: "https://x.com/carlosyield" } };
      try {
        renderWithProviders(<ManagerProfileTabView profile={profile} />);
        fireEvent.click(screen.getByRole("button", { name: "Request verification" }));
        expect(
          await screen.findByText("Couldn't save your changes. Try again."),
        ).toBeInTheDocument();
        // The persist rejected, so the request itself was never created.
        expect(requestVerification).not.toHaveBeenCalled();
        await waitFor(() =>
          expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining("PP-PROFILE-SAVE"),
            expect.objectContaining({ surface: "manager", action: "verification-request" }),
          ),
        );
      } finally {
        errorSpy.mockRestore();
      }
    });

    // @rule R5: the avatar/banner upload catch keeps its UI flag AND logs the error incl. the asset kind.
    it("structured-logs an upload failure under PP-MEDIA-UPLOAD with the asset kind (R5)", async () => {
      const realCreate = URL.createObjectURL;
      const realFetch = global.fetch;
      URL.createObjectURL = () => "blob:mock";
      global.fetch = vi.fn(async () => ({
        blob: async () => new Blob(["x"], { type: "image/png" }),
      })) as unknown as typeof fetch;
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const onUploadAvatar = vi.fn(async () => {
        throw new Error("503 MEDIA_NOT_CONFIGURED");
      });
      try {
        renderWithProviders(
          <ManagerProfileTabView profile={namedLocked()} onUploadAvatar={onUploadAvatar} />,
        );
        fireEvent.change(screen.getByLabelText("Change photo"), {
          target: { files: [new File(["x"], "avatar.png", { type: "image/png" })] },
        });
        // POO-707 [R4/R5]: Apply stages; the upload runs on Save, where it fails.
        fireEvent.click(screen.getByRole("button", { name: "Apply" }));
        fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
        expect(
          await screen.findByText("Couldn't upload the image. Try again."),
        ).toBeInTheDocument();
        await waitFor(() =>
          expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining("PP-MEDIA-UPLOAD"),
            expect.objectContaining({
              surface: "manager",
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

  // POO-707 [R3]: Save is dirty-tracked — disabled unless a field/handle/social changed or an image is
  // staged, AND the form is valid. An all-unchanged (valid) profile gets no no-op save.
  describe("[POO-707] dirty-tracked Save", () => {
    const namedLocked = () => ({ ...lockedUnfilled(), name: "Carlos" });

    it("disables Save on an unchanged, valid profile", () => {
      renderWithProviders(<ManagerProfileTabView profile={namedLocked()} />);
      expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    });

    it("enables Save when a text field changes", () => {
      renderWithProviders(<ManagerProfileTabView profile={namedLocked()} />);
      expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
      fireEvent.change(screen.getByLabelText(/Display name/), { target: { value: "Carlos M" } });
      expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
    });

    it("enables Save when a cropped image is staged (no text change)", () => {
      const createObjectURL = vi.fn(() => "blob:mock-crop-src");
      vi.stubGlobal("URL", Object.assign(Object.create(URL), { createObjectURL }));
      try {
        renderWithProviders(
          <ManagerProfileTabView
            profile={namedLocked()}
            onUploadAvatar={vi.fn(async () => "https://cdn.pool-party.xyz/a.png")}
          />,
        );
        expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
        fireEvent.change(screen.getByLabelText("Change photo"), {
          target: { files: [new File(["x"], "avatar.png", { type: "image/png" })] },
        });
        fireEvent.click(screen.getByRole("button", { name: "Apply" }));
        expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  // POO-751 [R3]/[R5]: ManagerProfileTabView registers its dirty flag via useUnsavedChanges, so a
  // GuardedLink in the same provider tree must open the confirm modal once a field is edited, and
  // navigate straight through while the form is still pristine (a valid, unchanged profile).
  describe("[POO-751] unsaved-changes guard", () => {
    const namedLocked = () => ({ ...lockedUnfilled(), name: "Carlos" });

    function renderGuarded(profile = namedLocked()) {
      renderWithProviders(
        <UnsavedChangesProvider>
          <ManagerProfileTabView profile={profile} />
          <GuardedLink href="/manager/pools">Leave console</GuardedLink>
        </UnsavedChangesProvider>,
      );
    }

    it("[R5] navigates a guarded link straight through on an unchanged profile", () => {
      renderGuarded();
      fireEvent.click(screen.getByRole("link", { name: "Leave console" }));
      expect(screen.queryByText("Unsaved changes")).toBeNull();
    });

    it("[R3]/[R5] opens the confirm modal when a guarded link is clicked with a dirty field", () => {
      renderGuarded();
      fireEvent.change(screen.getByLabelText(/Display name/), { target: { value: "Carlos M" } });
      fireEvent.click(screen.getByRole("link", { name: "Leave console" }));
      expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    });
  });
});
