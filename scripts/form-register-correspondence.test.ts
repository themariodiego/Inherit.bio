import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { signOutResponse } from "../src/app/auth/sign-out/response";
import {
  AI_SDK_CHAT_BODY_KEYS,
  CONDITIONAL_REQUIRED_HEADERS,
  diskReader,
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
const SIGN_OUT_FORM = "src/components/site/app-shell.tsx";

type DivergenceRow = { file: string; routeId: string; method: string; issues: string[]; why: string; closing: string; closedBy: string };
type ReviewRow = { file: string; usage: string; submits: string; evidence: { file: string; literal: string }[]; why: string; closing: string };
type Ledger = { formRequestDivergence: DivergenceRow[]; formSubmissionReview: ReviewRow[]; csrfTransportNote: string };

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
    expect(actual.sites).toHaveLength(26);
    expect(actual.sites.filter(site => site.action !== null)).toHaveLength(2);
    expect(actual.sites.filter(site => site.action === null && site.handlerResolved)).toHaveLength(24);
    expect(actual.requests.length).toBe(27);
    expect(actual.requests.filter(request => request.via === "ai-sdk-default-chat-transport")).toHaveLength(1);
    expect(new Set(actual.requests.map(request => request.file)).size).toBe(22);
    // And it really reaches the shapes the checks below depend on.
    const jurisdiction = actual.requests.find(request => request.file === "src/components/settings/jurisdiction-form.tsx")!;
    expect(jurisdiction.methods).toEqual(["PUT"]);
    expect(jurisdiction.headers.names).toEqual(["content-type", "x-inherit-operation-nonce"]);
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

  it("holds the llm-settings form to its registered bodies: the legacy body fails, an always-sent key closes the one recorded row", () => {
    const file = "src/components/settings/llm-settings-form.tsx";
    const source = real(file);
    const sent = "body: JSON.stringify(body),";
    expect(source).toContain(sent);
    const legacy = mismatch({ [file]: source.replace(sent,
      "body: JSON.stringify({ provider, base_url, model: chosenModel, api_key: apiKey || null }),") });
    expect(legacy.unrecorded).toEqual([
      `${file} api.llm-settings POST: omits apiKey, which the registered body requires`,
      `${file} api.llm-settings POST: omits mode, which the registered body requires`,
      `${file} api.llm-settings POST: sends api_key, which the registered body does not declare`,
      `${file} api.llm-settings POST: sends base_url, which the registered body does not declare`,
    ]);
    const optional = /\.\.\.\(apiKey \? \{ apiKey \} : \{\}\)/g;
    expect(source.match(optional)).toHaveLength(3);
    const required = mismatch({ [file]: source.replace(optional, "apiKey") });
    expect(required.unrecorded).toEqual([]);
    expect(required.stale).toEqual([`${file} api.llm-settings POST: may omit apiKey, which the registered body requires`]);
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

  it("holds the sign-out response to sign-out-v1, and would notice the recorded divergence close", () => {
    expect(signOutResponseIssues(signOutResponse("https://inherit.test"), register))
      .toEqual([{ file: SIGN_OUT_FORM, routeId: "auth.sign-out", method: "POST",
        issue: "responds 303 to / where sign-out-v1 names auth.sign-in (/auth/sign-in)" }]);
    const fixed = new Response(null, { status: 303, headers: { location: "https://inherit.test/auth/sign-in" } });
    expect(signOutResponseIssues(fixed, register)).toEqual([]);
    const result = run({}, fixed);
    expect(ledgerMismatch(result.issues.map(formIssueKey), recordedKeys()).stale)
      .toEqual([`${SIGN_OUT_FORM} auth.sign-out POST: responds 303 to / where sign-out-v1 names auth.sign-in (/auth/sign-in)`]);
    const wrongStatus = new Response(null, { status: 302, headers: { location: "https://inherit.test/auth/sign-in" } });
    expect(signOutResponseIssues(wrongStatus, register).map(issue => issue.issue)).toEqual(["responds 302 where sign-out-v1 registers 303"]);
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
