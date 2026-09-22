import { describe, expect, it } from "vitest";
import { preparedWorkerOptions } from "./prepared-worker-options";

describe("prepared worker operator options", () => {
  it.each([[], ["--once"], ["--metrics"], ["--once", "--metrics"], ["--metrics", "--once"]].map(args => ({ args })))("accepts the fixed optional flags $args", ({ args }) => {
    expect(preparedWorkerOptions(args)).toEqual({ maximumIterations: args.includes("--once") ? 1 : undefined, metrics: args.includes("--metrics") });
  });
  it.each([["--metrics", "--metrics"], ["--once", "--once"], ["--metrics", "--once", "--metrics"], ["--url=private"], ["--metrics=true"]].map(args => ({ args })))("refuses extra or duplicate argument $args", ({ args }) => {
    expect(() => preparedWorkerOptions(args)).toThrow(/^invalid_options$/);
  });
});
