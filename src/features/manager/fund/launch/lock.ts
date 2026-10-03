/**
 * @id PP-MGR-STO-002 (POO-2172)
 * @name launchJournalLock
 * @implements-rules-version v1
 * Cross-tab exclusive launch ownership. Unsupported browsers fail closed.
 */
export async function withLaunchLock<Data>(key: string, work: () => Promise<Data>): Promise<Data> {
  if (!navigator.locks) throw new Error("LAUNCH_LOCK_UNAVAILABLE");
  return navigator.locks.request(key, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error("LAUNCH_ALREADY_RUNNING");
    return work();
  });
}
