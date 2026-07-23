// Ambient types for the test runtime. `globals: true` in vitest.config.ts exposes the test
// API (describe/it/expect/vi) without importing it; this reference makes those globals typed.
// jest-dom matcher types are augmented via the `@testing-library/jest-dom/vitest` import in
// tests/setup.ts, so they are not referenced again here.
/// <reference types="vitest/globals" />
