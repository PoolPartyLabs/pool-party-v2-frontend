/**
 * @id PP-MGR-CMP-082 (POO-2183)
 * @name FallbackReview
 * @implements-rules-version v1
 * @i18n-namespace manager
 */
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { Button } from "@/components/ui/Button";
import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import { isMockMode } from "@/lib/services";
import { useV2MandateCatalog } from "../../useV2MandateCatalog";
import { type FundLaunchDraft, startFundLaunch, useV2ReviewDraft } from "../index";
import { validateLogo } from "../review";
import {
  applyFallbackExecutionAtLaunch,
  type FallbackEdits,
  fallbackBlocks,
  fallbackLaunchPreview,
  hasPanelSettings,
  resolveFallbackSettings,
} from "./execution";

export function FallbackReview({ draftId }: { draftId: string }) {
  const translate = useTranslations("manager");
  const { isEnabled } = useFeatureFlags();
  if (isMockMode || !isEnabled("fundContracts"))
    return <p role="alert">{translate("fundLaunch.realOnly")}</p>;
  return <RealFallbackReview key={draftId} draftId={draftId} />;
}

function RealFallbackReview({ draftId }: { draftId: string }) {
  // PP-INTEGRATION-POINT: POO-2177 owns Review persistence, seed preview, validation and staged upload.
  const binding = useV2ReviewDraft(draftId);
  const catalog = useV2MandateCatalog();
  const translate = useTranslations("manager");
  const [edits, setEdits] = useState<FallbackEdits>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(false);
  const [logoInvalid, setLogoInvalid] = useState(false);
  const [feeText, setFeeText] = useState<Record<string, string>>({});
  const feeValid = (field: string, value: string) => {
    if (!/^\d{1,3}(\.\d{0,2})?$/.test(value)) return false;
    const bps = parseUnits(value, 2);
    const minimum = field === "performanceFeeBps" ? 1000 : 0;
    const maximum =
      field === "performanceFeeBps" ? 9000 : field === "managementFeeBps" ? 500 : 1000;
    return bps >= BigInt(minimum) && bps <= BigInt(maximum);
  };
  const feeInputInvalid = Object.entries(feeText).some(([field, value]) => !feeValid(field, value));
  if (!binding.draft) return <p role="status">{translate("fallbackReview.draftUnavailable")}</p>;
  const draft = { ...binding.draft, review: binding.review } as FundLaunchDraft;
  const base = catalog.depositTokenFor("arbitrum");
  const baseAssetKey = base ? `arbitrum:${base.address.toLowerCase()}` : undefined;
  const preview = draft.plan
    ? fallbackLaunchPreview(draft, edits, baseAssetKey)
    : { steps: [], blockers: ["BUILD_EXECUTION_GAP"] };
  const blockers = binding.launchBlockers.filter(
    (blocker) => blocker.code !== "BUILD_EXECUTION_GAP",
  );
  const catalogInvalid = catalog.loading || catalog.error || !catalog.validateDraft?.(draft);
  const disabled =
    busy ||
    binding.uploading ||
    !binding.manager ||
    catalogInvalid ||
    feeInputInvalid ||
    logoInvalid ||
    blockers.length > 0 ||
    preview.blockers.length > 0;
  const signatureCount = preview.steps.filter((step) => step.countsAsSignature).length;
  const editBlock = (blockId: string, patch: FallbackEdits[string]) =>
    setEdits((current) => ({ ...current, [blockId]: { ...current[blockId], ...patch } }));
  const launch = async () => {
    if (disabled) return;
    setBusy(true);
    setFailure(false);
    try {
      // PP-INTEGRATION-POINT: only the explicit launch action freezes defaults into the journey snapshot.
      await startFundLaunch(applyFallbackExecutionAtLaunch(draft, edits, baseAssetKey));
    } catch {
      setFailure(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <h1>{translate("fallbackReview.title")}</h1>
      <fieldset disabled={busy || binding.uploading} className="flex flex-col gap-3">
        <legend>{translate("fallbackReview.identity")}</legend>
        <label>
          {translate("fallbackReview.name")}
          <input
            value={binding.review.name}
            minLength={10}
            maxLength={50}
            onChange={(event) => binding.setField("name", event.target.value)}
          />
        </label>
        <label>
          {translate("fallbackReview.description")}
          <textarea
            value={binding.review.description}
            maxLength={280}
            onChange={(event) => binding.setField("description", event.target.value)}
          />
        </label>
        <label>
          {translate("fallbackReview.logo")}
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setLogoInvalid(false);
              try {
                validateLogo(file);
                await binding.uploadLogo(file);
              } catch {
                setLogoInvalid(true);
              }
            }}
          />
        </label>
        {binding.review.imageUrl ? <p>{binding.review.imageUrl}</p> : null}
        {logoInvalid || binding.uploadError ? (
          <p role="alert">{translate("fundLaunch.uploadFailed")}</p>
        ) : null}
        {(["performanceFeeBps", "managementFeeBps", "payoutFeeBps"] as const).map((field) => (
          <label key={field}>
            {translate(`fallbackReview.${field}`)}
            <input
              type="text"
              inputMode="decimal"
              value={feeText[field] ?? formatUnits(BigInt(binding.review[field]), 2)}
              onChange={(event) => {
                const value = event.target.value.replace(",", ".");
                setFeeText((current) => ({ ...current, [field]: value }));
                if (feeValid(field, value)) binding.setField(field, Number(parseUnits(value, 2)));
              }}
            />
          </label>
        ))}
        <p>{translate("fallbackReview.feeTerms")}</p>
        <label>
          {translate("fallbackReview.minimum")}
          <input
            inputMode="decimal"
            value={binding.review.minimum}
            onChange={(event) => binding.setField("minimum", event.target.value)}
          />
        </label>
        <label>
          {translate("fallbackReview.seed")}
          <input
            inputMode="decimal"
            value={binding.review.seed}
            onChange={(event) => binding.setField("seed", event.target.value)}
          />
        </label>
        <p aria-live="polite">
          {translate("fallbackReview.balance", { amount: binding.balanceDecimal ?? "?" })}
        </p>
        <Button variant="secondary" onClick={binding.setMax}>
          {translate("fallbackReview.max")}
        </Button>
        <Button
          variant="secondary"
          onClick={() => void binding.refreshBalance().catch(() => setFailure(true))}
        >
          {translate("fallbackReview.refresh")}
        </Button>
      </fieldset>
      <p>
        {translate("fallbackReview.investorTerms", {
          hours: binding.terms.payoutHours,
          cash: binding.terms.operatingCash,
        })}
      </p>
      <p aria-live="polite">
        {binding.preview
          ? translate("fallbackReview.seedPreview", {
              shares: binding.preview.shares.toString(),
              principal: formatUnits(binding.preview.principal, 6),
              fee: formatUnits(binding.preview.fee, 6),
              remainder: formatUnits(binding.preview.remainder, 6),
            })
          : translate("fundLaunch.validation")}
      </p>
      <p>
        {translate("fallbackReview.flowFee", {
          fee: formatUnits(BigInt(binding.feeConfiguration.flowFeeBps), 2),
        })}{" "}
        {binding.feeConfiguration.flowSource === "fallback"
          ? translate("fallbackReview.feeFallback")
          : null}
      </p>
      <fieldset disabled={busy} className="flex flex-col gap-3">
        <legend>{translate("fallbackReview.execution")}</legend>
        {draft.plan
          ? fallbackBlocks(draft).map((block) => {
              const readOnly = hasPanelSettings(block);
              let settings = block.config ?? {};
              try {
                settings = resolveFallbackSettings(draft, block, edits[block.id], baseAssetKey);
              } catch {
                settings = { ...settings, ...edits[block.id] };
              }
              return (
                <div key={block.id}>
                  <h2>
                    {block.id} · {block.kind} · {block.network}
                  </h2>
                  {readOnly || block.family !== "position" ? (
                    <>
                      <p>{translate("fallbackReview.panelWins")}</p>
                      <pre>{JSON.stringify(block.config ?? {}, null, 2)}</pre>
                    </>
                  ) : block.kind === "uniswapV4Pool" ? (
                    <>
                      <label>
                        {translate("fallbackReview.pool")}
                        <select
                          value={settings.poolId ?? ""}
                          onChange={(event) => editBlock(block.id, { poolId: event.target.value })}
                        >
                          <option value="">{translate("fallbackReview.select")}</option>
                          {draft.pools
                            .filter((pool) => pool.network === block.network)
                            .map((pool) => (
                              <option key={pool.id} value={pool.poolId}>
                                {pool.poolId}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={settings.fullRange !== false}
                          onChange={(event) =>
                            editBlock(block.id, { ...settings, fullRange: event.target.checked })
                          }
                        />
                        {translate("fallbackReview.fullRange")}
                      </label>
                      {(["tickLower", "tickUpper"] as const).map((field) => (
                        <label key={field}>
                          {translate(`fallbackReview.${field}`)}
                          <input
                            type="number"
                            disabled={settings.fullRange !== false}
                            value={Number.isFinite(settings[field]) ? settings[field] : ""}
                            onChange={(event) =>
                              editBlock(block.id, {
                                [field]:
                                  event.target.value === "" ? NaN : Number(event.target.value),
                              })
                            }
                          />
                        </label>
                      ))}
                      <label>
                        {translate("fallbackReview.slippage")}
                        <input
                          type="number"
                          min={0.1}
                          max={5}
                          step={0.1}
                          value={Number.isFinite(settings.slippagePct) ? settings.slippagePct : ""}
                          onChange={(event) =>
                            editBlock(block.id, {
                              slippagePct:
                                event.target.value === "" ? NaN : Number(event.target.value),
                            })
                          }
                        />
                      </label>
                    </>
                  ) : block.kind === "aaveSupply" ? (
                    <label>
                      {translate("fallbackReview.asset")}
                      <select
                        value={settings.assetKey ?? ""}
                        onChange={(event) => editBlock(block.id, { assetKey: event.target.value })}
                      >
                        <option value="">{translate("fallbackReview.select")}</option>
                        {draft.tokens
                          .filter(
                            (token) =>
                              token.network === block.network &&
                              draft.aaveV3Reserves?.includes(token.address.toLowerCase()),
                          )
                          .map((token) => (
                            <option
                              key={token.address}
                              value={`${token.network}:${token.address.toLowerCase()}`}
                            >
                              {token.network}:{token.address.toLowerCase()}
                            </option>
                          ))}
                      </select>
                    </label>
                  ) : (
                    <p>{translate("fallbackReview.executionBlocked")}</p>
                  )}
                </div>
              );
            })
          : null}
      </fieldset>
      {catalogInvalid ? (
        <p role="alert">
          {translate("fallbackReview.catalogUnavailable")}{" "}
          <Button onClick={catalog.retry}>{translate("fallbackReview.refresh")}</Button>
        </p>
      ) : null}
      <ul aria-live="polite">
        {!binding.manager ? <li>{translate("fundLaunch.walletOrJournal")}</li> : null}
        {blockers.map((blocker) => (
          <li key={`${blocker.code}-${blocker.field ?? ""}`}>{translate(blocker.messageKey)}</li>
        ))}
        {preview.blockers.map((blocker) => (
          <li key={blocker}>{translate("fallbackReview.executionBlocked")}</li>
        ))}
        {feeInputInvalid ? <li>{translate("fundLaunch.validation")}</li> : null}
      </ul>
      <ol>
        {preview.steps.map((step) => (
          <li key={step.id}>
            {translate(`fundLaunch.${step.kind}`)} · {step.chainId}
          </li>
        ))}
      </ol>
      {failure ? <p role="alert">{translate("fallbackReview.launchFailed")}</p> : null}
      <Button disabled={disabled} loading={busy} onClick={() => void launch()}>
        {translate("fallbackReview.launch", { count: signatureCount })}
      </Button>
    </section>
  );
}
