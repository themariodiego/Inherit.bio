/**
 * The four illustrations of "What did they send you?" (brief line 377:
 * "four illustrated options"). Inline, decorative, current-colour strokes
 * only: no text, no colour token, nothing a screen reader reads.
 */
import type { SentAnswer } from "@/copy/embryos/upload";

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function OptionArt({ option }: { option: SentAnswer }) {
  const common = { "aria-hidden": true, focusable: "false", viewBox: "0 0 32 32", className: "size-8 shrink-0 text-ink-muted" } as const;
  switch (option) {
    case "per-embryo-file":
      // Three sheets, one behind another.
      return (
        <svg {...common}>
          <path {...STROKE} d="M11 4h9l5 5v13H11z" />
          <path {...STROKE} d="M8 8v17h13" />
          <path {...STROKE} d="M5 12v17h13" />
        </svg>
      );
    case "one-file-columns":
      // One sheet ruled into columns.
      return (
        <svg {...common}>
          <path {...STROKE} d="M6 5h20v22H6z" />
          <path {...STROKE} d="M6 11h20M13 11v16M19 11v16" />
        </svg>
      );
    case "pdf-only":
      // A printed report: a folded corner and lines of text.
      return (
        <svg {...common}>
          <path {...STROKE} d="M8 3h11l6 6v20H8z" />
          <path {...STROKE} d="M19 3v6h6" />
          <path {...STROKE} d="M11 15h11M11 19h11M11 23h7" />
        </svg>
      );
    case "zip-folder":
      // A folder.
      return (
        <svg {...common}>
          <path {...STROKE} d="M4 8h9l3 3h12v15H4z" />
          <path {...STROKE} d="M4 14h24" />
        </svg>
      );
  }
}
