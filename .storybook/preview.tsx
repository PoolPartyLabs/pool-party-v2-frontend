import "../src/app/globals.css";
import type { Decorator, Preview } from "@storybook/nextjs-vite";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "../src/i18n/messages/en/common.json";

/**
 * Storybook preview, SETUP-007 (Linear POO-53).
 *
 * PP-NOTE: dark-only workbench. The real design tokens arrive with STY-001/002; until then the
 * dark canvas is forced through a decorator using the globals.css dark value (#0a0a0a), because
 * the app currently flips to dark via `prefers-color-scheme` (no class), which Storybook cannot
 * toggle from the host OS.
 */
const messages = { common: enCommon };

const withIntlAndDark: Decorator = (Story) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0a",
        color: "#ededed",
        padding: "2rem",
      }}
    >
      <Story />
    </div>
  </NextIntlClientProvider>
);

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
  decorators: [withIntlAndDark],
};

export default preview;
