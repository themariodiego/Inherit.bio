import { createRequire } from "node:module";
import { expect, it } from "vitest";

const localRequire = createRequire(import.meta.url);
const tsxRequire = createRequire(localRequire.resolve("tsx"));
const { build } = tsxRequire("esbuild") as { build(options: unknown): Promise<{
  metafile: { inputs: Record<string, unknown> }; outputFiles: { text: string }[];
}> };
function browserBundle(entry: string) {
  return build({ absWorkingDir: process.cwd(), entryPoints: [entry], bundle: true,
    platform: "browser", format: "esm", write: false, metafile: true, logLevel: "silent",
    plugins: [{ name: "enforce-server-only-boundary", setup(api: {
      onResolve(options: { filter: RegExp }, run: () => never): void;
    }) {
      api.onResolve({ filter: /^server-only$/ }, () => { throw new Error("server-only is forbidden in the browser graph"); });
    } }],
  });
}

it("bundles the actual upload client and receipt transitively without server origin generation", async () => {
  const result = await browserBundle("src/components/embryo/upload/upload-stage.tsx");
  const inputs = Object.keys(result.metafile.inputs);
  expect(inputs).toContain("src/lib/embryos/upload-receipt.ts");
  expect(inputs).toContain("src/lib/embryos/record-key-card-values.ts");
  expect(inputs).not.toContain("src/lib/app-origin.ts");
  expect(inputs).not.toContain("src/lib/embryos/record-key-cards.ts");
  expect(result.outputFiles.map(file => file.text).join("\n")).not.toMatch(/NEXT_PUBLIC_APP_URL|VERCEL_ENV|UNSET_APP_URL_MESSAGE/);
});

it("keeps the real card producer and private origin protected from a browser import", async () => {
  await expect(browserBundle("src/lib/embryos/record-key-cards.ts")).rejects.toThrow("server-only is forbidden");
  await expect(browserBundle("src/lib/app-origin.ts")).rejects.toThrow("server-only is forbidden");
});
