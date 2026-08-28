import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { decryptSecret } from "@/lib/crypto";
import { CATEGORY_LABELS } from "@/lib/genome/categories";
import {
  getActiveFile,
  getGenotypesByRsid,
  getPublishedTemplates,
  templateRsids,
} from "@/lib/genome/load";
import { resolveTemplate, type ReportTemplate } from "@/lib/genome/reports";
import { parseRsid } from "@/lib/genome/types";
import { isLocalBaseUrl, providerKeyFor, ssrfReasonForBaseUrl } from "@/lib/llm";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

const SYSTEM_PROMPT = `You are the Sequence copilot: you help a person explore their OWN genome data on Sequence, an open-source consumer genomics platform.

Hard rules:
- You are informational, never diagnostic. Never tell the user they have, will get, or are protected from any disease. Frame everything as association and probability shift, with effect sizes where available.
- Ground every substantive claim in the user's own data via the tools, and cite which report or variant it came from (e.g. "your Caffeine metabolism report (rs762551, genotype A/A)"). If a report exists on the topic, call get_report and cite it by title.
- Be candid about uncertainty and coverage: if the user's file does not cover a variant, say so plainly; array data covers a fixed set of positions. Never invent genotypes — only report what tools return.
- Sensitive topics (cancer, neurodegeneration, mental health, reproductive decisions): extra care, remind the user this is one small factor, and suggest a clinician or genetic counselor for decisions.
- Refuse requests to diagnose, prescribe, or interpret data of people other than the account holder.`;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = (await request.json()) as {
    messages: UIMessage[];
    fileId?: string;
  };

  const { data: settings } = await supabase
    .from("llm_settings")
    .select("provider, base_url, model, key_last4")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!settings) {
    return NextResponse.json(
      { error: "no_provider", message: "Configure a copilot provider in Settings first." },
      { status: 409 },
    );
  }

  const local =
    settings.provider === "openai_compatible" &&
    settings.base_url != null &&
    isLocalBaseUrl(settings.base_url);

  // Consent gate: genome-derived data may not leave for a CLOUD provider
  // without a stored, unrevoked grant naming that provider.
  const providerKey = providerKeyFor(
    settings.provider as "anthropic" | "openai_compatible",
    settings.base_url,
  );
  if (!local) {
    const { data: grant } = await supabase
      .from("consent_grants")
      .select("id")
      .eq("provider_key", providerKey)
      .is("revoked_at", null)
      .maybeSingle();
    if (!grant) {
      return NextResponse.json(
        { error: "consent_required", provider_key: providerKey },
        { status: 403 },
      );
    }
  }

  // Decrypt the BYOK key server-side (service role; table has no client grants).
  let apiKey: string | undefined;
  const admin = createAdminClient();
  const { data: keyRow } = await admin
    .from("llm_keys")
    .select("encrypted_key")
    .eq("user_id", user.id)
    .maybeSingle();
  if (keyRow?.encrypted_key) {
    const hex = (keyRow.encrypted_key as unknown as string).replace(/^\\x/, "");
    apiKey = decryptSecret(Buffer.from(hex, "hex"));
  }
  if (settings.provider === "anthropic" && !apiKey) {
    return NextResponse.json(
      { error: "no_key", message: "Add your Anthropic API key in Settings." },
      { status: 409 },
    );
  }

  // SSRF guard: the server fetches base_url below, so refuse internal
  // addresses unless the deployment opts into local endpoints (self-host).
  if (settings.provider === "openai_compatible" && settings.base_url) {
    const reason = ssrfReasonForBaseUrl(
      settings.base_url,
      process.env.ALLOW_PRIVATE_LLM_ENDPOINTS === "true",
    );
    if (reason) {
      return NextResponse.json(
        { error: "blocked_endpoint", message: `Provider endpoint refused: ${reason}` },
        { status: 400 },
      );
    }
  }

  const model =
    settings.provider === "anthropic"
      ? createAnthropic({ apiKey: apiKey! })(settings.model)
      : createOpenAICompatible({
          name: providerKey,
          baseURL: settings.base_url!,
          apiKey: apiKey ?? "sequence-local",
        })(settings.model);

  const activeFile = await getActiveFile(supabase, body.fileId);
  const fileNote = activeFile
    ? `The user's active processed file is "${activeFile.original_name}" (${activeFile.variant_count?.toLocaleString()} variants).`
    : "The user has no processed genome file yet; tools will return empty results. Help them understand what Sequence can do and how to upload data.";

  const tools = {
    get_genotype: tool({
      description:
        "Look up the user's genotype at a specific rsID in their active file, with reference annotations when available.",
      inputSchema: z.object({
        rsid: z
          .string()
          .describe("The rsID to look up, e.g. 'rs762551'"),
      }),
      execute: async ({ rsid }) => {
        const n = parseRsid(rsid);
        if (!n) return { error: "not a valid rsID" };
        if (!activeFile) return { error: "no processed file" };
        const { data: rows } = await supabase
          .from("user_variants")
          .select("rsid, chrom, pos, ref, alt, genotype")
          .eq("file_id", activeFile.id)
          .eq("rsid", n)
          .limit(1);
        const { data: ann } = await supabase
          .from("ref_variants")
          .select("gene_symbol, clinvar_significance, gnomad_af")
          .eq("rsid", n)
          .maybeSingle();
        if (!rows || rows.length === 0) {
          return {
            rsid,
            covered: false,
            note: "The user's file does not cover this variant.",
            annotation: ann ?? null,
          };
        }
        return { ...rows[0], rsid, covered: true, annotation: ann ?? null };
      },
    }),
    search_variants: tool({
      description:
        "Find the user's genotypes for all known report-relevant variants in a gene (by gene symbol).",
      inputSchema: z.object({
        gene: z.string().describe("Gene symbol, e.g. 'CYP1A2'"),
      }),
      execute: async ({ gene }) => {
        const { data: refs } = await supabase
          .from("ref_variants")
          .select("rsid, chrom, pos38, gene_symbol, clinvar_significance")
          .ilike("gene_symbol", gene)
          .limit(50);
        if (!refs || refs.length === 0) {
          return { gene, variants: [], note: "no reference variants known for this gene symbol" };
        }
        if (!activeFile) {
          return { gene, variants: refs.map((r) => ({ ...r, genotype: null })) };
        }
        const genotypes = await getGenotypesByRsid(
          supabase,
          activeFile.id,
          refs.map((r) => r.rsid),
        );
        return {
          gene,
          variants: refs.map((r) => ({
            ...r,
            genotype: genotypes.get(r.rsid) ?? null,
          })),
        };
      },
    }),
    list_reports: tool({
      description:
        "List the user's report library with coverage status for their active file. Optionally filter by category.",
      inputSchema: z.object({
        category: z
          .string()
          .nullish()
          .describe(
            `Optional category slug, one of: ${Object.keys(CATEGORY_LABELS).join(", ")}`,
          ),
      }),
      execute: async ({ category }) => {
        let templates = await getPublishedTemplates(supabase);
        if (category) templates = templates.filter((t) => t.category === category);
        const genotypes = activeFile
          ? await getGenotypesByRsid(
              supabase,
              activeFile.id,
              templateRsids(templates),
            )
          : new Map<number, string>();
        return {
          reports: templates.map((t) => {
            const r = resolveTemplate(t, (rsid) => genotypes.get(rsid));
            return {
              slug: t.slug,
              title: t.title,
              category: t.category,
              evidence: t.evidence,
              covered: r.covered,
            };
          }),
        };
      },
    }),
    get_report: tool({
      description:
        "Get one report resolved against the user's file: their genotype, the interpretation, citations, coverage state.",
      inputSchema: z.object({
        slug: z.string().describe("Report slug from list_reports"),
      }),
      execute: async ({ slug }) => {
        const { data: raw } = await supabase
          .from("report_templates")
          .select(
            "slug, category, title, summary, evidence, variants, pgs_id, citations",
          )
          .eq("slug", slug)
          .eq("status", "published")
          .maybeSingle();
        if (!raw) return { error: "unknown report" };
        const template = raw as unknown as ReportTemplate;
        const genotypes = activeFile
          ? await getGenotypesByRsid(
              supabase,
              activeFile.id,
              template.variants.map((v) => v.rsid),
            )
          : new Map<number, string>();
        const resolved = resolveTemplate(template, (r) => genotypes.get(r));
        return {
          slug: template.slug,
          title: template.title,
          summary: template.summary,
          evidence: template.evidence,
          citations: template.citations,
          variants: resolved.variants.map((v) => ({
            rsid: `rs${v.variant.rsid}`,
            gene: v.variant.gene,
            outcome: v.outcome,
          })),
        };
      },
    }),
    get_prs: tool({
      description:
        "Get the user's computed polygenic score result for a PGS Catalog ID, with coverage and the ancestry-portability caveat.",
      inputSchema: z.object({
        score_id: z.string().describe("PGS Catalog ID, e.g. 'PGS000018'"),
      }),
      execute: async ({ score_id }) => {
        const { data: meta } = await supabase
          .from("prs_scores")
          .select("pgs_id, name, trait, n_variants, ancestry_note")
          .eq("pgs_id", score_id)
          .maybeSingle();
        if (!meta) return { error: "unknown score id" };
        if (!activeFile) return { ...meta, result: null };
        const { data: result } = await supabase
          .from("user_prs")
          .select("raw_score, zscore, percentile, coverage, matched")
          .eq("file_id", activeFile.id)
          .eq("pgs_id", score_id)
          .maybeSingle();
        return { ...meta, result };
      },
    }),
  };

  const result = streamText({
    model,
    system: `${SYSTEM_PROMPT}\n\n${fileNote}`,
    messages: await convertToModelMessages(body.messages),
    tools,
    stopWhen: stepCountIs(8),
  });

  return result.toUIMessageStreamResponse();
}
