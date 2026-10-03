import type { StorybookConfig } from "@storybook/nextjs-vite";

/**
 * Storybook 10 (nextjs-vite framework), SETUP-007 (Linear POO-53).
 * Restricted scope: stories live next to design-system components and feature modals.
 * Cash+ adds a scoped page-state workbench for its dedicated demo and transaction sheets.
 *
 * POO-2119: the fund-contracts builder keeps its components in `manager/fund/components/`, its step
 * bodies in `manager/fund/steps/` and its phase screens in `manager/fund/`, none of which the globs
 * above reach, so one scoped glob covers the folder. Without it every Mandate story would be
 * written and reviewed while Storybook silently picked up none of them.
 */
const config: StorybookConfig = {
  framework: "@storybook/nextjs-vite",
  stories: [
    "../src/components/**/*.stories.@(ts|tsx)",
    "../src/features/**/modals/**/*.stories.@(ts|tsx)",
    "../src/features/cash-plus/**/*.stories.@(ts|tsx)",
    "../src/features/manager/fund/**/*.stories.@(ts|tsx)",
  ],
  addons: ["@storybook/addon-a11y"],
};

export default config;
