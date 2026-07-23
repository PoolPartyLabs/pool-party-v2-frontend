/**
 * @id PP-MGR-LIB-presets
 * @name presets
 *
 * Standardized manager range presets (±%), shared by the strategy builder's range editor
 * (Build step) and the Move Range modal so both offer the same quick options (POO-339).
 */

/** Symmetric range presets (±%) centered on the current price. Full-range is a separate mode. */
export const RANGE_PRESETS = [5, 10, 20] as const;
