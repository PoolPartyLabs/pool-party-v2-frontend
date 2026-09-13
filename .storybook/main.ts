import type { StorybookConfig } from "@storybook/nextjs-vite";

/**
 * Storybook 10 (nextjs-vite framework), SETUP-007 (Linear POO-53).
 * Restricted scope: stories live next to design-system components and feature modals.
 * Cash+ adds a scoped page-state workbench for its dedicated demo and transaction sheets.
 */
const config: StorybookConfig = {
  framework: "@storybook/nextjs-vite",
  stories: [
    "../src/components/**/*.stories.@(ts|tsx)",
    "../src/features/**/modals/**/*.stories.@(ts|tsx)",
    "../src/features/cash-plus/**/*.stories.@(ts|tsx)",
  ],
  addons: ["@storybook/addon-a11y"],
};

export default config;
