/**
 * @id PP-CORE-CMP-063 (POO-904)
 * @name MobileLocaleSheet.test
 * @implements-rules-version v1
 * Behavior tests for the mobile locale picker: the icon trigger (i18n accessible name, 44px touch
 * target) [R1], the bottom sheet listing the 11 endonyms with the current locale marked, and a
 * selection that fires locale_changed, hard-navigates preserving path/search/hash, and closes the
 * sheet [R2]. Endonyms come from the shared useLocaleSwitch seam [R4].
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/messages/en/shell.json";
import { MobileLocaleSheet } from "./MobileLocaleSheet";

// Full mock of `@/i18n/navigation` (same rationale as LocaleSwitcher.test.tsx: next-intl's
// navigation entry cannot load under vitest's native Node ESM). The getPathname stub derives from
// the REAL routing config so [R2] assertions fail loudly if `locales` or `localePrefix` drift.
vi.mock("@/i18n/navigation", async () => {
  const { routing } = await vi.importActual<typeof import("@/i18n/routing")>("@/i18n/routing");
  return {
    usePathname: () => "/portfolio",
    getPathname: ({ href, locale }: { href: string; locale: string }) => {
      if (!(routing.locales as readonly string[]).includes(locale)) {
        throw new Error(`getPathname stub: locale "${locale}" is not in the routing config`);
      }
      return `/${locale}${href}`;
    },
  };
});

const ENDONYMS = [
  "Português",
  "English",
  "Español",
  "Français",
  "Deutsch",
  "Nederlands",
  "日本語",
  "한국어",
  "简体中文",
  "繁體中文",
  "Tiếng Việt",
];

/** Render inside a self-contained next-intl provider with the REAL en shell messages. */
function renderWithIntl(ui: ReactElement, locale = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={{ shell: enShell }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const originalLocation = window.location;

/** jsdom-safe `window.location` stub so `assign` can be spied on and search/hash controlled. */
function stubLocation({ search = "", hash = "" }: { search?: string; hash?: string } = {}) {
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, assign, search, hash },
    writable: true,
    configurable: true,
  });
  return assign;
}

describe("MobileLocaleSheet", () => {
  beforeEach(() => {
    window.dataLayer = [];
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  // @rule R1 — icon button with an i18n accessible name; the sheet stays closed until tapped.
  it("[R1] renders an icon-only trigger with the translated accessible name", () => {
    renderWithIntl(<MobileLocaleSheet />);

    expect(screen.getByRole("button", { name: "Change language" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // @rule R1 — minimum 44px touch target (POO-840 precedent): size-11 = 44px square.
  it("[R1] the trigger carries a 44px touch target", () => {
    renderWithIntl(<MobileLocaleSheet />);

    expect(screen.getByRole("button", { name: "Change language" })).toHaveClass("size-11");
  });

  // @rule R2 — the sheet lists the 11 locales exactly as the desktop select does: endonyms.
  it("[R2] opens a sheet titled Language listing all 11 endonyms", async () => {
    const user = userEvent.setup();
    renderWithIntl(<MobileLocaleSheet />);

    await user.click(screen.getByRole("button", { name: "Change language" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Language" })).toBeInTheDocument();
    for (const name of ENDONYMS) {
      expect(within(dialog).getByRole("button", { name })).toBeInTheDocument();
    }
  });

  // @rule R2 — each endonym is tagged with its own language for screen readers.
  it("[R2] tags every option with its locale code via the lang attribute", async () => {
    const user = userEvent.setup();
    renderWithIntl(<MobileLocaleSheet />);

    await user.click(screen.getByRole("button", { name: "Change language" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "日本語" })).toHaveAttribute("lang", "ja");
    expect(within(dialog).getByRole("button", { name: "Português" })).toHaveAttribute(
      "lang",
      "pt-BR",
    );
  });

  // @rule R2 — the current locale is visually + programmatically marked.
  it("[R2] marks the current locale and no other", async () => {
    const user = userEvent.setup();
    renderWithIntl(<MobileLocaleSheet />, "pt-BR");

    await user.click(screen.getByRole("button", { name: "Change language" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Português" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    for (const name of ENDONYMS.filter((n) => n !== "Português")) {
      expect(within(dialog).getByRole("button", { name })).not.toHaveAttribute("aria-current");
    }
  });

  // @rule R2 — selection = the same hard navigation as the desktop select (path/search/hash).
  it("[R2] selecting a locale hard-navigates preserving path, search and hash", async () => {
    const user = userEvent.setup();
    const assign = stubLocation({ search: "?tab=fees", hash: "#top" });
    renderWithIntl(<MobileLocaleSheet />, "en");

    await user.click(screen.getByRole("button", { name: "Change language" }));
    await user.click(screen.getByRole("button", { name: "Español" }));

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/es/portfolio?tab=fees#top");
  });

  // @rule R2 — locale_changed (previous → next) is recorded before the document unloads.
  it("[R2] fires locale_changed with previous and next locale before navigating", async () => {
    const user = userEvent.setup();
    const assign = stubLocation();
    let dataLayerAtNavigation: Record<string, unknown>[] = [];
    assign.mockImplementation(() => {
      dataLayerAtNavigation = [...(window.dataLayer ?? [])];
    });
    renderWithIntl(<MobileLocaleSheet />, "en");

    await user.click(screen.getByRole("button", { name: "Change language" }));
    await user.click(screen.getByRole("button", { name: "Deutsch" }));

    expect(assign).toHaveBeenCalledTimes(1);
    expect(dataLayerAtNavigation).toContainEqual(
      expect.objectContaining({ event: "locale_changed", previous_locale: "en", locale: "de" }),
    );
  });

  // @rule R2 — the sheet closes after a selection (visible when navigation is stubbed/slow).
  it("[R2] closes the sheet after a selection", async () => {
    const user = userEvent.setup();
    stubLocation();
    renderWithIntl(<MobileLocaleSheet />, "en");

    await user.click(screen.getByRole("button", { name: "Change language" }));
    await user.click(screen.getByRole("button", { name: "Español" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
