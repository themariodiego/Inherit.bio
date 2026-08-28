import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { toLines } from "./lines";

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

async function collect(iter: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const line of iter) out.push(line);
  return out;
}

describe("toLines", () => {
  it("splits plain bytes into lines, handling chunk boundaries", async () => {
    const chunks = [Buffer.from("ab"), Buffer.from("c\nde\nf"), Buffer.from("g\n")];
    expect(await collect(toLines(Readable.from(chunks)))).toEqual([
      "abc",
      "de",
      "fg",
    ]);
  });

  it("strips \\r\\n and yields a final unterminated line", async () => {
    const lines = await collect(
      toLines(Readable.from([Buffer.from("a\r\nb\r\nc")]))
    );
    expect(lines).toEqual(["a", "b", "c"]);
  });

  it("gunzips gzip input transparently", async () => {
    const gz = gzipSync(Buffer.from("one\ntwo\n"));
    expect(await collect(toLines(Readable.from([gz])))).toEqual(["one", "two"]);
  });

  it("handles gzip magic split across tiny chunks", async () => {
    const gz = gzipSync(Buffer.from("one\ntwo\n"));
    const chunks = [gz.subarray(0, 1), gz.subarray(1, 2), gz.subarray(2)];
    expect(await collect(toLines(Readable.from(chunks)))).toEqual([
      "one",
      "two",
    ]);
  });

  it("decompresses concatenated gzip members (bgzf-style)", async () => {
    const combined = Buffer.concat([
      gzipSync(Buffer.from("first\nsecond\n")),
      gzipSync(Buffer.from("third\nfourth\n")),
    ]);
    expect(await collect(toLines(Readable.from([combined])))).toEqual([
      "first",
      "second",
      "third",
      "fourth",
    ]);
  });

  it("reads a gzipped fixture from a file stream", async () => {
    const lines = await collect(toLines(createReadStream(fixture("sample.vcf.gz"))));
    expect(lines[0]).toBe("##fileformat=VCFv4.2");
    expect(lines.at(-1)).toBe("chrM\t700\trs7\tA\t.\t50\tPASS\t.\tGT\t0");
  });

  it("accepts a web ReadableStream", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x\ny\n"));
        controller.close();
      },
    });
    expect(await collect(toLines(stream))).toEqual(["x", "y"]);
  });

  it("yields nothing for an empty source", async () => {
    expect(await collect(toLines(Readable.from([])))).toEqual([]);
  });
});
