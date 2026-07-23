/**
 * @id PP-MGR-CMP-030
 * @name CommentsCard
 * @implements-rules-version v1
 *
 * The manage-detail "Comments" card (Figma `5526:922`, POO-277): the strategy's investor comment
 * threads as the manager sees them (1 thread = 1 investor, private). V1 is a READ-ONLY preview — it
 * shows the latest threads (author, amount invested, message, the manager's reply when present, and an
 * unread marker) plus a "View all (N)" count; the per-thread reply composer is a follow-up. Threads
 * are PP-MOCK until the comments backend exists (see {@link mapManagerStrategyDetail} / the mock data).
 */
"use client";

import { useLocale, useTranslations } from "next-intl";
import { CollapsibleCard } from "@/components/ui/CollapsibleCard";
import type { ManagerComment } from "@/lib/schemas";
import { formatUsd } from "@/lib/utils/format";

/** How many threads the preview shows before "View all". */
const PREVIEW_COUNT = 3;

/** Public props for {@link CommentsCard}. */
export interface CommentsCardProps {
  /** Latest investor comment threads, newest first. */
  comments: ManagerComment[];
  /** Total thread count for the "View all" link; defaults to the preview length. */
  total?: number;
}

/** Avatar bubble with the author's initial. */
function Avatar({ name }: { name: string }) {
  return (
    <span
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-raised font-medium text-foreground text-xs"
      aria-hidden="true"
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/** The investor-comments card (read-only preview). */
export function CommentsCard({ comments, total }: CommentsCardProps) {
  const t = useTranslations("manager");
  const locale = useLocale();
  const dateFormat = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  const unreadCount = comments.filter((comment) => comment.unread).length;
  const shown = comments.slice(0, PREVIEW_COUNT);
  const totalCount = total ?? comments.length;

  const aside = (
    <span className="flex flex-wrap items-center gap-2">
      <span className="rounded-full bg-surface-raised px-2 py-0.5 text-muted-foreground text-xs">
        {t("manage.comments.private")}
      </span>
      {unreadCount > 0 ? (
        <span className="rounded-full bg-primary/15 px-2 py-0.5 font-medium text-primary text-xs">
          {t("manage.comments.new", { count: unreadCount })}
        </span>
      ) : null}
      {totalCount > shown.length ? (
        <span className="text-muted-foreground text-xs">
          {t("manage.comments.viewAll", { count: totalCount })}
        </span>
      ) : null}
    </span>
  );

  return (
    <CollapsibleCard title={t("manage.comments.title")} aside={aside}>
      {comments.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("manage.comments.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-5">
          {shown.map((comment) => (
            <li key={comment.id} className="flex flex-col gap-2">
              <div className="flex items-start gap-3">
                <Avatar name={comment.author} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="flex items-center gap-1.5 font-medium text-foreground text-sm">
                      {comment.unread ? (
                        <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
                      ) : null}
                      {comment.author}
                    </span>
                    {comment.investedUsd !== undefined ? (
                      <span className="text-muted-foreground text-xs">
                        {t("manage.comments.invested", { amount: formatUsd(comment.investedUsd) })}
                      </span>
                    ) : null}
                    <span className="ml-auto text-muted-foreground text-xs">
                      {dateFormat.format(new Date(comment.timestamp))}
                    </span>
                  </div>
                  <p className="text-foreground text-sm">{comment.text}</p>
                </div>
              </div>

              {comment.reply ? (
                <div className="ml-10 flex items-start gap-3 rounded-lg bg-surface-raised p-3">
                  <Avatar name={comment.reply.author} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-medium text-foreground text-sm">
                        {comment.reply.author}
                      </span>
                      <span className="rounded-full bg-primary/15 px-1.5 py-0.5 font-medium text-primary text-[10px]">
                        {t("manage.comments.managerBadge")}
                      </span>
                      <span className="ml-auto text-muted-foreground text-xs">
                        {dateFormat.format(new Date(comment.reply.timestamp))}
                      </span>
                    </div>
                    <p className="text-foreground text-sm">{comment.reply.text}</p>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </CollapsibleCard>
  );
}
