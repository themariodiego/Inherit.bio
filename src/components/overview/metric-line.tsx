// A count with its unit noun and a 1–12-word note (brief X9.1, acceptance 3).
// The value is never a dash, "N/A" or empty: callers pass a formatted count
// such as "2 files"; report-layer quantities use Count instead. A tile with nothing to count renders
// its empty copy through a plain paragraph instead of this component.

const DASH_LIKE = /^(?:[-–—]|N\/A)?$/;

export function MetricLine({
  value,
  note,
  className,
}: {
  value: string;
  note: string;
  className?: string;
}) {
  if (DASH_LIKE.test(value.trim())) {
    throw new Error(`MetricLine refuses a placeholder value: "${value}"`);
  }
  return (
    <p className={className ?? "text-base leading-relaxed"}>
      <span data-metric-value className="font-medium text-ink">
        {value}
      </span>{" "}
      <span data-metric-note className="text-ink-muted">
        {note}
      </span>
    </p>
  );
}
