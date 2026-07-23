/**
 * @name useHasMounted
 * @implements-rules-version v1
 *
 * Returns false on the server and the first client render, then true after mount. Use it to defer a
 * client-only value (e.g. the user's local clock) so the first client render matches the server HTML
 * and React does not warn about a hydration mismatch; the real value appears right after mount.
 */
"use client";

import { useEffect, useState } from "react";

/** True once the component has mounted on the client. */
export function useHasMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}
