/**
 * Library entry point.
 *
 * hookrisk is primarily a CLI, but the scoring engine and the rubric loader are
 * useful on their own — a dashboard that wants to score a hook from a manifest
 * should not have to shell out.
 */

export * from './types.js';
export * from './errors.js';
export * from './config.js';
export * from './manifest.js';
export * from './sarif.js';
export { createLogger, type Logger, type LogFields, type LogLevel } from './log.js';
export { resolveHome, homeCandidates, type HookriskHome } from './home.js';
export { mergeEngineResults, makeFindingId } from './engines/dedupe.js';
export { SlitherEngine } from './engines/slither.js';
export { BlockSecEngine } from './engines/blocksec.js';
export { loadRubric, strengthRank } from './scoring/rubric.js';
export { score, evaluateCondition } from './scoring/score.js';
export { deriveScoringInput } from './scoring/derive.js';
