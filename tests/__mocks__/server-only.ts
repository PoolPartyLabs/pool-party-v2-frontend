// Noop mock for the "server-only" package. In Next.js, importing "server-only"
// throws at build time if the module is bundled into a client component. In Vitest
// there is no client/server boundary, so this alias is a safe noop.
export {};
