import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { signOutResponse } from "../src/app/auth/sign-out/response";
import {
  AI_SDK_CHAT_BODY_KEYS,
  CONDITIONAL_REQUIRED_HEADERS,
  clientModules,
  diskReader,
  fileRequests,
  formIssueKey,
  formSites,
  nativeFormIssues,
  propSubmissions,
  registeredStatuses,
  requestIssues,
  type ClientRequest,
  type FormIssue,
  type FormSite,
  type RegisterDocument,
  type SourceReader,
} from "./form-contract-census";

/**
 * G8.5, form verification: every `<form>` in the shipped app sends what its
 * register entry declares — target, method, body fields and discriminators,
 * required and CSRF headers, content type — and branches only on statuses the
 * register lets that route answer.
 *
 * `scripts/route-register-correspondence.test.ts` already checks that a
 * native form's `action` names a registered route with a method it allows,
 * and seals the actionless (handler-submitted) forms by their source bytes.
 * Neither reads what an actionless form sends, which is where every request
 * contract lives: of 26 forms, 24 submit through a handler. This reads them
 * (`scripts/form-contract-census.ts`) and compares the result with
 * `docs/register-contract-divergence.json#formRequestDivergence` in both
 * directions, so a new divergence fails until it is recorded and a fixed one
 * fails until its row is removed. The forms whose submission is not an
 * Inherit request the census can read are compared, also in both directions,
 * with `formSubmissionReview`.
 */

const REGISTER = "docs/route-register.json";
const LEDGER = "docs/register-contract-divergence.json";
const CODE_ROOTS = ["src", "worker/src", "workers"];
// G8.5 (2026-10-23): sign-out became a scripted form that sends X-Inherit-CSRF;
// it was the native form in src/components/site/app-shell.tsx.
const SIGN_OUT_FORM = "src/components/site/sign-out-form.tsx";

type DivergenceRow = { file: string; routeId: string; method: string; issues: string[]; why: string; closing: string; closedBy: string };
type ReviewRow = { file: string; usage: string; submits: string; evidence: { file: string; literal: string }[]; why: string; closing: string };
type ClientReviewRow = { file: string; issues: string[]; requests: string; evidence: { file: string; literal: string }[]; why: string; closing: string };
type Ledger = { formRequestDivergence: DivergenceRow[]; formSubmissionReview: ReviewRow[]; csrfTransportNote: string;
  clientRequestDivergenceNote: string; clientRequestDivergence: DivergenceRow[]; clientRequestReviewNote: string;
  clientRequestReview: ClientReviewRow[] };

const register = JSON.parse(readFileSync(REGISTER, "utf8")) as RegisterDocument & {
  routes: (RegisterDocument["routes"][number] & { requestContract?: unknown; methodRequestContracts?: Record<string, unknown> })[];
};
const ledger = JSON.parse(readFileSync(LEDGER, "utf8")) as Ledger;

/** Every shipped `.tsx`, the way the route correspondence test walks the code. */
function shippedTsx(): string[] {
  const found: string[] = [];
  const walk = (directory: string) => {
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "node_modules") walk(full); continue; }
      if (entry.name.endsWith(".tsx") && !/\.(test|spec|fixtures)\./.test(entry.name)) found.push(full.split(path.sep).join("/"));
    }
  };
  for (const root of CODE_ROOTS) walk(root);
  return found.sort();
}

/**
 * The sign-out form is a native POST whose response the browser follows, so
 * its response is checked against sign-out-v1 directly: status, and the
 * route its Location names.
 */
function signOutResponseIssues(response: Response, document: RegisterDocument): FormIssue[] {
  const contract = document.responseContracts["sign-out-v1"] as { status?: number; location?: { routeFrom?: string } };
  const issues: FormIssue[] = [];
  const add = (issue: string) => issues.push({ file: SIGN_OUT_FORM, routeId: "auth.sign-out", method: "POST", issue });
  if (response.status !== contract.status) add(`responds ${response.status} where sign-out-v1 registers ${contract.status}`);
  const location = response.headers.get("location");
  const target = document.routes.find(route => route.id === contract.location?.routeFrom);
  const landed = location ? new URL(location).pathname : "(none)";
  if (target && landed !== target.path) add(`responds ${response.status} to ${landed} where sign-out-v1 names ${target.id} (${target.path})`);
  return issues;
}

interface Census {
  sites: FormSite[];
  requests: ClientRequest[];
  issues: FormIssue[];
  /** Forms (or the usage that supplies their handler) that make no request the census can read. */
  silent: { file: string; usage: string }[];
}

function census(files: string[], read: SourceReader, document: RegisterDocument, signOut: Response): Census {
  const sites = files.filter(file => (read(file) ?? "").includes("<form")).flatMap(file => formSites(file, read));
  const requests: ClientRequest[] = [];
  const issues: FormIssue[] = [];
  const silent: { file: string; usage: string }[] = [];
  for (const site of sites) {
    issues.push(...nativeFormIssues(site, document));
    requests.push(...site.requests);
    const usages = site.component
      ? site.delegatedProps.flatMap(prop => propSubmissions(site.component!, site.file, prop, files, read)) : [];
    for (const usage of usages) requests.push(...usage.requests);
    if (site.action === null && site.requests.length === 0) {
      if (!usages.length) silent.push({ file: site.file, usage: site.file });
      for (const usage of usages) if (!usage.requests.length) silent.push({ file: site.file, usage: usage.file });
    }
  }
  for (const request of requests) issues.push(...requestIssues(request, document));
  if (sites.some(site => site.file === SIGN_OUT_FORM)) issues.push(...signOutResponseIssues(signOut, document));
  return { sites, requests, issues, silent };
}

const recordedKeys = () => ledger.formRequestDivergence.flatMap(row =>
  row.issues.map(issue => formIssueKey({ file: row.file, routeId: row.routeId, method: row.method, issue })));

/** Both directions at once: what is present and unrecorded, and what is recorded and no longer present. */
function ledgerMismatch(present: string[], recorded: string[]) {
  const presentSet = new Set(present);
  const recordedSet = new Set(recorded);
  return {
    unrecorded: [...presentSet].filter(key => !recordedSet.has(key)).sort(),
    stale: [...recordedSet].filter(key => !presentSet.has(key)).sort(),
  };
}

const files = shippedTsx();
const disk = diskReader(".");
const actual = census(files, disk, register, signOutResponse("https://inherit.test"));

describe("every form sends what its register entry declares (G8.5)", () => {
  it("reads every form and every request, so a passing run is not an empty scan", () => {
    // The exact census. A walker that silently loses a form, or a form that
    // is added, changes these numbers and has to be looked at.
    // G8.5 (2026-10-23): sign-out moved from a native form (2 native, 24
    // handler-submitted, 27 requests from 22 files) to a scripted one.
    expect(actual.sites).toHaveLength(26);
    // Since 2026-10-23: sign-out is a scripted form (it was the second native
    // form), and the compatibility panel sends the registered body with fetch.
    expect(actual.sites.filter(site => site.action !== null)).toHaveLength(1);
    expect(actual.sites.filter(site => site.action === null && site.handlerResolved)).toHaveLength(25);
    expect(actual.requests.length).toBe(28);
    // 0 since 2026-10-23: the compatibility panel sends the registered body with fetch (it was 1).
    expect(actual.requests.filter(request => request.via === "ai-sdk-default-chat-transport")).toHaveLength(0);
    expect(new Set(actual.requests.map(request => request.file)).size).toBe(23);
    // And it really reaches the shapes the checks below depend on.
    const jurisdiction = actual.requests.find(request => request.file === "src/components/settings/jurisdiction-form.tsx")!;
    expect(jurisdiction.methods).toEqual(["PUT"]);
    expect(jurisdiction.headers.names).toEqual(["content-type", "x-inherit-csrf", "x-inherit-operation-nonce"]);
    expect(jurisdiction.bodies).toHaveLength(1);
    expect(Object.keys((jurisdiction.bodies[0] as { shape: { keys: object } }).shape.keys).sort())
      .toEqual(["affirmed", "attestationHash", "attestationVersion", "code", "subdivision"]);
  });

  it("records every divergence between a form's request and its register entry, in both directions", () => {
    const { unrecorded, stale } = ledgerMismatch(actual.issues.map(formIssueKey), recordedKeys());
    expect(unrecorded, "divergences no formRequestDivergence row records").toEqual([]);
    expect(stale, "formRequestDivergence rows whose divergence no longer exists").toEqual([]);
  });

  it("says why each divergence exists, what closes it and who has to act", () => {
    const groups = new Set<string>();
    for (const row of ledger.formRequestDivergence) {
      const group = `${row.file} ${row.routeId} ${row.method} ${row.why === "See csrfTransportNote." ? "csrf" : "contract"}`;
      expect(groups.has(group), `${group} is split across rows`).toBe(false);
      groups.add(group);
      expect(["owner", "counsel", "engineering"]).toContain(row.closedBy);
      expect(row.issues.length).toBeGreaterThan(0);
      if (row.why === "See csrfTransportNote.") {
        expect(row.issues).toEqual(["omits X-Inherit-CSRF, which mutationSecurityBindings.csrfTransport requires of this state-changing request"]);
        continue;
      }
      expect(row.why.length, `${row.file} ${row.routeId}`).toBeGreaterThan(150);
      expect(row.closing.length, `${row.file} ${row.routeId}`).toBeGreaterThan(60);
    }
    expect(ledger.csrfTransportNote.length).toBeGreaterThan(400);
  });

  it("names every form whose submission is not an Inherit request the census can read, in both directions", () => {
    const present = actual.silent.map(entry => `${entry.file} via ${entry.usage}`).sort();
    expect(present).toEqual(ledger.formSubmissionReview.map(row => `${row.file} via ${row.usage}`).sort());
    for (const row of ledger.formSubmissionReview) {
      expect(row.why.length).toBeGreaterThan(150);
      expect(row.evidence.length).toBeGreaterThan(0);
      // Anchored to the code it describes, so the row cannot outlive it.
      for (const evidence of row.evidence) {
        expect(readFileSync(evidence.file, "utf8").includes(evidence.literal), `${evidence.file}: ${evidence.literal}`).toBe(true);
      }
    }
  });

  it("holds the conditional required-header table to the register in both directions", () => {
    const clauses = register.routes.flatMap(route => [route.requestContract, ...Object.values(route.methodRequestContracts ?? {})]
      .map(contract => (contract as { requiredHeader?: unknown } | undefined)?.requiredHeader)
      .filter((header): header is string => typeof header === "string" && header.includes("-for-the-"))
      .map(header => `${route.id} ${header}`));
    expect(clauses.sort()).toEqual(Object.entries(CONDITIONAL_REQUIRED_HEADERS).map(([id, entry]) => `${id} ${entry.clause}`).sort());
  });

  it("reads the AI SDK chat body from the installed transport, and would notice it change", () => {
    const sdk = JSON.parse(readFileSync("node_modules/ai/package.json", "utf8")) as { version: string };
    expect(sdk.version).toBe("7.0.83");
    const transport = readFileSync("node_modules/ai/dist/index.js", "utf8");
    expect(transport).toContain([
      "      id: options.chatId,",
      "      messages: options.messages,",
      "      trigger: options.trigger,",
      "      messageId: options.messageId",
    ].join("\n"));
    expect(Object.keys(AI_SDK_CHAT_BODY_KEYS)).toEqual(["id", "messages", "trigger", "messageId"]);
  });
});

/**
 * Planted defects. Each runs the census over the real tree with one file
 * replaced or added, so everything but the defect under test is the shipped
 * code and the shipped register.
 */
describe("the form census fails on a planted divergence", () => {
  const overlay = (files: Record<string, string>): SourceReader => (file) => file in files ? files[file] : disk(file);
  const real = (file: string) => readFileSync(file, "utf8");
  const run = (planted: Record<string, string>, signOut: Response = signOutResponse("https://inherit.test")) => {
    const names = [...new Set([...files, ...Object.keys(planted)])].sort();
    return census(names, overlay(planted), register, signOut);
  };
  const mismatch = (planted: Record<string, string>) =>
    ledgerMismatch(run(planted).issues.map(formIssueKey), recordedKeys());
  /** One planted form posting `init` to `url` from a client component. */
  const form = (url: string, init: string, after = "") => [
    '"use client";',
    "export function Planted() {",
    "  async function submit(event: { preventDefault(): void }) {",
    "    event.preventDefault();",
    `    const response = await fetch(${url}, ${init});`,
    `    ${after}`,
    "  }",
    "  return <form onSubmit={submit}><button type=\"submit\">Go</button></form>;",
    "}",
  ].join("\n");
  const plantedFile = "src/components/planted-form.tsx";
  const issuesOf = (source: string) => run({ [plantedFile]: source }).issues
    .filter(issue => issue.file === plantedFile).map(issue => issue.issue);

  it("fails when a recorded form drops a header its register entry requires (a new, unrecorded divergence)", () => {
    const file = "src/components/settings/jurisdiction-form.tsx";
    const source = real(file);
    expect(source).toContain('"X-Inherit-Operation-Nonce": operationNonce');
    const { unrecorded, stale } = mismatch({ [file]: source.replace(', "X-Inherit-Operation-Nonce": operationNonce', "") });
    expect(unrecorded).toEqual([`${file} api.jurisdiction PUT: omits the required header x-inherit-operation-nonce`]);
    expect(stale).toEqual([]);
  });

  it("fails when a recorded divergence is fixed and its row is left behind (a stale row)", () => {
    // Re-targeted on 2026-10-23: the llm-settings form this planted the registered body into now sends it.
    const file = "src/components/embryo/co-parent-review-form.tsx";
    const source = real(file);
    const sent = 'nonce: review.nonce, jurisdictionCode: form.get("jurisdictionCode"),';
    expect(source).toContain(sent);
    const { unrecorded, stale } = mismatch({ [file]: source.replace(sent,
      `${sent} jurisdictionAttestationVersion: version, jurisdictionAttestationHash: hash, jurisdictionAffirmed: true,`) });
    expect(unrecorded).toEqual([]);
    expect(stale).toEqual([
      `${file} api.invitation-accept POST: omits jurisdictionAffirmed, which the registered body requires`,
      `${file} api.invitation-accept POST: omits jurisdictionAttestationHash, which the registered body requires`,
      `${file} api.invitation-accept POST: omits jurisdictionAttestationVersion, which the registered body requires`,
    ]);
  });

  it("holds the llm-settings form to its registered bodies: the legacy body fails, and a required apiKey would reopen the closed row", () => {
    const file = "src/components/settings/llm-settings-form.tsx";
    const source = real(file);
    const sent = "body: JSON.stringify(body),";
    expect(source).toContain(sent);
    const legacy = mismatch({ [file]: source.replace(sent,
      "body: JSON.stringify({ provider, base_url, model: chosenModel, api_key: apiKey || null }),") });
    // Since 2026-10-24 (owner decision, "Settings → AI may omit apiKey") the legacy body no longer "omits apiKey".
    expect(legacy.unrecorded).toEqual([
      `${file} api.llm-settings POST: omits mode, which the registered body requires`,
      `${file} api.llm-settings POST: sends api_key, which the registered body does not declare`,
      `${file} api.llm-settings POST: sends base_url, which the registered body does not declare`,
    ]);
    const optional = /\.\.\.\(apiKey \? \{ apiKey \} : \{\}\)/g;
    expect(source.match(optional)).toHaveLength(3);
    expect(mismatch({ [file]: source.replace(optional, "apiKey") })).toEqual({ unrecorded: [], stale: [] });
    // Planted: the register's hosted and remote bodies require apiKey again, as before the decision.
    const amended = /"apiKey": "optional-bounded-secret-of-4-through-500-characters; [^"]+"/g;
    const text = JSON.stringify(register, null, 2);
    expect(text.match(amended)).toHaveLength(2);
    const required = JSON.parse(text.replace(amended, '"apiKey": "required-bounded-secret"')) as typeof register;
    expect(ledgerMismatch(census(files, disk, required, signOutResponse("https://inherit.test")).issues.map(formIssueKey), recordedKeys()))
      .toEqual({ unrecorded: [`${file} api.llm-settings POST: may omit apiKey, which the registered body requires`], stale: [] });
  });

  it("still reads the AI SDK chat transport, so the compatibility panel's former body would fail again", () => {
    // The former panel's request, reduced to the lines that make it (src/components/chat/chat-panel.tsx at 287a1408).
    const file = "src/components/chat/chat-panel.tsx";
    const former = [
      '"use client";',
      'import { useChat } from "@ai-sdk/react";',
      'import { DefaultChatTransport } from "ai";',
      "export function ChatPanel({ scope }: { scope: string }) {",
      "  const { sendMessage } = useChat({",
      "    transport: new DefaultChatTransport({",
      "      api: `/api/chat?scope=${encodeURIComponent(scope)}`,",
      "    }),",
      "  });",
      "  const submit = () => { void sendMessage({ text: \"question\" }); };",
      "  return <form onSubmit={(e) => { e.preventDefault(); submit(); }}><button type=\"submit\">Send</button></form>;",
      "}",
    ].join("\n");
    const result = run({ [file]: former });
    expect(result.requests.filter(request => request.via === "ai-sdk-default-chat-transport")).toHaveLength(1);
    expect(ledgerMismatch(result.issues.map(formIssueKey), recordedKeys()).unrecorded).toEqual([
      // Since the merge with the session token: the former panel also sent no X-Inherit-CSRF.
      `${file} api.chat POST: omits X-Inherit-CSRF, which mutationSecurityBindings.csrfTransport requires of this state-changing request`,
      `${file} api.chat POST: omits chatId, which the registered body requires`,
      `${file} api.chat POST: omits message, which the registered body requires`,
      `${file} api.chat POST: sends id, which the registered body does not declare`,
      `${file} api.chat POST: sends messageId, which the registered body does not declare`,
      `${file} api.chat POST: sends messages, which the registered body does not declare`,
      `${file} api.chat POST: sends trigger, which the registered body does not declare`,
    ]);
  });

  it("fails on a request to a target no register entry describes, or one it cannot resolve", () => {
    expect(issuesOf(form('"/api/not-registered"', '{ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: 1 }) }')))
      .toEqual(["sends to /api/not-registered, which no register entry describes"]);
    expect(issuesOf(form("destination()", '{ method: "POST" }')))
      .toEqual(["sends to an unresolved target (destination()), which no register entry describes"]);
  });

  it("fails on a method the register does not declare for the route", () => {
    expect(issuesOf(form('"/api/settings/jurisdiction"', "{}"))).toEqual(["the register declares PUT for api.jurisdiction"]);
  });

  const jurisdiction = (body: string, headers = '"content-type": "application/json", "x-inherit-operation-nonce": nonce, "x-inherit-csrf": csrf', after = "") =>
    form('"/api/settings/jurisdiction"', `{ method: "PUT", headers: { ${headers} }, body: JSON.stringify(${body}) }`, after);
  const conforming = '{ code, attestationVersion: 1, attestationHash: hash, affirmed: true }';

  it("passes a request that matches its entry exactly, so the checks below are not noise", () => {
    expect(issuesOf(jurisdiction(conforming))).toEqual([]);
    expect(issuesOf(jurisdiction('{ code, ...(states ? { subdivision } : {}), attestationVersion: 1, attestationHash: hash, affirmed: true }'))).toEqual([]);
  });

  it("fails on a field the registered body does not declare, and on a required field left out", () => {
    expect(issuesOf(jurisdiction('{ code, attestationVersion: 1, attestationHash: hash, affirmed: true, country: code }')))
      .toEqual(["sends country, which the registered body does not declare"]);
    expect(issuesOf(jurisdiction('{ code, attestationVersion: 1, affirmed: true }')))
      .toEqual(["omits attestationHash, which the registered body requires"]);
  });

  it("fails on a literal the registered body pins to another value, and on a field it forbids", () => {
    const withdraw = (body: string) => form('"/api/withdraw/session"',
      `{ method: "POST", headers: { "content-type": "application/json", "x-inherit-csrf": csrf }, body: JSON.stringify(${body}) }`);
    expect(issuesOf(withdraw('{ operation: "refuse", nonce }'))).toEqual([]);
    expect(issuesOf(withdraw('{ operation: "approve", nonce }')))
      .toEqual(["sends operation=approve where the registered body requires refuse"]);
    expect(issuesOf(withdraw('{ operation: "refuse", nonce, accountId }')))
      .toEqual(["sends accountId, which the registered body does not declare", "sends accountId, a field the register forbids"]);
  });

  it("fails on a required header, the CSRF transport and the JSON content type", () => {
    expect(issuesOf(jurisdiction(conforming, '"content-type": "application/json", "x-inherit-csrf": csrf')))
      .toEqual(["omits the required header x-inherit-operation-nonce"]);
    expect(issuesOf(jurisdiction(conforming, '"content-type": "application/json", "x-inherit-operation-nonce": nonce')))
      .toEqual(["omits X-Inherit-CSRF, which mutationSecurityBindings.csrfTransport requires of this state-changing request"]);
    expect(issuesOf(jurisdiction(conforming, '"x-inherit-operation-nonce": nonce, "x-inherit-csrf": csrf')))
      .toEqual(["sends a JSON body without Content-Type: application/json, so the browser labels it text/plain"]);
  });

  it("reads a conditional required header only for the body it applies to", () => {
    const drafts = (body: string) => form('"/api/subject-drafts"',
      `{ method: "POST", headers: { "content-type": "application/json", "x-inherit-csrf": csrf }, body: JSON.stringify(${body}) }`);
    expect(issuesOf(drafts('{ kind: "adult", adultFlow: "path-a-own-account", contactEmail, requestId }')))
      .toEqual(["omits the required header x-inherit-operation-nonce"]);
    expect(issuesOf(drafts('{ kind: "adult", adultFlow: "path-b-subject-esignature", displayName, dateOfBirth, contactEmail, requestId }'))).toEqual([]);
    // requestId is registered on every subject-draft body (2026-10-23), so leaving it out is a divergence too.
    expect(issuesOf(drafts('{ kind: "adult", adultFlow: "path-b-subject-esignature", displayName, dateOfBirth, contactEmail }')))
      .toEqual(["omits requestId, which the registered body requires"]);
  });

  it("reports a required key the request sends only sometimes, unless a sibling body without it explains the branch", () => {
    expect(issuesOf(jurisdiction('{ ...(known ? { code } : {}), attestationVersion: 1, attestationHash: hash, affirmed: true }')))
      .toEqual(["may omit code, which the registered body requires"]);
    expect(issuesOf(jurisdiction('{ code, ...(states ? { subdivision } : {}), attestationVersion: 1, attestationHash: hash, affirmed: true }')))
      .toEqual([]);
    // The embryo disposition form sends proposalId only with "confirm"; the "propose" body does not declare it, so nothing is reported.
    const disposition = "src/components/settings/embryo-disposition.tsx";
    expect(real(disposition)).toContain("...(control.proposal?{proposalId:control.proposal.id}:{})");
    expect(run({}).issues.filter(issue => issue.file === disposition && issue.issue.startsWith("may omit"))).toEqual([]);
  });

  it("fails on a status the register does not let the route answer", () => {
    expect(issuesOf(jurisdiction(conforming, undefined, "if (response.status === 418) return;")))
      .toEqual(["branches on status 418, which no response contract of api.jurisdiction declares"]);
    expect(issuesOf(jurisdiction(conforming, undefined, "if ([200, 422].includes(response.status)) return;"))).toEqual([]);
  });

  it("follows a submission a form hands to a prop, and names a usage that sends nothing", () => {
    const component = "src/components/planted-delegating-form.tsx";
    const caller = "src/components/planted-caller.tsx";
    const result = run({
      [component]: 'export function Delegating({ onSave }: { onSave: () => Promise<void> }) {\n'
        + '  return <form onSubmit={async event => { event.preventDefault(); await onSave(); }} />;\n}\n',
      [caller]: 'import { Delegating } from "./planted-delegating-form";\n'
        + 'export function Caller() {\n  return <>\n'
        + '    <Delegating onSave={async () => { await fetch("/api/not-registered", { method: "POST" }); }} />\n'
        + '    <Delegating onSave={async () => {}} />\n  </>;\n}\n',
    });
    expect(result.issues.filter(issue => issue.file === caller).map(issue => issue.issue))
      .toEqual(["sends to /api/not-registered, which no register entry describes"]);
    expect(result.silent).toContainEqual({ file: component, usage: caller });
  });

  it("fails on a native form field its target does not declare", () => {
    const native = 'export function Native() {\n  return <>\n'
      + '    <form action="/auth/sign-out" method="post"><input name="next" /></form>\n'
      + '    <form action={route("genome.browser", params)}><input name="chromosome" /></form>\n  </>;\n}\n';
    expect(issuesOf(native)).toEqual([
      "submits named fields to an endpoint whose body the register forbids",
      "cannot send the required header x-inherit-csrf: a native form submission carries no custom header",
      "submits the field chromosome, which genome.browser declares no query contract for",
    ]);
  });

  it("accepts the extras the register lists since 2026-10-23, and still refuses their neighbours", () => {
    // genome.browser's q, and only q.
    expect(issuesOf('export function Native() {\n  return <form action={route("genome.browser", params)}><input name="q" /></form>;\n}\n'))
      .toEqual([]);
    expect(issuesOf('export function Native() {\n  return <form action={route("genome.browser", params)}><input name="q" /><input name="file" /></form>;\n}\n'))
      .toEqual(["submits the field file, which genome.browser declares no query contract for"]);
    // Path B's account branch: the registered withAccount body, with nothing added and nothing left out.
    const withdraw = (body: string) => form('"/api/withdraw/session"',
      `{ method: "POST", headers: { "content-type": "application/json", "x-inherit-csrf": csrf }, body: JSON.stringify(${body}) }`);
    const artifact = "{ artifactVersion, artifactPresentationToken, affirmed: true, statementKeys, typedName }";
    expect(issuesOf(withdraw(`{ operation: "confirm", nonce, withAccount: true, subjectArtifact: ${artifact} }`))).toEqual([]);
    expect(issuesOf(withdraw(`{ operation: "confirm", nonce, withAccount: true, subjectArtifact: ${artifact}, jurisdictionCode }`)))
      .toEqual(["sends jurisdictionCode, which the registered body does not declare"]);
    expect(issuesOf(withdraw('{ operation: "confirm", nonce, withAccount: true }')))
      .toEqual(["omits subjectArtifact, which the registered body requires"]);
    // api.chat's 409 and api.future-person-claim's 404 are registered; a neighbouring status is not.
    const chat = (after: string) => form('"/api/chat"', '{ method: "POST", headers: { "content-type": "application/json", "x-inherit-csrf": csrf }, body: JSON.stringify({ chatId, message }) }', after);
    expect(issuesOf(chat("if (response.status === 409) return;"))).toEqual([]);
    expect(issuesOf(chat("if (response.status === 410) return;"))).toEqual(["branches on status 410, which no response contract of api.chat declares"]);
    const claim = (after: string) => form('"/api/future-person/claim"', '{ method: "POST", headers: { "content-type": "application/json", "x-inherit-csrf": token }, body: JSON.stringify(intake) }', after);
    expect(issuesOf(claim("if (response.status === 404) return;")).filter(issue => issue.startsWith("branches"))).toEqual([]);
    expect(issuesOf(claim("if (response.status === 410) return;")).filter(issue => issue.startsWith("branches")))
      .toEqual(["branches on status 410, which no response contract of api.future-person-claim declares"]);
  });

  it("holds the sign-out response to sign-out-v1, and would notice it go back to /", () => {
    // G8.5 (2026-10-23): the shipped response now redirects to auth.sign-in, so
    // it has no issue; the old redirect to / is the planted defect.
    expect(signOutResponseIssues(signOutResponse("https://inherit.test"), register)).toEqual([]);
    const home = new Response(null, { status: 303, headers: { location: "https://inherit.test/" } });
    expect(signOutResponseIssues(home, register)).toEqual([{ file: SIGN_OUT_FORM, routeId: "auth.sign-out", method: "POST",
      issue: "responds 303 to / where sign-out-v1 names auth.sign-in (/auth/sign-in)" }]);
    expect(ledgerMismatch(run({}, home).issues.map(formIssueKey), recordedKeys()).unrecorded)
      .toEqual([`${SIGN_OUT_FORM} auth.sign-out POST: responds 303 to / where sign-out-v1 names auth.sign-in (/auth/sign-in)`]);
    const wrongStatus = new Response(null, { status: 302, headers: { location: "https://inherit.test/auth/sign-in" } });
    expect(signOutResponseIssues(wrongStatus, register).map(issue => issue.issue)).toEqual(["responds 302 where sign-out-v1 registers 303"]);
  });

  it("fails when the scripted sign-out stops sending its token, or goes back to a native form", () => {
    const source = real(SIGN_OUT_FORM);
    expect(source).toContain('headers: { "X-Inherit-CSRF": csrf.value() },');
    expect(mismatch({ [SIGN_OUT_FORM]: source.replace('headers: { "X-Inherit-CSRF": csrf.value() },', "") }).unrecorded)
      .toEqual([`${SIGN_OUT_FORM} auth.sign-out POST: omits the required header x-inherit-csrf`]);
    expect(mismatch({ [SIGN_OUT_FORM]: source.replace("<form onSubmit={submit}>", '<form action="/auth/sign-out" method="post">') }).unrecorded)
      .toEqual([`${SIGN_OUT_FORM} auth.sign-out POST: cannot send the required header x-inherit-csrf: a native form submission carries no custom header`]);
  });

  it("reads nothing from an empty tree, which the exact census above refuses", () => {
    const empty = census([], () => null, register, signOutResponse("https://inherit.test"));
    expect(empty.sites).toEqual([]);
    expect(empty.issues).toEqual([]);
  });
});

/**
 * Registered endpoints whose verbs match and whose answers do not, recorded in
 * `docs/register-contract-divergence.json#endpointResponseDivergence`. A form
 * census cannot see these (the export is a link, and its POST has no public
 * control), so each row is held to the register text it departs from and to
 * literal evidence in the code that answers; the cookieless export GET is also
 * driven in `src/app/api/export/route.test.ts`.
 */
describe("recorded endpoint response divergences stay true in both directions", () => {
  type ResponseRow = { routeId: string; method: string; case: string; evidence: { file: string; literal: string }[];
    registered: string; built: string; why: string; closing: string; closedBy: string };
  const rows = (JSON.parse(readFileSync(LEDGER, "utf8")) as { endpointResponseDivergence: ResponseRow[] }).endpointResponseDivergence;
  const exportEntry = register.routes.find(route => route.id === "api.export")!;

  it("records exactly the two api.export answers the register does not describe", () => {
    expect(rows.map(row => `${row.routeId} ${row.method} ${row.case}`))
      .toEqual(["api.export GET no-export-cookie", "api.export POST capability-unconfigured"]);
    for (const row of rows) {
      expect(["owner", "counsel", "engineering"]).toContain(row.closedBy);
      expect(row.why.length).toBeGreaterThan(150);
      for (const evidence of row.evidence) {
        expect(readFileSync(evidence.file, "utf8").includes(evidence.literal), `${evidence.file}: ${evidence.literal}`).toBe(true);
      }
    }
  });

  it("still reads the register text each row departs from", () => {
    const get = exportEntry.methodRequestContracts?.GET as { missingPrincipalBoundExportCookie?: string };
    expect(get.missingPrincipalBoundExportCookie).toBe("resource-not-found-v1");
    expect((exportEntry as { policy?: { methodPolicies?: { GET?: string } } }).policy?.methodPolicies?.GET).toMatch(/^poll-status-only-/);
    // A 503 bound to api.export would make the POST row stale.
    expect(registeredStatuses(exportEntry, "POST", register)).not.toContain(503);
    expect(registeredStatuses(exportEntry, "POST", register)).toContain(202);
  });
});

/**
 * G8.5 (owner decision 2026-10-23, "CSRF: build the token everywhere"): every
 * request the browser makes, not only the ones a form makes. The client is
 * every `"use client"` module and every local module one imports for a value
 * (`clientModules`), and its requests are every `fetch` call and AI SDK chat
 * transport in them (`fileRequests`). A request a form makes is read by the
 * form census above, with its arguments bound, and is not read twice; every
 * other one is read here, with no argument bound, and its divergences are
 * compared in both directions with
 * `docs/register-contract-divergence.json#clientRequestDivergence`. No
 * request, form or not, may omit the X-Inherit-CSRF the register requires.
 */
/** Every shipped `.ts` and `.tsx`, the modules the client graph is drawn from. */
function shippedSources(): string[] {
  const found: string[] = [];
  const walk = (directory: string) => {
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "node_modules") walk(full); continue; }
      if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec|fixtures|test-support)\./.test(entry.name)) found.push(full.split(path.sep).join("/"));
    }
  };
  for (const root of CODE_ROOTS) walk(root);
  return found.sort();
}

interface ClientCensus { modules: string[]; calls: ClientRequest[]; unformed: ClientRequest[]; issues: FormIssue[] }

function clientCensus(sources: string[], read: SourceReader, document: RegisterDocument, forms: Census): ClientCensus {
  const modules = clientModules(sources, read);
  const calls = modules.flatMap(file => fileRequests(file, read));
  const formed = new Set(forms.requests.map(request => `${request.file}:${request.line}`));
  const unformed = calls.filter(request => !formed.has(`${request.file}:${request.line}`));
  return { modules, calls, unformed, issues: unformed.flatMap(request => requestIssues(request, document)) };
}

const sources = shippedSources();
const client = clientCensus(sources, disk, register, actual);
const recordedClientKeys = () => ledger.clientRequestDivergence.flatMap(row =>
  row.issues.map(issue => formIssueKey({ file: row.file, routeId: row.routeId, method: row.method, issue })));
/** A reviewed request's issues carry no route or method: it is not a request to an Inherit route. */
const reviewedClientKeys = () => ledger.clientRequestReview.flatMap(row =>
  row.issues.map(issue => formIssueKey({ file: row.file, routeId: null, method: null, issue })));
/** Every client issue the ledger accounts for: a recorded divergence or a reviewed request. */
const accountedClientKeys = () => [...recordedClientKeys(), ...reviewedClientKeys()];
const CSRF_OMISSION = /X-Inherit-CSRF|x-inherit-csrf/u;

describe("every client request sends what its register entry declares (G8.5)", () => {
  it("reads every client module and every request in them, so a passing run is not an empty scan", () => {
    // The exact census. 2026-10-23: 225 modules (97 of them "use client"),
    // 89 requests (88 fetch calls and the chat transport); 26 request sites
    // are a form's (its 28 requests, two of them read through two usages).
    // After the merge with G8.5's form shapes and D-103: 226 modules (D-103's
    // copy module, imported by the adult confirm), 90 requests, all fetch
    // calls (the compatibility panel's transport became a fetch, and the
    // Embryo gate's server action became a fetch of api.embryo-acknowledge),
    // 64 of them made by no form.
    // 2026-10-24 (G8.5): a fetch in a local function that only its own file
    // calls is read once per call (localCallSites). Ten such fetches are
    // read 24 times, so 104 requests from the same 90 fetch calls; 74 are
    // made by no form (the other 14 readings are of three form handlers' fetches).
    expect(client.modules).toHaveLength(226);
    expect(client.modules.filter(file => /^\s*["']use client["']/u.test(readFileSync(file, "utf8")))).toHaveLength(97);
    expect(client.calls).toHaveLength(104);
    expect(new Set(client.calls.map(request => `${request.file}:${request.line}`)).size).toBe(90);
    expect(client.calls.filter(request => request.via === "ai-sdk-default-chat-transport")).toHaveLength(0);
    expect(new Set(actual.requests.map(request => `${request.file}:${request.line}`)).size).toBe(26);
    expect(client.unformed).toHaveLength(74);
    // Every request a form makes is one of the client's, read once.
    const calls = new Set(client.calls.map(request => `${request.file}:${request.line}`));
    expect(actual.requests.filter(request => !calls.has(`${request.file}:${request.line}`))).toEqual([]);
    // It reaches helpers a component calls, which carry no directive of their own.
    for (const helper of ["src/lib/family/permission-response.ts", "src/lib/uploads/file-delete-browser.ts",
      "src/lib/uploads/own-report-choice-browser.ts", "src/lib/security/session-csrf-client.ts"]) expect(client.modules).toContain(helper);
    expect(client.modules.some(file => /^\s*import\s+["']server-only["']/mu.test(readFileSync(file, "utf8")))).toBe(false);
  });

  it("sends X-Inherit-CSRF on every request the register binds, a form's or not", () => {
    expect([...actual.issues, ...client.issues].filter(issue => CSRF_OMISSION.test(issue.issue)).map(formIssueKey)).toEqual([]);
    for (const row of [...ledger.formRequestDivergence, ...ledger.clientRequestDivergence]) {
      expect(row.issues.filter(issue => CSRF_OMISSION.test(issue)), `${row.file} ${row.routeId}`).toEqual([]);
    }
  });

  it("records every other divergence of a request no form makes, in both directions", () => {
    // A reviewed request (clientRequestReview) is accounted for there, never twice.
    const reviewed = new Set(reviewedClientKeys());
    expect(recordedClientKeys().filter(key => reviewed.has(key))).toEqual([]);
    const { unrecorded, stale } = ledgerMismatch(client.issues.map(formIssueKey).filter(key => !reviewed.has(key)), recordedClientKeys());
    expect(unrecorded, "divergences no clientRequestDivergence row records").toEqual([]);
    expect(stale, "clientRequestDivergence rows whose divergence no longer exists").toEqual([]);
  });

  it("names every client request that is not a request to an Inherit route, in both directions, anchored to its code", () => {
    // G8.5, 24 October 2026: a first-party static asset, and an object URL of
    // bytes already in the page. Each row's issues are exactly what the census reports for it.
    const present = new Set(client.issues.map(formIssueKey));
    expect(reviewedClientKeys().filter(key => !present.has(key)), "reviewed requests the census no longer reports").toEqual([]);
    expect(new Set(reviewedClientKeys()).size).toBe(reviewedClientKeys().length);
    expect(ledger.clientRequestReview.map(row => `${row.file}: ${row.requests}`)).toEqual([
      "src/components/browse/igv-reference.ts: the public first-party chromosome-size reference public/genomes/hg38.chrom.sizes",
      "src/lib/future-person/review-pdf.ts: the inert PDF viewer's own asset manifest, generated into public/review-document-assets/ at build",
      "src/lib/future-person/review-pdf.ts: a blob: object URL of a document the reviewer's reader already downloaded and verified",
    ]);
    for (const row of ledger.clientRequestReview) {
      expect(row.why.length, row.file).toBeGreaterThan(150);
      expect(row.closing.length, row.file).toBeGreaterThan(60);
      expect(row.evidence.length).toBeGreaterThan(0);
      for (const evidence of row.evidence) {
        expect(readFileSync(evidence.file, "utf8").includes(evidence.literal), `${evidence.file}: ${evidence.literal}`).toBe(true);
      }
    }
    expect(ledger.clientRequestReviewNote.length).toBeGreaterThan(200);
  });

  it("says why each client divergence exists, what closes it and who has to act", () => {
    const groups = new Set<string>();
    for (const row of ledger.clientRequestDivergence) {
      const group = `${row.file} ${row.routeId} ${row.method}`;
      expect(groups.has(group), `${group} is split across rows`).toBe(false);
      groups.add(group);
      expect(["owner", "counsel", "engineering"]).toContain(row.closedBy);
      expect(row.issues.length).toBeGreaterThan(0);
      expect(row.why.length, group).toBeGreaterThan(150);
      expect(row.closing.length, group).toBeGreaterThan(60);
    }
    expect(ledger.clientRequestDivergenceNote.length).toBeGreaterThan(300);
  });
});

describe("the client census fails on a planted divergence", () => {
  const overlay = (files: Record<string, string>): SourceReader => (file) => file in files ? files[file] : disk(file);
  const real = (file: string) => readFileSync(file, "utf8");
  const run = (planted: Record<string, string>) => {
    const names = [...new Set([...sources, ...Object.keys(planted)])].sort();
    const read = overlay(planted);
    const forms = census(names.filter(name => name.endsWith(".tsx")), read, register, signOutResponse("https://inherit.test"));
    return { ...clientCensus(names, read, register, forms), formIssues: forms.issues };
  };
  /** CSRF omissions anywhere, a form's request or not. */
  const csrfOmissions = (result: ReturnType<typeof run>) => [...result.formIssues, ...result.issues]
    .filter(issue => CSRF_OMISSION.test(issue.issue)).map(formIssueKey);

  it("fails when a button's request drops its token", () => {
    const file = "src/components/settings/consent-list.tsx";
    const source = real(file);
    // Since 2026-10-24 the revocation also sends the page's operation nonce (G8.5); the token is still what is dropped.
    const sent = 'method: "POST", headers: { "X-Inherit-Operation-Nonce": g.revokeNonce, "X-Inherit-CSRF": csrf.value() },';
    expect(source).toContain(sent);
    expect(csrfOmissions(run({ [file]: source.replace(sent, 'method: "POST", headers: { "X-Inherit-Operation-Nonce": g.revokeNonce },') })))
      .toEqual([`${file} api.consent-revoke POST: omits X-Inherit-CSRF, which mutationSecurityBindings.csrfTransport requires of this state-changing request`]);
  });

  it("fails when a helper a component imports drops its token, though the helper has no directive", () => {
    const file = "src/lib/uploads/file-delete-browser.ts";
    const source = real(file);
    expect(source).not.toMatch(/^\s*["']use client["']/u);
    expect(csrfOmissions(run({ [file]: source.replace('headers: { "X-Inherit-CSRF": csrf.value() } });', "});") })))
      .toEqual([`${file} api.file-delete DELETE: omits X-Inherit-CSRF, which mutationSecurityBindings.csrfTransport requires of this state-changing request`]);
  });

  it("fails when the chat panel stops sending its token, or the SDK transport wraps its request in something it cannot read", () => {
    // The compatibility panel's fetch (since the merge with G8.5's form shapes, it is a fetch, not the SDK transport).
    const file = "src/components/chat/chat-panel.tsx";
    const source = real(file);
    const header = 'headers: { "content-type": "application/json", "X-Inherit-CSRF": csrf.value() },';
    expect(source).toContain(header);
    expect(csrfOmissions(run({ [file]: source.replace(header, 'headers: { "content-type": "application/json" },') })))
      .toEqual([`${file} api.chat POST: omits X-Inherit-CSRF, which mutationSecurityBindings.csrfTransport requires of this state-changing request`]);
    // The census still reads an SDK transport's header function and its fetch wrapper: a planted panel, as this
    // branch's own panel was before the merge (src/components/chat/chat-panel.tsx at ba3245d8, reduced).
    const planted = "src/components/chat/planted-sdk-panel.tsx";
    const sdk = [
      '"use client";',
      'import { useChat } from "@ai-sdk/react";',
      'import { DefaultChatTransport } from "ai";',
      'import { useCsrf } from "@/components/security/csrf-provider";',
      "export function PlantedPanel({ scope }: { scope: string }) {",
      '  const csrf = useCsrf("api.chat");',
      "  const { sendMessage } = useChat({",
      "    transport: new DefaultChatTransport({",
      "      api: `/api/chat?scope=${encodeURIComponent(scope)}`,",
      '      headers: () => ({ "X-Inherit-CSRF": csrf.value() }),',
      "      fetch: async (input, init) => {",
      "        const response = await fetch(input, init);",
      "        csrf.accept(response);",
      "        return response;",
      "      },",
      "    }),",
      "  });",
      '  return <button onClick={() => { void sendMessage({ text: "question" }); }}>Send</button>;',
      "}",
    ].join("\n");
    const headers = '      headers: () => ({ "X-Inherit-CSRF": csrf.value() }),\n';
    expect(csrfOmissions(run({ [planted]: sdk }))).toEqual([]);
    expect(csrfOmissions(run({ [planted]: sdk.replace(headers, "") })))
      .toEqual([`${planted} api.chat POST: omits X-Inherit-CSRF, which mutationSecurityBindings.csrfTransport requires of this state-changing request`]);
    const unread = run({ [planted]: sdk.replace("const response = await fetch(input, init);", "const response = await fetch(input, { ...init, keepalive: true });") });
    expect([...unread.formIssues, ...unread.issues].filter(issue => issue.file === planted).map(issue => issue.issue))
      .toContain("sends headers the census cannot resolve");
  }, 30_000); // four whole-tree census runs, about 5 s alone

  it("follows value imports from a client module and no type-only one", () => {
    const entry = "src/components/planted-client-entry.tsx";
    const helper = "src/lib/planted-client-helper.ts";
    const typed = "src/lib/planted-type-only.ts";
    const result = run({
      [entry]: '"use client";\nimport { send } from "@/lib/planted-client-helper";\nimport type { Shape } from "@/lib/planted-type-only";\n'
        + 'export function Planted() { return <button onClick={() => send()}>Go</button>; }\n',
      [helper]: 'export async function send() { await fetch("/api/settings/jurisdiction", { method: "PUT" }); }\n',
      [typed]: 'export type Shape = { a: 1 };\nexport async function never() { await fetch("/api/chromosomal-sex", { method: "POST" }); }\n',
    });
    expect(result.modules).toContain(helper);
    expect(result.modules).not.toContain(typed);
    expect(csrfOmissions(result)).toEqual([
      `${helper} api.jurisdiction PUT: omits X-Inherit-CSRF, which mutationSecurityBindings.csrfTransport requires of this state-changing request`,
    ]);
  });

  it("records a new non-CSRF divergence of a request no form makes, and notices a recorded one close", () => {
    // Re-targeted on 2026-10-24: the consent list's recorded nonce row closed (it sends the nonce now).
    const browser = "src/components/browse/genome-browser.tsx";
    const recorded = recordedClientKeys().filter(key => key.startsWith(`${browser} api.browse-region POST:`));
    expect(recorded).toHaveLength(7);
    const sent = "body: JSON.stringify({\n        file: region.file, chromosome: region.chromosome, start: region.start, end: region.end,\n      }),";
    expect(real(browser)).toContain(sent);
    const fixed = run({ [browser]: real(browser).replace(sent,
      "body: JSON.stringify({ subject: region.file, region: { chromosome: region.chromosome, start: region.start, end: region.end }, nonce: region.file }),") });
    expect(ledgerMismatch(fixed.issues.map(formIssueKey), accountedClientKeys()).stale.sort()).toEqual(recorded.sort());
    const file = "src/components/settings/consent-list.tsx";
    const source = real(file);
    const headers = 'method: "POST", headers: { "X-Inherit-Operation-Nonce": g.revokeNonce, "X-Inherit-CSRF": csrf.value() },';
    expect(source).toContain(headers);
    expect(ledgerMismatch(run({ [file]: source.replace(headers, 'method: "POST", headers: { "X-Inherit-CSRF": csrf.value() },') }).issues
      .map(formIssueKey), accountedClientKeys()).unrecorded)
      .toEqual([`${file} api.consent-revoke POST: omits the required header x-inherit-operation-nonce`]);
    const added = run({ [file]: source.replace(headers, `${headers} body: JSON.stringify({ grantId: g.id }),`) });
    expect(ledgerMismatch(added.issues.map(formIssueKey), accountedClientKeys()).unrecorded)
      .toEqual([`${file} api.consent-revoke POST: sends a body the register forbids`]);
  });

  /** Only the issues the planted run reports for one file. */
  const issuesIn = (result: ReturnType<typeof run>, file: string) => [...new Set([...result.formIssues, ...result.issues]
    .filter(issue => issue.file === file).map(formIssueKey))].sort();
  /** A copy of the register with one route's bound response contract removed. */
  const unbound = (routeId: string, contract: string): RegisterDocument => {
    const copy = JSON.parse(JSON.stringify(register)) as RegisterDocument & { routes: { id: string; successResponseContract?: string }[] };
    copy.responseContractBindings.routes[routeId] = copy.responseContractBindings.routes[routeId].filter(name => name !== contract);
    for (const route of copy.routes) if (route.id === routeId && route.successResponseContract === contract) delete route.successResponseContract;
    return copy;
  };
  const runWith = (document: RegisterDocument) => {
    const forms = census(sources.filter(name => name.endsWith(".tsx")), disk, document, signOutResponse("https://inherit.test"));
    return clientCensus(sources, disk, document, forms);
  };

  // G8.5, 24 October 2026: what the census reads now, each with a planted defect.
  it("reads a binary chunk as the octet-stream body its route registers, and fails one unlabelled or sent where JSON is registered", () => {
    const file = "src/components/future-person/claim-documents.tsx";
    const source = real(file);
    expect(issuesIn(run({}), file)).toEqual([]);
    const label = 'headers: { "content-type": "application/octet-stream", "x-inherit-csrf": csrf },';
    expect(source).toContain(label);
    expect(issuesIn(run({ [file]: source.replace(label, 'headers: { "x-inherit-csrf": csrf },') }), file)).toEqual([
      `${file} api.evidence-chunk PUT: labels its binary body with no Content-Type where the register declares application/octet-stream`,
    ]);
    const helper = "src/lib/planted-binary.ts";
    const entry = "src/components/planted-binary-entry.tsx";
    const planted = (body: string) => run({
      [entry]: '"use client";\nimport { send } from "@/lib/planted-binary";\nexport function Planted() { return <button onClick={() => send()}>Go</button>; }\n',
      [helper]: `export async function send() { const bytes = new Uint8Array(4); const text = "x"; await fetch("/api/settings/jurisdiction", { method: "PUT",\n`
        + `  headers: { "content-type": "application/octet-stream", "x-inherit-csrf": "c", "x-inherit-operation-nonce": "n" }, body: ${body} }); }\n`,
    });
    expect(issuesIn(planted("bytes.subarray(0, 2)"), helper))
      .toEqual([`${helper} api.jurisdiction PUT: sends a binary body where the register declares a JSON body`]);
    // A body that is not bytes is still unresolved, whatever the request labels it.
    expect(issuesIn(planted("text"), helper)).toEqual([`${helper} api.jurisdiction PUT: sends a body the census cannot resolve (text)`]);
  });

  it("holds each response binding to its own statuses, and still fails one compared on the chunk's own binding", () => {
    const file = "src/components/future-person/public-appeal-documents.tsx";
    const source = real(file);
    expect(issuesIn(run({}), file)).toEqual([]);
    const check = 'if (answer.status !== 204) throw new Error("document_unavailable");';
    expect(source).toContain(check);
    expect(issuesIn(run({ [file]: source.replace(check, 'if (answer.status !== 204 && answer.status !== 418) throw new Error("document_unavailable");') }), file))
      .toEqual([`${file} api.evidence-chunk PUT: branches on status 418, which no response contract of api.evidence-chunk declares`]);
  });

  it("follows a local function's calls with their arguments bound, and only when those calls are every way it runs", () => {
    const file = "src/components/settings/danger-zone.tsx";
    const source = real(file);
    expect(issuesIn(run({}), file)).toEqual([]);
    expect(source).toContain('"/api/account/delete/cancel",');
    expect(issuesIn(run({ [file]: source.replace('"/api/account/delete/cancel",', '"/api/account/delete/undo",') }), file))
      .toEqual([`${file} (unregistered) (method?): sends to /api/account/delete/undo, which no register entry describes`]);
    // A function that is also passed as a value keeps its unbound reading.
    const planted = "src/components/planted-passed-helper.tsx";
    const helper = (extra: string) => run({ [planted]: '"use client";\nexport function Planted() {\n'
      + '  async function post(path: string) { await fetch(path, { method: "POST", headers: { "x-inherit-csrf": "c" } }); }\n'
      + `  return <button onClick={() => { void post("/api/consents/revoke-all");${extra} }}>Go</button>;\n}\n` });
    expect(issuesIn(helper(""), planted).filter(issue => issue.includes("unresolved"))).toEqual([]);
    expect(issuesIn(helper(" [\"/a\"].forEach(post);"), planted))
      .toEqual([`${planted} (unregistered) (method?): sends to an unresolved target (path), which no register entry describes`]);
  });

  it("decides a bound parameter's branch, so each call is held to the one body its branch builds", () => {
    const file = "src/components/uploads/adult-upload-revision-form.tsx";
    const source = real(file);
    expect(issuesIn(run({}), file)).toEqual([]);
    const confirm = "? { operation, uploadRevisionAffirmed: true, nonce: review.nonce }";
    expect(source).toContain(confirm);
    expect(issuesIn(run({ [file]: source.replace(confirm, "? { operation, nonce: review.nonce }") }), file))
      .toEqual([`${file} api.withdraw POST: omits uploadRevisionAffirmed, which the registered body requires`]);
  });

  it("joins a concatenated path, so the request it names is held to its entry", () => {
    const helper = "src/lib/planted-joined-path.ts";
    const entry = "src/components/planted-joined-entry.tsx";
    const result = run({
      [entry]: '"use client";\nimport { put } from "@/lib/planted-joined-path";\nexport function Planted() { return <button onClick={() => put()}>Go</button>; }\n',
      [helper]: 'const BASE = "/api/settings/";\nexport async function put() { await fetch(BASE + "jurisdiction", { method: "PUT" }); }\n',
    });
    expect(csrfOmissions(result)).toEqual([
      `${helper} api.jurisdiction PUT: omits X-Inherit-CSRF, which mutationSecurityBindings.csrfTransport requires of this state-changing request`,
    ]);
  });

  it("reads a zod parse's output as its schema's keys, and fails a key the registered body does not declare", () => {
    const file = "src/lib/uploads/subject-upload-browser.ts";
    const contract = "src/lib/uploads/subject-upload-contract.ts";
    expect(issuesIn(run({}), file)).toEqual([]);
    const schema = 'z.object({ subjectId: z.union([uuid, z.literal("me")]), declaredFormat: z.enum(SUBJECT_UPLOAD_FORMATS), ...declaration }).strict(),';
    expect(real(contract)).toContain(schema);
    expect(issuesIn(run({ [contract]: real(contract).replace(schema, schema.replace("...declaration }", "...declaration, fileName: z.string() }")) }), file))
      .toEqual([`${file} api.file-upload-session POST: sends fileName, which the registered body does not declare`]);
    expect(issuesIn(run({ [contract]: real(contract).replace(schema, schema.replace(".strict(),", ".passthrough(),")) }), file))
      .toEqual([`${file} api.file-upload-session POST: sends a body the census cannot fully resolve`]);
  });

  it("fails when a request goes back to forwarding a value it cannot read instead of the registered fields", () => {
    const cases: [string, string, string, string][] = [
      ["src/lib/family/permission-response.ts", 'body: JSON.stringify({ action: "grant-purpose",', 'body: JSON.stringify({ ...action.request,',
        "api.consents POST: sends a body the census cannot fully resolve"],
      ["src/lib/future-person/read-review-document.ts", "body:JSON.stringify({proof,nonce}),", "body:JSON.stringify(proofs[sequence]),",
        "api.claim-review-chunk-acknowledgement POST: sends a body the census cannot resolve (JSON.stringify(proofs[sequence]))"],
      ["src/components/future-person/public-appeal-case-rejection.tsx",
        '? { priorDecisionRevision: reversal.priorDecisionRevision, evidenceRevision: reversal.evidenceRevision } : {})', "? reversal : {})",
        "api.appeal-review POST: sends a body the census cannot fully resolve"],
    ];
    for (const [file, named, forwarded, issue] of cases) {
      expect(real(file), file).toContain(named);
      expect(issuesIn(run({ [file]: real(file).replace(named, forwarded) }), file), file).toContain(`${file} ${issue}`);
    }
  }, 30_000);

  it("fails again on each status row the register closed, once its answer is unbound", () => {
    const cases: [string, string, string][] = [
      ["api.file-delete", "file-delete-v1", "src/lib/uploads/file-delete-browser.ts api.file-delete DELETE: branches on status 204, which no response contract of api.file-delete declares"],
      ["api.consent-revoke", "consent-revocation-v1", "src/lib/uploads/own-report-choice-browser.ts api.consent-revoke POST: branches on status 200, which no response contract of api.consent-revoke declares"],
      ["api.future-person-claim-document-session", "public-capacity-limited-v1",
        "src/components/future-person/claim-documents.tsx api.future-person-claim-document-session POST: branches on status 429, which no response contract of api.future-person-claim-document-session declares"],
    ];
    for (const [routeId, contract, issue] of cases) {
      expect(register.responseContractBindings.routes[routeId], routeId).toContain(contract);
      expect(runWith(unbound(routeId, contract)).issues.map(formIssueKey), routeId).toContain(issue);
    }
  }, 30_000);

});
