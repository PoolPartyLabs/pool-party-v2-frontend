/**
 * @id PP-MGR-CMP-073 (POO-2188)
 * @name ReviewIdentityCard
 * @implements-rules-version v1
 * @analytics-events none: the Review page emits field events.
 * @i18n-namespace manager
 * Editable profile fields and validated, cropped PNG logo upload.
 */
"use client";
import { ImageIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ImageCropModal } from "@/components/ui/ImageCropModal";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils/cn";
import { validateLogo } from "../launch/review";
import { dataUrlToFile, nameLength } from "./reviewForm";
export interface ReviewIdentityCardProps {
  /** Public strategy name. */ name: string;
  /** Optional plain-text description. */ description: string;
  /** Saved HTTPS upload URL. */ imageUrl: string;
  /** Parent upload state. */ uploading?: boolean;
  /** Already translated parent upload error. */ uploadError?: string;
  /** Already translated name reason. */ nameError?: string;
  /** Already translated description reason. */ descriptionError?: string;
  /** Controlled name edit. */ onNameChange: (value: string) => void;
  /** Controlled description edit. */ onDescriptionChange: (value: string) => void;
  /** Receives only validated cropped PNG. */ onUploadLogo: (file: File) => Promise<unknown>;
  /** Additional classes. */ className?: string;
}
export function ReviewIdentityCard({
  name,
  description,
  imageUrl,
  uploading = false,
  uploadError,
  nameError,
  descriptionError,
  onNameChange,
  onDescriptionChange,
  onUploadLogo,
  className,
}: ReviewIdentityCardProps) {
  const t = useTranslations("manager");
  const common = useTranslations("common");
  const locale = useLocale();
  const number = new Intl.NumberFormat(locale);
  const fileInput = useRef<HTMLInputElement>(null);
  const pickVersion = useRef(0);
  const [crop, setCrop] = useState<string | null>(null);
  const [cropped, setCropped] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const pick = (file: File | undefined) => {
    if (!file) return;
    try {
      validateLogo(file);
    } catch {
      setFailed(t("fundBuilder.review.validation.logoInvalid"));
      return;
    }
    setFailed(null);
    const version = ++pickVersion.current;
    const reader = new FileReader();
    reader.onload = () => {
      if (version === pickVersion.current && typeof reader.result === "string")
        setCrop(reader.result);
    };
    reader.onerror = () => setFailed(t("fundBuilder.review.logoFailed"));
    reader.readAsDataURL(file);
  };
  const apply = async (url: string) => {
    const file = dataUrlToFile(url);
    setCrop(null);
    if (!file) {
      setFailed(t("fundBuilder.review.validation.logoInvalid"));
      return;
    }
    setCropped(url);
    setBusy(true);
    setFailed(null);
    setDone(false);
    try {
      await onUploadLogo(file);
      setDone(true);
    } catch {
      setFailed(t("fundBuilder.review.logoFailed"));
    } finally {
      setBusy(false);
    }
  };
  const loading = uploading || busy;
  const image = cropped ?? imageUrl;
  return (
    <Card className={cn("flex flex-col gap-4 rounded-[20px] p-4", className)}>
      <div>
        <h3 className="text-sm font-medium">{t("fundBuilder.review.identityTitle")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("fundBuilder.review.identityCaption")}
        </p>
      </div>
      <div id="review-imageUrl" tabIndex={-1} className="flex items-center gap-4">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-dashed border-border bg-surface-raised">
          {image ? (
            // biome-ignore lint/performance/noImgElement: crop previews use local data URLs.
            <img src={image} alt={name} className="size-full object-cover" />
          ) : (
            <ImageIcon className="size-5 text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        <div className="space-y-1">
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg"
            aria-label={t("mandate.logoAdd")}
            className="hidden"
            onChange={(event) => {
              pick(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full"
            type="button"
            disabled={loading}
            onClick={() => fileInput.current?.click()}
          >
            {t(image ? "mandate.logoChange" : "mandate.logoAdd")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("fundBuilder.review.logoHelp")}</p>
          <div aria-live="polite">
            {loading && (
              <p className="text-xs text-muted-foreground">{t("mandate.logoUploading")}</p>
            )}
            {!loading && (failed || uploadError) && (
              <p role="alert" className="text-xs text-destructive">
                {failed ?? uploadError}
              </p>
            )}
            {!loading && !failed && !uploadError && done && (
              <p className="text-xs text-success">{t("fundBuilder.review.logoDone")}</p>
            )}
          </div>
        </div>
      </div>
      <div>
        <Input
          id="review-name"
          label={t("mandate.nameLabel")}
          value={name}
          size="lg"
          className="rounded-xl"
          onChange={(event) => onNameChange(event.target.value)}
          error={nameError}
          description={t("fundBuilder.review.nameHelp")}
        />
        <p className="mt-1 text-right font-mono text-xs tabular-nums text-muted-foreground">
          {number.format(nameLength(name))} / {number.format(50)}
        </p>
      </div>
      <div>
        <label htmlFor="review-description" className="mb-2 block text-sm font-medium">
          {t("fundBuilder.review.descriptionLabel")}
        </label>
        <textarea
          id="review-description"
          value={description}
          rows={3}
          aria-invalid={!!descriptionError}
          aria-describedby={descriptionError ? "review-description-error" : undefined}
          onChange={(event) => onDescriptionChange(event.target.value)}
          className="w-full rounded-xl border border-border bg-input p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="mt-1 text-right font-mono text-xs tabular-nums text-muted-foreground">
          {number.format(description.length)} / {number.format(280)}
        </p>
        {descriptionError && (
          <p role="alert" id="review-description-error" className="text-xs text-destructive">
            {descriptionError}
          </p>
        )}
      </div>
      <ImageCropModal
        open={crop !== null}
        onOpenChange={(open) => {
          if (!open) setCrop(null);
        }}
        src={crop ?? ""}
        aspect={1}
        outputWidth={512}
        round
        title={t("mandate.logoCropTitle")}
        zoomLabel={t("fundBuilder.review.cropZoom")}
        applyLabel={t("fundBuilder.review.cropApply")}
        cancelLabel={common("cancel")}
        onApply={(url) => void apply(url)}
      />
    </Card>
  );
}
