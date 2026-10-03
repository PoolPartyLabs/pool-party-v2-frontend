/**
 * @id PP-CORE-CMP-016
 * @name LocaleLayout.toaster.test
 * @implements-rules-version v1
 * @analytics-events none (a regression test; it renders the layout and emits nothing)
 *
 * Regression for POO-2173: `toast(...)` was called from the fund builder, the strategy manage view
 * and the drafts list, but no `<Toaster />` was mounted anywhere, so every toast was swallowed.
 *
 * This renders the REAL `[locale]` layout (the page chrome is stubbed, the layout is not) and fires a
 * toast through the app's own `toast` export. It fails when the layout stops mounting a Toaster, and
 * when it mounts a second one (every toast would then show twice).
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/components/ui/Toast";
import LocaleLayout from "./layout";

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
vi.mock("next-intl", async (importActual) => ({
  ...(await importActual<typeof import("next-intl")>()),
  // The server variant reads the request config; the client tree below it is what matters here.
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("next-intl/server", () => ({ setRequestLocale: () => {} }));
vi.mock("@/components/analytics/ConsentBanner", () => ({ ConsentBanner: () => null }));
vi.mock("@/components/analytics/AnalyticsListener", () => ({ AnalyticsListener: () => null }));

/**
 * Renders the layout the way Next does: `<html>` is the root of the tree, so the container is the
 * document itself rather than a div inside `<body>`.
 */
async function renderLayout() {
  const tree = await LocaleLayout({
    children: <main data-testid="page">page</main>,
    params: Promise.resolve({ locale: "en" }),
  });
  return render(tree, { container: document });
}

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
});
