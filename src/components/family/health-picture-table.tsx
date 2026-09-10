/**
 * <HealthPictureTable> — one table per layer, never mixed (X5.1; design
 * §2.3). Server component.
 *
 * Rows are reports, columns are people (brief line 344). The table carries
 * `data-compare-surface` beside `data-card`, which is the one licence for a
 * card to hold cells attributed to different subjects; every cell is its own
 * claim block with its own subject.
 *
 * What this table deliberately cannot do: no `<th>` is a button, nothing
 * carries `aria-sort`, no control on the page changes row or column order,
 * and no cell is derived from another cell. There is no total row, no
 * summary column, no highest, no lowest and no score. People appear in the
 * order the graph resolved them — their own name — and reports in category
 * order, then title.
 */
import { subjectKind, type SubjectBarSubject } from "@/components/subjects/subject-bar";
import {
  BASELINE_ABSENT,
  SAVED_REPORTS_LABEL,
  TABLE_SCROLL_CUE,
  tableCaption,
} from "@/copy/family/health-picture";
import { KIND_CHIPS, fileCount } from "@/copy/reports/strings";
import { categoryLabel, type CategoryId, type FindingLayer } from "@/lib/genome/taxonomy";
import { subjectColourIndex, subjectInitial } from "@/lib/subject-colour";
import { HealthPictureCell, type HealthPictureCellState } from "./health-picture-cell";

/** Literal class names so Tailwind can see every token. */
const DISC_CLASSES = [
  "bg-subject-0",
  "bg-subject-1",
  "bg-subject-2",
  "bg-subject-3",
  "bg-subject-4",
  "bg-subject-5",
  "bg-subject-6",
  "bg-subject-7",
] as const;

export interface HealthPictureColumn {
  /** The record the chip names. */
  subject: SubjectBarSubject;
  /** The subject the letters are read from. */
  dataSubjectId: string;
  displayLabel: string;
  /** Every file in the record; null renders no count at all (a Portrait chip before any file is read). */
  files: number | null;
}

export interface HealthPictureRow {
  key?: string;
  slug: string;
  title: string;
  category: CategoryId | null;
  /** One state per column, in column order. */
  cells: readonly HealthPictureCellState[];
  /** One report link per column, in column order; null where none may render. */
  hrefs: readonly (string | null)[];
}

export interface HealthPictureTableProps {
  layer: FindingLayer;
  columns: readonly HealthPictureColumn[];
  rows: readonly HealthPictureRow[];
  viewerAccountId: string;
  states?: readonly HealthPictureCellState[];
}

export function SubjectChip({
  column,
  viewerAccountId,
}: {
  column: HealthPictureColumn;
  viewerAccountId: string;
}) {
  const kind = subjectKind(column.subject, viewerAccountId);
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        data-slot="subject-disc"
        className={`flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-semibold leading-none text-paper ${DISC_CLASSES[subjectColourIndex(column.subject)]}`}
      >
        {subjectInitial(column.displayLabel)}
      </span>
      <span data-slot="subject-name" className="font-medium text-ink">
        {column.displayLabel}
      </span>
      {kind ? (
        <span
          data-slot="subject-kind"
          className="shrink-0 rounded-full border border-line px-2 py-0.5 text-sm font-normal text-ink-muted"
        >
          {KIND_CHIPS[kind]}
        </span>
      ) : null}
      {column.files === null ? null : (
        // inherit-figure-exempt: a count of files this record holds, not a result
        <span data-slot="subject-files" className="shrink-0 text-sm font-normal text-ink-muted">
          {fileCount(column.files)}
        </span>
      )}
    </span>
  );
}

/**
 * What one cell is a claim about, in the page's own terms: one layer, one
 * report, one person (`data-cell`, read by `e2e/figure-collector.ts`).
 *
 * The person is named the way the reader tells the columns apart — the kind
 * chip above the column and the name beside it — and never by the subject id,
 * which is a fresh uuid on every account and so says nothing when the same
 * journey is walked twice. Two columns that produce the same key are two
 * columns the reader cannot tell apart either, and the same holds for two
 * rows carrying one report slug; the two-seed spec asserts these keys are
 * unique on the page rather than quietly falling back to document order.
 */
export function healthPictureCellId(
  layer: FindingLayer,
  reportKey: string,
  column: HealthPictureColumn,
  viewerAccountId: string,
): string {
  const kind = subjectKind(column.subject, viewerAccountId) ?? "person";
  return `${layer}/${reportKey}/${kind}:${column.displayLabel}`;
}

export function HealthPictureTable({
  layer,
  columns,
  rows,
  viewerAccountId,
  states,
}: HealthPictureTableProps) {
  const captionId = `health-picture-caption-${layer}`;
  const categories = [...new Set(rows.map((row) => row.category))];
  return (
    <div className="space-y-2">
      <p data-slot="table-scroll-cue" className="text-sm text-ink-muted md:hidden">{TABLE_SCROLL_CUE}</p>
      <div className="overflow-x-auto" role="region" aria-labelledby={captionId} tabIndex={0}>
      <table
        data-compare-surface="true"
        data-card={layer}
        data-layer={layer}
        className="w-full border-collapse text-left"
      >
        <caption id={captionId} className="pb-3 text-left text-sm leading-relaxed text-ink-muted">
          {tableCaption(layer)}
        </caption>
        <thead>
          <tr>
            <td className="w-64 min-w-48" />
            {columns.map((column) => (
              <th
                key={column.dataSubjectId}
                scope="col"
                data-subject-id={column.dataSubjectId}
                className="min-w-80 border-b border-line p-2 align-bottom text-base font-medium"
              >
                <SubjectChip column={column} viewerAccountId={viewerAccountId} />
              </th>
            ))}
          </tr>
        </thead>
        {states ? <tbody><tr data-slot="health-picture-column-status">
          <th scope="row" className="border-b border-line p-2 align-top text-base font-normal">{SAVED_REPORTS_LABEL}</th>
          {columns.map((column, index) => <HealthPictureCell key={column.dataSubjectId}
            dataSubjectId={column.dataSubjectId} personName={column.displayLabel} reportTitle={SAVED_REPORTS_LABEL}
            layer={layer} state={states[index]} href={null} captionId={captionId}
            cellId={healthPictureCellId(layer, "saved-reports", column, viewerAccountId)} />)}
        </tr></tbody> : null}
        {categories.map((category) => (
          <tbody key={category ?? "saved-reports"}>
            <tr>
              <th
                scope="rowgroup"
                colSpan={columns.length + 1}
                className="border-b border-line pt-6 pb-2 text-sm font-medium text-ink-muted"
              >
                {category === null ? SAVED_REPORTS_LABEL : categoryLabel(category)}
              </th>
            </tr>
            {rows
              .filter((row) => row.category === category)
              .map((row) => (
                <tr key={row.key ?? row.slug} data-slot="health-picture-row" data-report-slug={row.slug}>
                  <th
                    scope="row"
                    className="border-b border-line p-2 align-top text-base font-normal text-ink"
                  >
                    {row.title}
                  </th>
                  {columns.map((column, index) => (
                    <HealthPictureCell
                      key={column.dataSubjectId}
                      dataSubjectId={column.dataSubjectId}
                      personName={column.displayLabel}
                      reportTitle={row.title}
                      layer={layer}
                      state={row.cells[index]}
                      href={row.hrefs[index]}
                      captionId={captionId}
                      cellId={healthPictureCellId(layer, row.slug, column, viewerAccountId)}
                    />
                  ))}
                </tr>
              ))}
          </tbody>
        ))}
        <tfoot>
          <tr>
            <td />
            {columns.map((column) => (
              <td
                key={column.dataSubjectId}
                data-slot="column-footer"
                data-subject-id={column.dataSubjectId}
                className="min-w-80 p-2 align-top text-sm leading-relaxed text-ink"
              >
                {BASELINE_ABSENT}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
      </div>
    </div>
  );
}
