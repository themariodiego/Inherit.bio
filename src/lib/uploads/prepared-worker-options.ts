/** Pure operator argument parsing; metrics are explicitly opt-in. */
export function preparedWorkerOptions(args: string[]): { maximumIterations: 1 | undefined; metrics: boolean } {
  if (args.length > 2 || new Set(args).size !== args.length || args.some(arg => arg !== "--once" && arg !== "--metrics"))
    throw new Error("invalid_options");
  return { maximumIterations: args.includes("--once") ? 1 : undefined, metrics: args.includes("--metrics") };
}
