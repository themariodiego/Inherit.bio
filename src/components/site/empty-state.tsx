import { cn } from "@/lib/utils";

/**
 * The one empty state for the whole product: an inset surface that carries
 * one sentence — or a short title and a sentence — and at most one action.
 * It is never a second headline, never a dashed box, never developer copy,
 * and it does not repeat a sentence the page already says. It sits on the
 * reading measure on every page, so one empty state has one width. A heading the
 * route pins stays a heading: pass it as `title`, set in the `.title` role
 * (`<h2 className="title">…</h2>`), so the page keeps one display voice.
 * `ground` is a decorative layer (the terrain) drawn under the content:
 * absolutely positioned, aria-hidden, no pointer events, never adding to
 * the box's height.
 */
export function EmptyState({
  title,
  children,
  action,
  ground,
  className,
}: {
  title?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
  ground?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="empty-state"
      data-ground={ground ? "" : undefined}
      className={cn("surface-inset max-w-measure p-4 min-[360px]:p-6", ground && "relative overflow-hidden", className)}
    >
      {ground ? (
        <div aria-hidden="true" data-slot="empty-state-ground" className="pointer-events-none absolute inset-0">
          {ground}
        </div>
      ) : null}
      <div className={cn("max-w-measure space-y-3", ground && "relative")}>
        {title ? <div className="title text-ink">{title}</div> : null}
        <div className="text-ink">{children}</div>
        {action ? <div className="pt-2">{action}</div> : null}
      </div>
    </div>
  );
}
