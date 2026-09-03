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
  files: number;
}

export interface HealthPictureRow {
  slug: string;
  title: string;
  category: CategoryId;
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
      {/* inherit-figure-exempt: a count of files this record holds, not a result */}
      <span data-slot="subject-files" className="shrink-0 text-sm font-normal text-ink-muted">
        {fileCount(column.files)}
      </span>
    </span>
  );
}

export function HealthPictureTable({
  layer,
  columns,
  rows,
  viewerAccountId,
}: HealthPictureTableProps) {
  const captionId = `health-picture-caption-${layer}`;
  const categories = [...new Set(rows.map((row) => row.category))];
  return (
    <div className="overflow-x-auto">
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
            <td className="w-64" />
            {columns.map((column) => (
              <th
                key={column.dataSubjectId}
                scope="col"
                data-subject-id={column.dataSubjectId}
                className="border-b border-line p-2 align-bottom text-base font-medium"
              >
                <SubjectChip column={column} viewerAccountId={viewerAccountId} />
              </th>
            ))}
          </tr>
        </thead>
        {categories.map((category) => (
          <tbody key={category}>
            <tr>
              <th
                scope="rowgroup"
                colSpan={columns.length + 1}
                className="border-b border-line pt-6 pb-2 text-sm font-medium text-ink-muted"
              >
                {categoryLabel(category)}
              </th>
            </tr>
            {rows
              .filter((row) => row.category === category)
              .map((row) => (
                <tr key={row.slug} data-slot="health-picture-row" data-report-slug={row.slug}>
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
                className="p-2 align-top text-sm leading-relaxed text-ink"
              >
                {BASELINE_ABSENT}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
