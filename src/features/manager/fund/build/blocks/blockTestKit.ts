/**
 * @id PP-MGR-LIB-024
 * @name blockTestKit
 * @implements-rules-version v1 (POO-2155 rules v1)
 * @analytics-events none, test and story support: it builds data and emits nothing.
 *
 * TEST AND STORY SUPPORT for the blocks folder, as `planTestKit` is for the plan folder: the English
 * copy through next-intl's own translator (so a test reads the real strings, ICU placeholders
 * filled), and the describe and menu contexts over the S1 test draft. Nothing in the app imports it.
 */
import { createTranslator } from "next-intl";
import enManager from "@/i18n/messages/en/manager.json";
import { buildMandateCatalog, type MandateCatalog } from "../../mandateCatalog";
import type { MandateDraft } from "../../mandateDraft";
import type { BuildPlan } from "../plan/buildPlan";
import { validatePlan } from "../plan/planInvariants";
import { makeTestDraft } from "../plan/planTestKit";
import { type BlockCopy, type ManagerTranslate, makeBlockCopy } from "./blockCopy";
import type { DescribeContext } from "./blockRegistry";

const translator = createTranslator({
  locale: "en",
  messages: { manager: enManager },
  namespace: "manager",
});

/** The block copy in English. */
export function makeTestCopy(): BlockCopy {
  const t: ManagerTranslate = (key, values) =>
    (translator as unknown as ManagerTranslate)(key, values);
  return makeBlockCopy(t, "en");
}

/** One shared catalog: `buildMandateCatalog` returns equal lists on every call. */
export const TEST_CATALOG: MandateCatalog = buildMandateCatalog();

/** A describe (and menu) context over a plan, its violations computed against the draft. */
export function makeDescribeContext(
  plan: BuildPlan,
  draft: MandateDraft = makeTestDraft(),
  catalog: MandateCatalog = TEST_CATALOG,
): DescribeContext & { catalog: MandateCatalog } {
  return {
    plan,
    draft,
    catalog,
    violations: validatePlan(plan, { draft, catalog }),
    copy: makeTestCopy(),
  };
}

/** The catalog with Aave v3 also offered on Robinhood Chain: the reference canvases draw Aave on
 *  spokes (list driven), and the "Aave v3 · {network}" caption needs one. */
export function catalogWithAaveOnSpoke(): MandateCatalog {
  return {
    ...TEST_CATALOG,
    protocols: TEST_CATALOG.protocols.map((protocol) =>
      protocol.id === "aave-v3"
        ? { ...protocol, availableOn: ["arbitrum", "robinhood"] }
        : protocol,
    ),
  };
}
