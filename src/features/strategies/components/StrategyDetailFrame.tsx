/**
 * @id PP-STR-CMP-039
 * @name StrategyDetailFrame
 * @implements-rules-version v1 (POO-2216)
 * @analytics-events none, presentation only; the owning screen emits views
 */

import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";

export function StrategyDetailFrame({
  backHref,
  backLabel,
  children,
  rail,
  flows,
}: {
  backHref: string;
  backLabel: string;
  children: ReactNode;
  rail: ReactNode;
  flows?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <Link
        href={backHref}
        className="inline-flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        {backLabel}
      </Link>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">{children}</div>
        <aside className="hidden min-w-0 lg:col-span-1 lg:block">
          <div className="sticky top-6 flex flex-col gap-4">{rail}</div>
        </aside>
      </div>
      {flows}
    </div>
  );
}
