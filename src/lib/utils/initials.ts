/**
 * @id PP-CORE-LIB-INITIALS (POO-713)
 * @name initialsFor
 * @implements-rules-version v1
 *
 * Up-to-two-letter avatar initials from a name (a strategy or manager). One word → its first two
 * letters; multiple words → the first letter of the first two words; empty/blank → "?". Domain-neutral
 * so both the investor surfaces and the Manager Console can share it (drives the {@link StrategyLogo}
 * monogram fallback and the manager-row `initials`). Relocated here from the manager view model so a
 * shared UI component never has to depend on a feature module.
 */

/** Up-to-two-letter avatar initials from a name. */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return (words[0]?.slice(0, 2) ?? "?").toUpperCase();
  return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
}
