/**
 * @id PP-CORE-CMP-021 (POO-465)
 * @name LocaleSwitcher.test
 * @implements-rules-version v1
 * Unit tests for LocaleSwitcher: options render, current locale selected, hydration gate
 * (inert server markup, enabled after mount), hard navigation on locale change, analytics.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleSwitcher } from "./LocaleSwitcher";

const routerReplace = vi.fn();

// Full mock of `@/i18n/navigation`: the real module pulls next-intl's ESM navigation entry,
// which imports `next/navigation` without an extension and cannot load under vitest's native
// Node ESM (next ships no package exports map), and inlining next-intl is a global
// vitest.config.ts change (out of scope for POO-465). `next-intl/routing` has no such imports,
// so the `getPathname` stub is derived from the REAL routing config: the [R2] assertions still
// fail loudly if `locales` or `localePrefix` drift. `useRouter` is mocked only to prove the
// refuted soft `router.replace` primitive (POO-465) is never invoked.
vi.mock("@/i18n/navigation", async () => {
  const { routing } = await vi.importActual<typeof import("@/i18n/routing")>("@/i18n/routing");
  return {
    usePathname: () => "/portfolio",
    useRouter: () => ({ replace: routerReplace }),
    getPathname: ({ href, locale }: { href: string; locale: string }) => {
      if (!(routing.locales as readonly string[]).includes(locale)) {
        throw new Error(`getPathname stub: locale "${locale}" is not in the routing config`);
      }
      if (routing.localePrefix !== "always") {
        throw new Error('getPathname stub models localePrefix "always" only; update the stub');
      }
      return `/${locale}${href}`;
    },
  };
});

/** Render a node inside a self-contained next-intl provider at the given locale. */
function renderWithIntl(ui: ReactElement, locale = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={{}}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const originalLocation = window.location;

/**
 * Replace `window.location` with a plain-object stub (jsdom-safe via Object.defineProperty) so
 * `assign` can be spied on and `search`/`hash` controlled. Restored in `afterEach`.
 */
function stubLocation({ search = "", hash = "" }: { search?: string; hash?: string } = {}) {
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, assign, search, hash },
    writable: true,
    configurable: true,
  });
  return assign;
}

describe("LocaleSwitcher", () => {
  beforeEach(() => {
    routerReplace.mockClear();
    window.dataLayer = [];
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it("renders all locale options with their endonyms", () => {
    renderWithIntl(<LocaleSwitcher />);

    const endonyms = [
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
    for (const name of endonyms) {
      expect(screen.getByRole("option", { name })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("option")).toHaveLength(endonyms.length);
  });

  it("selects the current locale from useLocale()", () => {
    renderWithIntl(<LocaleSwitcher />, "pt-BR");

    expect(screen.getByRole("combobox")).toHaveValue("pt-BR");
  });

  it("exposes an accessible label on the select", () => {
    renderWithIntl(<LocaleSwitcher label="Idioma" />);

    expect(screen.getByRole("combobox", { name: "Idioma" })).toBeInTheDocument();
  });

  it("renders the select disabled in server markup and enables it after hydration [R1]", async () => {
    // Server pass: the exact markup a visitor gets before React attaches listeners.
    const html = renderToString(
      <NextIntlClientProvider locale="en" messages={{}}>
        <LocaleSwitcher />
      </NextIntlClientProvider>,
    );
    const parsed = document.createElement("div");
    parsed.innerHTML = html;
    const serverSelect = parsed.querySelector("select");
    expect(serverSelect).not.toBeNull();
    // Attribute check (not a string match: the className contains `disabled:` variants).
    expect(serverSelect?.hasAttribute("disabled")).toBe(true);

    // Client pass: once effects flush (hydration complete), the select becomes interactive.
    renderWithIntl(<LocaleSwitcher />);
    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
  });

  it("hard-navigates to the locale-prefixed pathname on change [R2]", async () => {
    const user = userEvent.setup();
    const assign = stubLocation();
    renderWithIntl(<LocaleSwitcher />, "en");
    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());

    await user.selectOptions(screen.getByRole("combobox"), "pt-BR");

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/pt-BR/portfolio");
    // The soft client-side replace was refuted for this flow (POO-465): never called.
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it("preserves the current search and hash on the hard navigation [R2]", async () => {
    const user = userEvent.setup();
    const assign = stubLocation({ search: "?tab=fees", hash: "#top" });
    renderWithIntl(<LocaleSwitcher />, "en");
    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());

    await user.selectOptions(screen.getByRole("combobox"), "pt-BR");

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/pt-BR/portfolio?tab=fees#top");
  });

  it("tracks locale_changed with the previous and next locale before navigating [R3]", async () => {
    const user = userEvent.setup();
    const assign = stubLocation();
    // Snapshot the dataLayer at the moment of navigation: the event must already be there.
    let dataLayerAtNavigation: Record<string, unknown>[] = [];
    assign.mockImplementation(() => {
      dataLayerAtNavigation = [...(window.dataLayer ?? [])];
    });
    renderWithIntl(<LocaleSwitcher />, "en");
    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());

    await user.selectOptions(screen.getByRole("combobox"), "es");

    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "locale_changed", previous_locale: "en", locale: "es" }),
    );
    expect(assign).toHaveBeenCalledTimes(1);
    expect(dataLayerAtNavigation).toContainEqual(
      expect.objectContaining({ event: "locale_changed", previous_locale: "en", locale: "es" }),
    );
  });

  it("merges a consumer className onto the wrapper", () => {
    renderWithIntl(<LocaleSwitcher className="w-full" />);

    // The combobox lives inside the wrapper that receives the consumer className.
    const wrapper = screen.getByRole("combobox").parentElement;
    expect(wrapper).toHaveClass("w-full", "inline-flex");
  });

  it("keeps an externally passed disabled prop even after hydration [R5]", async () => {
    renderWithIntl(<LocaleSwitcher disabled />);

    // render() flushes effects (hydration gate open), so only the external prop holds it disabled.
    expect(screen.getByRole("combobox")).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("combobox")).toBeDisabled());
  });
});
