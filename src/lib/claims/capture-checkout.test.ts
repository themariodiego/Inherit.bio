import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertEmailCaptureCheckout } from "./capture-emails";

// Disposable repositories only: no test modifies the real source checkout.
async function checkout() {
  const directory = await mkdtemp(join(tmpdir(), "inherit-capture-checkout-"));
  const root = join(directory, "repo"), output = join(directory, "capture");
  await mkdir(join(root, "src/lib/claims"), { recursive: true });
  await writeFile(join(root, "src/lib/claims/email-fixtures.ts"), "export const fixture = 'synthetic';\n");
  await writeFile(join(root, "src/lib/claims/corpus.ts"), "export const policy = 'synthetic';\n");
  await writeFile(join(root, ".gitignore"), "node_modules/\n.next/\n*.local\n.env*\n");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "--quiet");
  git("add", ".");
  git("-c", "user.name=Capture Fixture", "-c", "user.email=capture@example.test", "commit", "--quiet", "-m", "Synthetic capture checkout");
  return { root, output, directory, git, commit: git("rev-parse", "HEAD") };
}

describe("complete capture checkout binding", () => {
  it("allows a clean commit and only known ignored generated output", async () => {
    const f = await checkout();
    await mkdir(join(f.root, "node_modules/synthetic"), { recursive: true });
    await writeFile(join(f.root, "node_modules/synthetic/index.js"), "// synthetic installation\n");
    await mkdir(join(f.root, ".next"));
    await writeFile(join(f.root, ".next/build.txt"), "synthetic build\n");
    expect(() => assertEmailCaptureCheckout(f.root, f.commit, f.output)).not.toThrow();
  });

  it.each(["email-fixtures.ts", "corpus.ts"])("refuses an uncommitted %s change before receipt publication", async (file) => {
    const f = await checkout();
    await writeFile(join(f.root, "src/lib/claims", file), "export const changed = 'synthetic';\n");
    expect(() => assertEmailCaptureCheckout(f.root, f.commit, f.output)).toThrow("uncommitted-renderer-inputs");
    await expect(access(join(f.output, "capture.json"))).rejects.toMatchObject({ code: "ENOENT" });
    f.git("add", ".");
    expect(() => assertEmailCaptureCheckout(f.root, f.commit, f.output)).toThrow("uncommitted-renderer-inputs");
  });

  it("refuses a new presentation source outside all previous enumerated paths", async () => {
    const f = await checkout();
    await mkdir(join(f.root, "presentation"));
    await writeFile(join(f.root, "presentation/claim.ts"), "export const text = 'synthetic';\n");
    expect(() => assertEmailCaptureCheckout(f.root, f.commit, f.output)).toThrow("uncommitted-renderer-inputs");
  });

  it.each(["src/lib/claims/source.local", ".env.local"])("refuses ignored untracked input %s", async (file) => {
    const f = await checkout();
    await writeFile(join(f.root, file), "synthetic-input\n");
    expect(() => assertEmailCaptureCheckout(f.root, f.commit, f.output)).toThrow("untracked-ignored-inputs");
  });

  it("refuses changed HEAD even when the new checkout is clean", async () => {
    const f = await checkout();
    f.git("-c", "user.name=Capture Fixture", "-c", "user.email=capture@example.test", "commit", "--quiet", "--allow-empty", "-m", "Synthetic later commit");
    expect(() => assertEmailCaptureCheckout(f.root, f.commit, f.output)).toThrow("content-commit-changed");
  });

  it("refuses output within the checkout, including an external symlink into it", async () => {
    const f = await checkout();
    expect(() => assertEmailCaptureCheckout(f.root, f.commit, join(f.root, "capture"))).toThrow("output-inside-checkout");
    const link = join(f.directory, "outside-link");
    await symlink(f.root, link, "dir");
    expect(() => assertEmailCaptureCheckout(f.root, f.commit, join(link, "capture"))).toThrow("output-inside-checkout");
  });
});
