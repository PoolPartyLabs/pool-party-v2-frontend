/**
 * @id PP-TOOLS-SCR-001
 * @name ToolsPage
 * @implements-rules-version v1
 * @analytics-events none directly (PP-TOOLS-CMP-001 emits the tools_hookrisk_* funnel)
 *
 * `/tools`, the developer-tooling surface. Today it holds one tool: the Uniswap v4 hook risk scan.
 *
 * A thin orchestrator per the page blueprint. The flag guard and the client screen, nothing else:
 * this page reads no data on the server, because the thing it shows is produced by a job the client
 * starts and polls through PP-TOOLS-API-001.
 *
 * Guarded SERVER-side, so turning `hookTools` off 404s a deep link rather than only hiding the
 * sidebar entry. That is what makes the flag the removal seam for this hackathon surface.
 */
import { setRequestLocale } from "next-intl/server";
import { HookRiskScreen } from "@/features/tools/HookRiskScreen";
import { requireFeature } from "@/lib/features/requireFeature";

export default async function ToolsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  requireFeature("hookTools");

  return <HookRiskScreen />;
}
