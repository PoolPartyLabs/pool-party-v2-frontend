import { useTranslations } from "next-intl";
import { describe, expect, it } from "vitest";
import { renderWithProviders, screen } from "./utils/renderWithProviders";

function Greeting() {
  const t = useTranslations("common");
  return <p>{t("appName")}</p>;
}

describe("next-intl", () => {
  it("resolves messages through useTranslations + renderWithProviders", () => {
    renderWithProviders(<Greeting />);
    expect(screen.getByText("Pool Party")).toBeInTheDocument();
  });
});
