/**
 * @id PP-ADM-AUTH-001
 * @name admin host gate
 * @implements-rules-version v1
 *
 * The Admin Console is served only on the `adm.` host and lives under the `/admin` path segment
 * (POO-144 R2). This pure helper decides — from host + pathname alone — whether a request may be
 * served: the `adm.` host may serve ONLY `/admin` paths, and every other host may serve NONE. The
 * middleware calls {@link adminHostGate}, skipping local dev via {@link isLocalHost}. No Next or
 * request types here, so it stays unit-testable.
 */

/** Subdomain prefix that identifies the admin host, e.g. `adm.pool-party.xyz`. */
export const ADMIN_HOST_PREFIX = "adm.";
/** URL path segment under which all admin routes live, e.g. `/admin/overview`. */
export const ADMIN_PATH_SEGMENT = "admin";

/** True when the (optionally port-suffixed) host begins with the admin subdomain. */
export function isAdminHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  return hostname.startsWith(ADMIN_HOST_PREFIX);
}

/** True for `/admin`, `/admin/...`, `/<locale>/admin`, or `/<locale>/admin/...`. */
export function isAdminPath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === ADMIN_PATH_SEGMENT) return true;
  return segments.length >= 2 && segments[1] === ADMIN_PATH_SEGMENT;
}

/** True for localhost / loopback / *.local — dev hosts where the host gate is not enforced. */
export function isLocalHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".local")
  );
}

/**
 * Serve or block. Allowed exactly when "host is admin" agrees with "path is admin": the `adm.` host
 * serves only `/admin`, non-admin hosts serve only non-`/admin`. Any mismatch is blocked.
 */
export function adminHostGate(
  host: string | null | undefined,
  pathname: string,
): "allow" | "block" {
  return isAdminHost(host) === isAdminPath(pathname) ? "allow" : "block";
}
