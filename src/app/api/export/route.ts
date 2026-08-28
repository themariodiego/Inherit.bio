import { ZipArchive } from "archiver";
import { PassThrough, Readable } from "node:stream";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

// One-click full export: original uploads + normalized variants + report
// inputs, as a ZIP stream. Free, forever — there is deliberately no billing,
// quota, or fee code path here, and never will be (see /terms).
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const admin = createAdminClient();

  const [{ data: files }, { data: ancestry }, { data: consents }] =
    await Promise.all([
      admin.from("genome_files").select("*").eq("user_id", user.id),
      admin.from("ancestry_results").select("*").eq("user_id", user.id),
      admin
        .from("consent_grants")
        .select("provider_key, data_classes, granted_at, revoked_at")
        .eq("user_id", user.id),
    ]);

  const archive = new ZipArchive({ store: true });
  const out = new PassThrough();
  archive.pipe(out);

  const manifest = {
    exported_at: new Date().toISOString(),
    account_email: user.email,
    files: (files ?? []).map((f) => ({
      id: f.id,
      original_name: f.original_name,
      file_type: f.file_type,
      tier: f.tier,
      size_bytes: f.size_bytes,
      sha256: f.sha256,
      status: f.status,
      build: f.build,
      created_at: f.created_at,
    })),
    note: "Export is free and always will be. originals/ contains your uploaded files byte-for-byte; variants/ the normalized GRCh38 variant store; ancestry.json and consents.json your derived results and consent history.",
  };
  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
  archive.append(JSON.stringify(ancestry ?? [], null, 2), {
    name: "ancestry.json",
  });
  archive.append(JSON.stringify(consents ?? [], null, 2), {
    name: "consents.json",
  });

  void (async () => {
    try {
      for (const f of files ?? []) {
        // Normalized variants as CSV, paged to bound memory.
        const header = "rsid,chrom,pos_grch38,ref,alt,genotype\n";
        let csv = header;
        const page = 20000;
        for (let from = 0; ; from += page) {
          const { data: rows, error } = await admin
            .from("user_variants")
            .select("rsid, chrom, pos, ref, alt, genotype")
            .eq("file_id", f.id)
            .order("id", { ascending: true })
            .range(from, from + page - 1);
          if (error || !rows || rows.length === 0) break;
          for (const r of rows) {
            csv += `${r.rsid ? `rs${r.rsid}` : ""},${r.chrom},${r.pos},${r.ref ?? ""},${r.alt ?? ""},${r.genotype}\n`;
          }
          if (rows.length < page) break;
        }
        if (csv !== header) {
          archive.append(csv, { name: `variants/${f.id}.csv` });
        }

        // Original upload, streamed from storage.
        const { data: blob } = await admin.storage
          .from("genomes")
          .download(f.bucket_path);
        if (blob) {
          archive.append(Readable.fromWeb(blob.stream() as never), {
            name: `originals/${f.original_name}`,
          });
        }
      }
      await archive.finalize();
    } catch (err) {
      archive.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return new Response(Readable.toWeb(out) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="sequence-export-${user.id.slice(0, 8)}.zip"`,
    },
  });
}
