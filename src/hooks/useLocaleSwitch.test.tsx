/**
 * @id PP-CORE-HOK-024 (POO-904)
 * @name useLocaleSwitch.test
 * @implements-rules-version v1
 * Unit tests for the shared locale-switch seam [R4]: the endonym option list is the single source
 * of truth, `switchLocale` records `locale_changed` then hard-navigates to the locale-prefixed
 * equivalent of the current URL preserving search + hash [R2], and the open-redirect guard falls
 * back to the locale root when the computed target is not a safe same-origin path.
 */
import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCALE_OPTIONS, useLocaleSwitch } from "./useLocaleSwitch";

// Mutable knobs for the `@/i18n/navigation` mock (see LocaleSwitcher.test.tsx for why the module
// is fully mocked: next-intl's navigation entry cannot load under vitest's native Node ESM).
const nav = vi.hoisted(() => ({
  pathname: "/portfolio",
  getPathnameOverride: null as null | ((args: { href: string; locale: string }) => string),
}));

vi.mock("@/i18n/navigation", async () => {
  const { routing } = await vi.importActual<typeof import("@/i18n/routing")>("@/i18n/routing");
  return {
    usePathname: () => nav.pathname,
    getPathname: (args: { href: string; locale: string }) => {
      if (nav.getPathnameOverride) return nav.getPathnameOverride(args);
      if (!(routing.locales as readonly string[]).includes(args.locale)) {
        throw new Error(`getPathname stub: locale "${args.locale}" is not in the routing config`);
      }
      return `/${args.locale}${args.href}`;
    },
  };
});

/** renderHook wrapper: a self-contained next-intl provider at the given locale. */
function intlWrapper(locale: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={{}}>
        {children}
      </NextIntlClientProvider>
    );
  };
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

describe("useLocaleSwitch", () => {
  beforeEach(() => {
    nav.pathname = "/portfolio";
    nav.getPathnameOverride = null;
    window.dataLayer = [];
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  // @rule R4 — one source of truth for the endonym list shared by desktop select + mobile sheet.
  it("[R4] exposes the 11 supported locales with their endonyms", () => {
    expect(LOCALE_OPTIONS.map((o) => o.value)).toEqual([
      "pt-BR",
      "en",
      "es",
      "fr",
      "de",
      "nl",
      "ja",
      "ko",
      "zh-CN",
      "zh-TW",
      "vi",
    ]);
    expect(LOCALE_OPTIONS.map((o) => o.label)).toEqual([
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
    ]);
  });

  it("reports the current locale from useLocale()", () => {
    const { result } = renderHook(() => useLocaleSwitch(), { wrapper: intlWrapper("pt-BR") });
    expect(result.current.locale).toBe("pt-BR");
  });

  // @rule R2 — same hard navigation as the desktop select, preserving path + search + hash.
  it("[R2] switchLocale hard-navigates to the locale-prefixed URL preserving search and hash", () => {
    const assign = stubLocation({ search: "?tab=fees", hash: "#top" });
    const { result } = renderHook(() => useLocaleSwitch(), { wrapper: intlWrapper("en") });

    result.current.switchLocale("pt-BR");

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/pt-BR/portfolio?tab=fees#top");
  });

  // @rule R2 — locale_changed (previous → next) is on the dataLayer BEFORE the document unloads.
  it("[R2] switchLocale tracks locale_changed before navigating", () => {
    let dataLayerAtNavigation: Record<string, unknown>[] = [];
    const assign = stubLocation();
    assign.mockImplementation(() => {
      dataLayerAtNavigation = [...(window.dataLayer ?? [])];
    });
    const { result } = renderHook(() => useLocaleSwitch(), { wrapper: intlWrapper("en") });

    result.current.switchLocale("es");

    expect(assign).toHaveBeenCalledTimes(1);
    expect(dataLayerAtNavigation).toContainEqual(
      expect.objectContaining({ event: "locale_changed", previous_locale: "en", locale: "es" }),
    );
  });

  it("falls back to the locale root when the computed target is not a safe same-origin path", () => {
    const assign = stubLocation();
    // Force the open-redirect guard: a protocol-relative "path" must never be navigated to.
    nav.getPathnameOverride = () => "//evil.example/phish";
    const { result } = renderHook(() => useLocaleSwitch(), { wrapper: intlWrapper("en") });

    result.current.switchLocale("de");

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/de");
  });
});
