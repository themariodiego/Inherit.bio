import { Terrain } from "@/components/site/terrain";
import { cn } from "@/lib/utils";

/**
 * <RecordHead> — the one head of a subject's record pages (round-1 M2, M3,
 * M7, m12): breadcrumbs, the subject bar, then a card carrying the display
 * h1, the page's state sentence (or its controls) and its one forest action.
 *
 * `empty` draws the terrain along the card's bottom edge: the no-file state
 * designed once and used on the hub, Reports, Data, the browser and Files.
 * With a file the same card renders without the hills. Server component; it
 * adds no string of its own — the title, the sentence and the action are the
 * page's existing copy. Styles: records.css `.rec-record-*`.
 */
export function RecordHead({
  crumbs,
  bar,
  title,
  children,
  action,
  empty = false,
  seed = 11,
  className,
}: {
  /** The page's <Breadcrumbs>, when it has one. */
  crumbs?: React.ReactNode;
  /** The page's <SubjectBar>, when it has one. */
  bar?: React.ReactNode;
  /** The h1 text. */
  title: React.ReactNode;
  /** The state sentence, the lede, the count lines or the one search form. */
  children?: React.ReactNode;
  /** The page's one forest action, already a <Button>. */
  action?: React.ReactNode;
  /** No file in the record: the hills draw along the card's bottom edge. */
  empty?: boolean;
  /** Which hills; two heads on different pages may share one. */
  seed?: number;
  className?: string;
}) {
  return (
    <div className={cn("rec-record-head", className)}>
      {crumbs}
      {bar}
      {/* The card is the page's header element: the count lines and the
          layer disclosure a page passes as children stay inside `main header`,
          which the report specs read. */}
      <header
        data-slot="record-head"
        data-state={empty ? "empty" : "ready"}
        className="surface rec-record-card"
      >
        <div className="rec-record-body">
          <h1 className="display">{title}</h1>
          {children}
          {action ? <div data-slot="record-action">{action}</div> : null}
        </div>
        {empty ? (
          <div aria-hidden="true" className="rec-record-terrain">
            <Terrain variant="band" seed={seed} />
          </div>
        ) : null}
      </header>
    </div>
  );
}
