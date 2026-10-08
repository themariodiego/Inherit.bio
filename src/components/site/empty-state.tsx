import { cn } from "@/lib/utils";

/**
 * The one empty state for the whole product: an inset surface that carries
 * one sentence — or a short title and a sentence — and at most one action.
 * It is never a second headline, never a dashed box, never developer copy,
 * and it does not repeat a sentence the page already says. It sits on the
 * reading measure on every page, so one empty state has one width. A heading the
 * route pins stays a heading: pass it as `title`, set in the `.title` role
 * (`<h2 className="title">…</h2>`), so the page keeps one display voice.
 */
export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div data-slot="empty-state" className={cn("surface-inset max-w-measure p-4 min-[360px]:p-6", className)}>
      <div className="max-w-measure space-y-3">
        {title ? <div className="title text-ink">{title}</div> : null}
        <div className="text-ink">{children}</div>
        {action ? <div className="pt-2">{action}</div> : null}
      </div>
    </div>
  );
}
