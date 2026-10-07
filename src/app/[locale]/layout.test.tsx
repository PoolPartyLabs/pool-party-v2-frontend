/**
 * @id PP-CORE-CMP-016
 * @name LocaleLayout.toaster.test
 * @implements-rules-version v1 (POO-2173 and POO-2287 rules v1)
 * @analytics-events none (a regression test; it renders the layout and emits nothing)
 *
 * Regression for POO-2173: `toast(...)` was called from the fund builder, the strategy manage view
 * and the drafts list, but no `<Toaster />` was mounted anywhere, so every toast was swallowed.
 *
 * This renders the REAL `[locale]` layout (the page chrome is stubbed, the layout is not) and fires a
 * toast through the app's own `toast` export. It fails when the layout stops mounting a Toaster, when
 * it mounts a second one (every toast would then show twice), and when the placement drifts: the
 * mobile tab bar must stay clear, the consent banner must stay on top, and the live region label
 * must follow the page language.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/components/ui/Toast";
import enShell from "@/i18n/messages/en/shell.json";
import ptBrShell from "@/i18n/messages/pt-BR/shell.json";
import LocaleLayout, { viewport } from "./layout";

// Build-time and runtime plumbing the layout reaches for. None of it is under test here.
vi.mock("next/font/local", () => ({ default: () => ({ variable: "font-poppins-test" }) }));
vi.mock("geist/font/mono", () => ({ GeistMono: { variable: "font-geist-mono-test" } }));
vi.mock("@next/third-parties/google", () => ({ GoogleTagManager: () => null }));
vi.mock("next/script", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next-intl", async (importActual) => {
  const actual = await importActual<typeof import("next-intl")>();
  const { default: consent } = await import("@/i18n/messages/en/consent.json");
  return {
    ...actual,
    // The server variant reads the request config; the real client provider is what the real
    // ConsentBanner (left unmocked, it is the thing a toast must stay below) needs below it.
    NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => (
      <actual.NextIntlClientProvider locale="en" messages={{ consent }}>
        {children}
      </actual.NextIntlClientProvider>
    ),
  };
});
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { default: en } = await import("@/i18n/messages/en/shell.json");
  const { default: ptBR } = await import("@/i18n/messages/pt-BR/shell.json");
  const shellByLocale: Record<string, unknown> = { en, "pt-BR": ptBR };
  return {
    setRequestLocale: () => {},
    // Same contract as the real one for `{ locale, namespace }`, answered from the real message files.
    getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) =>
      createTranslator({
        locale,
        namespace,
        messages: { shell: shellByLocale[locale] },
      } as unknown as Parameters<typeof createTranslator>[0]),
  };
});
vi.mock("@/components/analytics/AnalyticsListener", () => ({ AnalyticsListener: () => null }));

/**
 * Renders the layout the way Next does: `<html>` is the root of the tree, so the container is the
 * document itself rather than a div inside `<body>`.
 */
async function renderLayout(locale = "en") {
  const tree = await LocaleLayout({
    children: <main data-testid="page">page</main>,
    params: Promise.resolve({ locale }),
  });
  return render(tree, { container: document });
}

/** Fires a toast and returns the list element sonner draws it in (the one carrying the offsets). */
async function showToastAndGetList(message = "Draft saved") {
  act(() => {
    toast(message);
  });
  await screen.findByText(message);
  const list = document.querySelector<HTMLElement>("[data-sonner-toaster]");
  if (!list) throw new Error("sonner drew a toast but no toaster list");
  return list;
}

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

it("POO-2287 R1 declares native dark controls before CSS loads and preserves pinch zoom", () => {
  expect(viewport.colorScheme).toBe("dark");
  expect(viewport.maximumScale).toBe(5);
});

describe("LocaleLayout toaster mount (POO-2173)", () => {
  afterEach(() => {
    act(() => {
      toast.dismiss();
    });
  });

  it("shows a toast fired through the app's toast export", async () => {
    await renderLayout();
    expect(screen.getByTestId("page")).toBeInTheDocument();

    act(() => {
      toast("Draft saved");
    });

    expect(await screen.findByText("Draft saved")).toBeInTheDocument();
  });

  it("shows an error toast too, not only the plain one", async () => {
    await renderLayout();

    act(() => {
      toast.error("Could not save the draft");
    });

    expect(await screen.findByText("Could not save the draft")).toBeInTheDocument();
  });

  it("mounts exactly one Toaster, so a toast is never drawn twice", async () => {
    await renderLayout();

    act(() => {
      toast("Draft saved");
    });

    expect(await screen.findAllByText("Draft saved")).toHaveLength(1);
    expect(document.querySelectorAll('section[aria-label^="Notifications"]')).toHaveLength(1);
  });

  it("has exactly one <Toaster in the app and component sources, outside stories and tests", () => {
    // The render above only sees what THIS tree mounts. A second mount in a nested layout, the app
    // shell or a provider would draw every toast twice on the routes below it and pass that test.
    const roots = ["src/app", "src/components"];
    const hits: string[] = [];
    for (const root of roots) {
      for (const entry of readdirSync(join(ROOT, root), { recursive: true, encoding: "utf8" })) {
        if (!/\.tsx$/.test(entry) || /\.(test|stories)\.tsx$/.test(entry)) continue;
        // Comments and JSX comments mention `<Toaster />` in prose; only live JSX counts.
        const code = read(join(root, entry))
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:])\/\/.*$/gm, "$1");
        const count = code.match(/<Toaster\b/g)?.length ?? 0;
        for (let i = 0; i < count; i += 1) hits.push(relative(ROOT, join(ROOT, root, entry)));
      }
    }
    expect(hits.map((hit) => hit.split(sep).join("/"))).toEqual(["src/app/[locale]/layout.tsx"]);
  });
});

describe("LocaleLayout toaster placement (POO-2173 review F1)", () => {
  afterEach(() => {
    act(() => {
      toast.dismiss();
    });
  });

  it("keeps the bottom-right position the Toast primitive was designed with", async () => {
    await renderLayout();
    const list = await showToastAndGetList();

    expect(list).toHaveAttribute("data-y-position", "bottom");
    expect(list).toHaveAttribute("data-x-position", "right");
  });

  it("falls back to the library's own 24px offset where there is no tab bar", async () => {
    await renderLayout();
    const list = await showToastAndGetList();

    // `--pp-toast-bottom` is only defined below `lg`, so on desktop the fallback IS the default.
    expect(list.style.getPropertyValue("--offset-bottom")).toBe("var(--pp-toast-bottom, 24px)");
    expect(list.style.getPropertyValue("--mobile-offset-bottom")).toBe(
      "var(--pp-toast-bottom, 24px)",
    );
  });

  it("lifts toasts by the footer's tab-bar clearance below lg, where the tab bar is shown", async () => {
    await renderLayout();
    const list = await showToastAndGetList();

    const toastStep = /max-lg:\[--pp-toast-bottom:calc\(var\(--spacing\)\*(\d+)\)\]/.exec(
      list.className,
    )?.[1];
    expect(toastStep).toBeDefined();

    // The shell has no tab-bar height token. The one number it owns for "clear the bar" is the
    // spacing step AppFooter reserves under the page; the toast must use that same step, so a change
    // to the footer's clearance that forgets the toast fails here instead of in a browser.
    const footerStep = /\bpb-(\d+) lg:px-6/.exec(read("src/components/layout/AppFooter.tsx"))?.[1];
    expect(footerStep).toBeDefined();
    expect(toastStep).toBe(footerStep);

    // And the bar really is a below-`lg` element, so `max-lg` is the matching breakpoint.
    expect(read("src/components/layout/AppShell.tsx")).toMatch(
      /fixed inset-x-0 bottom-0 z-40 .*lg:hidden/,
    );
  });

  it("keeps the consent banner above toasts in stacking order", async () => {
    await renderLayout();
    const banner = await screen.findByRole("dialog");
    const list = await showToastAndGetList();

    // sonner's own z-index (999999999) sits in its stylesheet, so an unset inline value would let
    // toasts cover the banner. The layout must set one, and it must be below the banner's.
    expect(list.style.zIndex).toMatch(/^\d+$/);
    const bannerZ = Number(/\bz-(\d+)\b/.exec(banner.className)?.[1]);
    expect(Number.isFinite(bannerZ)).toBe(true);
    expect(Number(list.style.zIndex)).toBeLessThan(bannerZ);
  });
});

describe("LocaleLayout toaster live region label (POO-2173 review F2)", () => {
  afterEach(() => {
    act(() => {
      toast.dismiss();
    });
  });

  it("labels the live region in English on the en layout", async () => {
    await renderLayout("en");

    // sonner appends its own shortcut hint after the label; that part is left alone.
    expect(document.querySelector("section[aria-label]")).toHaveAttribute(
      "aria-label",
      `${enShell.toaster.ariaLabel} alt+T`,
    );
    expect(enShell.toaster.ariaLabel).toBe("Notifications");
  });

  it("labels the live region in Portuguese on the pt-BR layout", async () => {
    await renderLayout("pt-BR");

    const region = document.querySelector("section[aria-label]");
    expect(region).toHaveAttribute("aria-label", `${ptBrShell.toaster.ariaLabel} alt+T`);
    expect(ptBrShell.toaster.ariaLabel).toBe("Notificações");
    expect(region?.getAttribute("aria-label")).not.toContain("Notifications");
  });
});
