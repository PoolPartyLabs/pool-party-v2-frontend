import "@testing-library/jest-dom/vitest";

// PP-NOTE: the global next-intl mock is added in SETUP-005 (next-intl), once the
// package and routing exist. Until then, components using `useTranslations` should
// be tested with a local mock or via renderWithProviders once the provider lands.
