import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  tool,
  toUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import allowedNumerals from "../../../../config/allowed-numerals.json";
import { refusalFor, type RefusalId } from "@/copy/copilot/refusals";
import {
  checkResponse,
  classifyIntent,
  dropGatedTurns,
  foldStreamChunks,
  guardScopeKindFor,
  userTurnText,
  type AllowedNumerals,
  type GuardScope,
} from "@/lib/copilot/guard";
import { decryptSecret } from "@/lib/crypto";
import { CATEGORY_LABELS } from "@/lib/genome/categories";
import {
  getPublishedTemplates,
  getSubjectGenotypesByRsid,
  getSubjectProcessedFiles,
  templateRsids,
} from "@/lib/genome/load";
import { resolveTemplate, type ReportTemplate } from "@/lib/genome/reports";
import { parseRsid } from "@/lib/genome/types";
import { isLocalBaseUrl, providerKeyFor, ssrfReasonForBaseUrl } from "@/lib/llm";
import { resolveSubjectForAccount } from "@/lib/subjects";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

const SYSTEM_PROMPT = `You are the Inherit copilot: you help a person explore their OWN genome data on Inherit, an open-source consumer genomics platform.

Hard rules:
- You are informational, never diagnostic. Never tell the user they have, will get, or are protected from any disease. Frame everything as association and probability shift, with effect sizes where available.
- Ground every substantive claim in the user's own data via the tools, and cite which report or variant it came from (e.g. "your Caffeine metabolism report (rs762551, genotype A/A)"). If a report exists on the topic, call get_report and cite it by title.
- Be candid about uncertainty and coverage: if the user's file does not cover a variant, say so plainly; array data covers a fixed set of positions. Never invent genotypes — only report what tools return.
- Sensitive topics (cancer, neurodegeneration, mental health, reproductive decisions): extra care, remind the user this is one small factor, and suggest a clinician or genetic counselor for decisions.
- Refuse requests to diagnose, prescribe, or interpret data of people other than the account holder.
- Never say an embryo is better, best or recommended, never rank embryos, never advise what to do with one, and never predict or disclose an embryo's sex.
- State no number that the tools did not return this turn, and cite nothing beyond the citations the tools returned.`;

/** The text of the newest user turn, or null when the request carries none. */
function latestUserText(messages: UIMessage[]): string | null {
  const last = [...messages].reverse().find((message) => message.role === "user");
  if (!last) return null;
  const text = userTurnText(last);
  return text.length > 0 ? text : null;
}

/**
 * The refusal as the whole assistant turn on the same stream transport the
 * client reads, with the refusal id in a header for machine readers. No
 * model is involved and nothing about the user is carried.
 */
function refusalResponse(id: RefusalId, text: string): Response {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: "start" });
      writer.write({ type: "text-start", id: "refusal" });
      writer.write({ type: "text-delta", id: "refusal", delta: text });
      writer.write({ type: "text-end", id: "refusal" });
      writer.write({ type: "finish" });
    },
  });
  return createUIMessageStreamResponse({
    stream,
    headers: { "x-copilot-refusal": id },
  });
}

/** Drain a UI message stream to its chunks; nothing is forwarded while it runs. */
async function bufferUIMessageStream(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const chunks: UIMessageChunk[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

function replayChunks(chunks: UIMessageChunk[]): ReadableStream<UIMessageChunk> {
  return createUIMessageStream({
    execute: ({ writer }) => {
      for (const chunk of chunks) writer.write(chunk);
    },
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = (await request.json()) as {
    messages: UIMessage[];
  };
  const scopeSegment = new URL(request.url).searchParams.get("scope") ?? "me";
  const subject = await resolveSubjectForAccount(user.id, scopeSegment);
  // Only a self or an adult subject has a chat scope today; a minor or an
  // embryo answers the same opaque 404 as an unknown segment until its own
  // scope exists.
  const scopeKind = subject ? guardScopeKindFor(subject.subjectClass) : null;
  if (!subject || !scopeKind) {
    return NextResponse.json({ error: "scope_not_found" }, { status: 404 });
  }

  // Intent gate (brief line 2262; §5.7 line 366, §6.4 line 402): the newest
  // user turn is classified after scope authorization and before any
  // provider, consent, retrieval or model step. A gated intent is answered
  // with the fixed refusal for its class; the message is neither stored nor
  // logged, only the class is. Family and cohort scopes pass their kind here
  // once the route resolves them; today it serves self and subject scopes.
  const latest = latestUserText(body.messages);
  if (latest === null) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const guardScope: GuardScope = { kind: scopeKind, displayLabel: subject.displayLabel };
  const verdict = classifyIntent(latest, guardScope);
  if (verdict.intent !== "allowed") {
    console.info(`[copilot] refused ${verdict.intent}`);
    return refusalResponse(verdict.intent, refusalFor(verdict.intent, subject.displayLabel));
  }

  const admin = createAdminClient();

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

  if (subject.subjectClass !== "self" && !local) {
    return NextResponse.json(
      {
        error: "local_model_required",
        message:
          "For anyone's genome but your own, Copilot only runs on a model you host yourself. Nothing leaves Inherit.",
      },
      { status: 403 },
    );
  }

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

  const files = await getSubjectProcessedFiles(admin, subject.id);
  const fileNote = files.length > 0
    ? `The resolved subject is "${subject.displayLabel}". Combine ${files.length} processed files; if files disagree at a position, return no genotype.`
    : `The resolved subject is "${subject.displayLabel}" and has no processed genome file yet; tools will return empty results.`;

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
        if (files.length === 0) return { error: "no processed file" };
        const [{ genotypes, conflicts }, { data: ann }] = await Promise.all([
          getSubjectGenotypesByRsid(admin, subject.id, [n]),
          admin
          .from("ref_variants")
          .select("rsid, chrom, pos38, ref, alt, gene_symbol, clinvar_significance, gnomad_af")
          .eq("rsid", n)
          .maybeSingle(),
        ]);
        if (conflicts.has(n)) {
          return { rsid, covered: false, conflict: true, note: "The subject's files disagree at this position." };
        }
        const genotype = genotypes.get(n);
        if (!genotype) {
          return {
            rsid,
            covered: false,
            note: "The user's file does not cover this variant.",
            annotation: ann ?? null,
          };
        }
        return { rsid, genotype, covered: true, annotation: ann ?? null };
      },
    }),
    search_variants: tool({
      description:
        "Find the user's genotypes for all known report-relevant variants in a gene (by gene symbol).",
      inputSchema: z.object({
        gene: z.string().describe("Gene symbol, e.g. 'CYP1A2'"),
      }),
      execute: async ({ gene }) => {
        const { data: refs } = await admin
          .from("ref_variants")
          .select("rsid, chrom, pos38, gene_symbol, clinvar_significance")
          .ilike("gene_symbol", gene)
          .limit(50);
        if (!refs || refs.length === 0) {
          return { gene, variants: [], note: "no reference variants known for this gene symbol" };
        }
        if (files.length === 0) {
          return { gene, variants: refs.map((r) => ({ ...r, genotype: null })) };
        }
        const { genotypes, conflicts } = await getSubjectGenotypesByRsid(
          admin,
          subject.id,
          refs.map((r) => r.rsid),
        );
        return {
          gene,
          variants: refs.map((r) => ({
            ...r,
            genotype: conflicts.has(r.rsid) ? null : (genotypes.get(r.rsid) ?? null),
            conflict: conflicts.has(r.rsid),
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
        let templates = await getPublishedTemplates(admin);
        if (category) templates = templates.filter((t) => t.category === category);
        const { genotypes } = files.length > 0
          ? await getSubjectGenotypesByRsid(
              admin,
              subject.id,
              templateRsids(templates),
            )
          : { genotypes: new Map<number, string>() };
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
        const { data: raw } = await admin
          .from("report_templates")
          .select(
            "slug, category, title, summary, evidence, variants, pgs_id, citations",
          )
          .eq("slug", slug)
          .eq("status", "published")
          .maybeSingle();
        if (!raw) return { error: "unknown report" };
        const template = raw as unknown as ReportTemplate;
        const { genotypes } = files.length > 0
          ? await getSubjectGenotypesByRsid(
              admin,
              subject.id,
              template.variants.map((v) => v.rsid),
            )
          : { genotypes: new Map<number, string>() };
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
        const { data: meta } = await admin
          .from("prs_scores")
          .select("pgs_id, name, trait, n_variants, ancestry_note, citation")
          .eq("pgs_id", score_id)
          .maybeSingle();
        if (!meta) return { error: "unknown score id" };
        if (files.length === 0) return { ...meta, result: null };
        const { data: results } = await admin
          .from("user_prs")
          .select("raw_score, zscore, percentile, coverage, matched")
          .eq("subject_id", subject.id)
          .eq("pgs_id", score_id)
          .order("computed_at", { ascending: false })
          .limit(1);
        return { ...meta, result: results?.[0] ?? null };
      },
    }),
  };

  // The history the model sees: every earlier user turn is classified again
  // and a gated one is dropped with the refusal that answered it, so a
  // refused message never reaches the model through the client's resend.
  const result = streamText({
    model,
    system: `${SYSTEM_PROMPT}\n\n${fileNote}`,
    messages: await convertToModelMessages(dropGatedTurns(body.messages, guardScope)),
    tools,
    stopWhen: stepCountIs(8),
  });

  // Output guard (brief line 2262): the whole answer is buffered and checked
  // before its first byte is sent. Everything the model authored (its text,
  // any reasoning, every tool input) is one string for the checks; reasoning
  // is never sent on. A number absent from this turn's tool JSON, or a
  // citation outside the report and score citations the tools returned,
  // replaces the answer with the fixed refusal for that check; nothing
  // partial is ever serialized.
  const chunks = await bufferUIMessageStream(
    toUIMessageStream({ stream: result.stream, sendReasoning: false }),
  );
  const { text, toolJson } = foldStreamChunks(chunks);
  const output = checkResponse(text, toolJson, allowedNumerals as AllowedNumerals);
  if (!output.ok) {
    console.info(`[copilot] replaced ${output.violation}`);
    return refusalResponse(output.violation, refusalFor(output.violation, subject.displayLabel));
  }
  return createUIMessageStreamResponse({ stream: replayChunks(chunks) });
}
