# ADR-0033 — Copilot through the person's own assistant subscription: a read-only Inherit connector the person adds, never a subscription sign-in inside Inherit

- Status: **Proposed** · 26 September 2026. Nothing here is built or approved.
- Deciders: the owner. The consent text needs the owner's approval and, if the
  connector is classed as a restricted capability, a signed legal review under
  `signedReviewContract` in `data/jurisdictions.json`.
- Records: the owner's request of 26 September 2026 and the options examined
  for it. It makes no legal determination and changes no register.

## The request

The owner, 26 September 2026:

> It would be nice if users could use their existing ChatGPT, Claude or Grok
> subscriptions for /copilot/me … I mean to connect to their existing
> subscriptions instead of using an API key.

Restated as a goal: a person who already pays for a chat assistant can ask that
assistant about their own Inherit results without buying API access and pasting
a key into Inherit.

## What Copilot is today

- **Bring your own key** (ADR 0004). A key for `anthropic` or for an
  `openai_compatible` endpoint is stored encrypted in `llm_keys`. Inference
  runs in Inherit's server (`src/app/api/chat/route.ts`,
  `src/lib/copilot/own-chat-route.ts`).
- **Authority.** Every chat is bound to a Copilot purpose grant
  (`copilot.local` or `copilot.cloud`) and, for a cloud model, a provider
  recipient grant naming the provider, model and address
  (`src/lib/copilot/own-provider-authority.ts`,
  `content/legal/consent.own-copilot-cloud/v2.md`). The authority is checked
  again before every tool read and inside the pinned connection to the model.
- **Data.** The model sees results only through five tools over a bounded
  projection (`src/lib/copilot/own-chat-content.ts`): `get_genotype`,
  `search_variants`, `list_reports`, `get_report` and `get_prs`. Saved
  ancestry needs its own purpose grant.
- **Output.** The whole completion is buffered and checked by
  `src/lib/copilot/guard.ts` before any byte reaches the person. Every number
  must come from that turn's tool output or `config/allowed-numerals.json`,
  every citation from the tools, and a gated intent gets its fixed refusal.
  This is acceptance row G4.8.
- **Jurisdiction.** Own Copilot is adult self-analysis, which no jurisdiction
  restricts (`unrestrictedCapabilities.adult_self_analysis`; ADR 0032 §3).
- **Rights.** Saved chats are exported (`chats.json`) and follow revocation and
  account deletion (`docs/retention.md`: `cloud-model.access-immediate`,
  `account-deletion.notice-7d`).

## What was found on 26 September 2026

There are two directions. In **sign-in**, Inherit signs in to the person's
assistant account and sends requests as that person. In a **connector**, the
person adds Inherit as a tool inside their own assistant app, and the assistant
calls Inherit. Nothing below was tested with a real account.

**Sign-in from a third-party app.**

- **Claude (Anthropic).** Read today on the
  [legal and compliance page, "Authentication and credential use"](https://code.claude.com/docs/en/legal-and-compliance):
  "Anthropic does not permit third-party developers to offer Claude.ai login
  into their own applications, or to route requests through Free, Pro, or Max
  plan credentials on behalf of their users. Moreover, developers may not
  collect, store, or intermediate Claude.ai credentials or session tokens".
  Developers "should use API key authentication".
- **ChatGPT (OpenAI).** OpenAI's own page on
  [Sign in with ChatGPT](https://developers.openai.com/codex/auth) describes it
  only for its Codex tools (desktop app, CLI and IDE extension) and says
  nothing about other apps. An article of 1 July 2026
  ([manifest.build](https://manifest.build/blog/chatgpt-plus-tokens-third-party-harnesses/))
  reports that some third-party coding tools already accept it, calls it
  something OpenAI seems to "tolerate, not something they've committed to",
  and says OpenAI's terms neither permit nor prohibit it. A request to open it
  to third-party apps
  ([OpenAI community forum, 4 April 2026](https://community.openai.com/t/login-with-chatgpt-allow-users-to-use-their-own-plus-subscription-in-3rd-party-apps/1378506))
  was closed automatically the next day with no staff reply. No published
  registration or terms for other apps were found.
- **Grok (xAI).** Some third-party apps let people sign in with a SuperGrok or
  X Premium subscription through xAI's OAuth.
  [Warp's guide](https://docs.warp.dev/agent-platform/inference/grok-subscription/)
  (updated 24 September 2026) says it "completes a standard OAuth login" on
  xAI's consent screen, and that "data retention on xAI's side is governed by
  your own xAI account and its terms".
  [LobeHub's guide](https://lobehub.com/docs/usage/providers/supergrok)
  describes the same; on 26 September the page itself rendered only a stub, so
  its content was read from a search-index copy. Kilo Code is reported to do
  the same and was not checked. No published xAI terms for third-party use of
  this sign-in were found. Secondary sources say the subscription includes no
  API access; that was not confirmed at a primary source.

**Connectors inside the assistant apps.** All three document a way for a person
to add a remote MCP server:

| App | What its own documentation says | Not verified |
| --- | --- | --- |
| Claude | [Custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) (updated 11 August 2026) "are available on Claude, Cowork, and Claude Desktop for users on Free, Pro, Max, Team, and Enterprise plans". "Free users are limited to one custom connector." OAuth is supported. | Behaviour with Inherit's server. |
| ChatGPT | [Developer mode](https://developers.openai.com/api/docs/guides/developer-mode) is "Available to Pro, Plus, Business, Enterprise, and Education accounts on the web", with MCP client support for read and write tools, and OAuth through Client ID Metadata Documents or dynamic registration. | The help-centre article on the same feature returned HTTP 403, so any per-plan limit it states is unread. |
| Grok | [xAI's connectors page](https://docs.x.ai/grok/connectors) documents adding your own MCP server at grok.com/connectors and says "Connectors are available to all Grok users"; Business and Enterprise need an admin to provision first. | Which tiers may add a custom server, and which authentication a custom server may use; the page states neither. |

The connector protocol is the MCP authorization specification,
[revision 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization):
OAuth 2.1 with PKCE ([RFC 7636](https://www.rfc-editor.org/rfc/rfc7636)),
audience-bound tokens through resource indicators
([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707)), protected resource
metadata ([RFC 9728](https://www.rfc-editor.org/rfc/rfc9728)), and client
registration by Client ID Metadata Documents, with dynamic registration kept
only for compatibility.

## Options considered

### (a) Sign in to the person's subscription inside Inherit

- **Claude:** rejected. The vendor's published policy forbids it in terms.
- **ChatGPT:** rejected for now. The documented flow serves the vendor's own
  tools, and the reported third-party use rests on tolerance, not published
  terms. Revisit only if a program for third-party apps is published with
  terms that cover health data.
- **Grok:** rejected. The flow is in use by some apps, but no terms were found
  that allow it, and nothing says what the vendor may change or refuse.

Common to all three: Inherit would hold a credential to the person's whole
assistant account, including every unrelated chat, which is a far larger thing
to lose than a token that reads a few Inherit results. The model call would also
run under consumer terms that Inherit cannot see. One point in this option's
favour, stated for fairness: it is the only option in which Inherit's own output
guard would still apply, because Inherit would still make the model call.

### (b) An Inherit connector (remote MCP server, OAuth 2.1 with PKCE, per-tool scopes)

**Proposed.** It is the direction each vendor documents for its own customers,
and Inherit never touches the person's assistant credential. It carries real
costs, set out under "Trade-offs" below: the output guard cannot apply, and the
results enter a consumer chat history.

### (c) Bring-your-own-key presets

Being built separately. Presets keep every existing control (consent, recipient
grant, output guard), but the person still needs an API key and pays for API
use, so they do not answer this request alone. Not decided here.

### (d) A person-initiated "copy a safe summary"

**Proposed as the first step.** A button on a report page and on the ancestry
page copies plain text built from the same projection as the connector's
`read_my_report` tool (below). No genotype field and no file identifier is
included, and the text names its source, its date and the not-diagnostic
sentence. It works with any assistant on any plan, adds no recipient, token or
consent class, and is no more than the person can already select and copy from
the page. It cannot be revoked or audited, and the output guard does not apply
to what the other assistant says. Size: small.

## Proposed design for (b)

### Shape

One MCP endpoint at `https://inherit.bio/mcp` (streamable HTTP), a protected
resource metadata document, and Inherit's own OAuth authorization server
(authorize, token and revocation endpoints). Inherit issues its own tokens; no
Supabase session, API key or vendor credential ever crosses the boundary. Every
tool is read-only and marked so in its MCP annotations.

### Connecting and revoking

1. The person adds the URL in their assistant app. The app reads the metadata
   and registers, preferably by Client ID Metadata Document.
2. Inherit accepts a client only when its `client_id` host and redirect URI
   match one row of a closed **recipient registry**, one row per assistant app
   Inherit has checked. An unknown client is refused with a sentence naming the
   apps that are supported.
3. The browser opens Inherit's consent page. It requires a signed-in session
   with a sign-in in the last ten minutes. It names the assistant app, the
   scopes, each data class, and the trade-offs, and it carries a single-use,
   signed presentation token, as `src/lib/copilot/own-consent.ts` does today.
4. The person signs `consent.own-connector` and picks scopes. Every scope that
   reads a result starts unticked. Inherit returns a code bound to the PKCE
   challenge, client, redirect URI and resource.
5. To revoke, the person opens Settings → Copilot → Connected assistants, which
   lists each connection with its app, scopes, creation date and last use. Each
   row has one action, "Disconnect". The revocation endpoint is also offered to
   the app, but nothing depends on the app calling it.

### Inherit-side authorization on every call

The token is opaque and carries no authority itself. For each call one
service-only SQL function, in the pattern of `own_copilot_authority_v1`,
resolves the token hash to a grant and checks all of this before any read:

- the grant is current and its absolute deadline has not passed;
- the account is live and not in a deletion notice;
- the subject is the account's own active `self` subject;
- the recipient registry row is active;
- the consent signature is the current artifact version;
- the token's scope covers the tool;
- each report purpose the tool reads (`reports.monogenic`,
  `reports.polygenic`, `ancestry`) has its own current grant, as in Copilot.

If any check fails, the call returns 401 or a fixed "not available" result and
reads nothing. The projection is rebuilt for every call from the current
grants, so a deleted file or a revoked purpose drops out on the next call.

### Tools

| Tool | Scope | Returns |
| --- | --- | --- |
| `list_my_reports` | `reports:list` | Title, category, evidence level, completion date and a covered flag for each completed report. No outcomes. |
| `read_my_report` | `reports:read` | For one report: its captured plain-language summary, the person's result in words, the evidence level, its citations (PMID or DOI only), the completion date, the template hash, and the link to the page on inherit.bio. |
| `read_my_ancestry` | `ancestry:read` | The regional shares, ranges and bands exactly as the ancestry page shows them, lineage results, and the page's own caveats. |
| `explain_term` | `glossary:read` | A definition from Inherit's glossary with its citation. It reads no personal data and needs no disclosure consent. |

### What a tool may and may not return

- **Same projection as Copilot, narrower.** Each tool reuses
  `capturedReportResult` and `capturedAncestryResult`, then removes the
  genotype field, rsID-level variant tables, file ids and internal hashes
  other than the template hash. A report with a reviewed correction returns the
  correction notice, as Copilot does.
- **No raw genotypes by default.** There is no `get_genotype`,
  `search_variants` or raw-file tool. One limit must be said plainly: a
  single-position report's result sentence names allele copies (for example,
  "Two copies of the A allele"), so reading that report discloses that
  genotype in words. The design treats that sentence as the report's result.
- **Nothing about anyone else.** No family, other-adult, Portrait, embryo or
  cohort data; no score values, percentiles or ranks; nothing from the export
  archive; no chat history.
- **Fixed framing.** Every personal result carries the not-diagnostic sentence
  from `docs/protocol/decisions.md` (3 September 2026) and, where it applies,
  the modelled-figure marker. These go to the assistant; whether they reach the
  person is up to the assistant.
- **Size.** Each response is capped at about 16 KB, to be fixed after
  measuring the largest report. Copilot's caps are 2 MB.

### Consent: text and signer

A new artifact, `content/legal/consent.own-connector/v1.md`, is needed, with a
matching presentation contract. The person signs it from their own Inherit
session on the consent page. The owner approves the text; if the owner classes
the connector as restricted, each jurisdiction also needs a signed review
before it can be permitted there. A draft for that review:

> I allow the assistant app named above to read, when it asks, the information
> I choose below about my own results: my list of completed reports; for a
> report it asks about, the report's summary, my result in words, its evidence
> level, citations and date; and, if I have enabled ancestry, my saved
> ancestry and lineage results. My DNA file, individual genotypes outside a
> report, and anything about another person or an embryo are not sent.
> Inherit's checks on Copilot answers do not apply to that assistant's
> answers. What it receives is kept under my own agreement with the company
> that runs it, which can include chat history and memory. If the account
> belongs to an employer or school, they may be able to see it. Withdrawing this
> stops new reads; it does not delete what the assistant already holds. I can
> withdraw it in Inherit's settings at any time.

Statement keys: `recipient-named`, `data-classes-named`, `raw-file-excluded`,
`checks-not-applied`, `vendor-terms-apply`, `copies-not-recalled`, `revocable`.

### Audit

- **Legal ledger.** Connecting, disconnecting and every grant end append one
  pseudonymized event through the existing sole append function:
  `connector.granted`, `connector.revoked`, `connector.ended` (with a closed
  reason). Every tool call that returns personal data appends
  `connector.disclosed`. It holds the tool, the scope, the registry key, the
  report slug, the response size and its SHA-256, and never the content. These
  follow `audit.legal-log-7y` and `audit.pseudonymize-on-deletion`.
- **Person-visible history.** A separate own-account table lists the same calls
  (date, app, tool, report title) on the Connected assistants page, and is
  included in the export. It needs its own retention row. This ADR proposes
  12 months, or the end of the account, whichever comes first.

### Rate limits and size

Per grant, 30 personal-data tool calls an hour and 200 a day. `explain_term`
gets 120 an hour. Each account may hold one grant per registry row. The
authorize, token and revocation endpoints are bucketed per source network under
`securityRateLimitContract` (`security.rate-limit-hmac-24h`). A refused call
returns the MCP error and is recorded as a coded outcome. These numbers are
starting values for the owner to change.

### Tokens

- **Authorization code:** single use, 60 seconds, bound to the PKCE S256
  challenge, client, redirect URI and resource.
- **Access token:** 256 random bits, 15 minutes, audience-bound to
  `https://inherit.bio/mcp`.
- **Refresh token:** rotated on every use; presenting a used refresh token ends
  the whole grant. A grant has an absolute life of 90 days, after which the
  person connects again and signs the current consent version.
- **Storage:** tokens are stored only as keyed HMAC-SHA-256 under a dedicated
  secret held outside the database, in service-only tables with no client
  grants. Token rows are deleted when their grant ends.

### How access ends

| Event | Effect |
| --- | --- |
| Disconnect in Inherit | The grant ends and its tokens are deleted in one transaction. The next call returns 401. |
| Disconnect in the assistant app | Ends the grant if the app calls the revocation endpoint. Otherwise the grant stays listed in Inherit until the person disconnects it or it expires. |
| A report purpose revoked, or a file deleted | The next call no longer sees it. The grant stays. |
| Account deletion requested | `account-deletion.notice-7d` already ends model sessions and blocks model retrieval. Every connector grant ends in that transaction and is not restored if deletion is cancelled. The purge manifest covers grants, tokens and the history table. |
| Jurisdiction declaration changed | Every connector grant ends (`jurisdiction_changed`), whichever class the owner picks. This is stricter than own Copilot under ADR 0032, because the consent was signed for a disclosure to a third party under the earlier declaration. |
| Registry row withdrawn by Inherit | Every grant for that app ends. |
| Absolute deadline, or refresh-token reuse | The grant ends. |

Nothing on this list can recall what the assistant has already received.

## Trade-offs, stated plainly

- **G4.8 cannot be enforced on the assistant's answers.** Inherit controls only
  what its tools return. The assistant's model can state a number no tool gave,
  cite a paper nobody checked, give a diagnosis or advise treatment, and Inherit
  sees none of it. Narrow outputs and fixed sentences reduce the risk and do not
  remove it. The connector must never be presented as Copilot, and G4.8's YES
  must not be read as covering it.
- **Results enter the vendor's chat history and memory** under the person's
  consumer agreement with that company. Inherit's export cannot include those
  chats, and Inherit's deletion cannot reach them. The Warp guide above says
  the same of xAI in its own case.
- **A new recipient class.** Today a cloud recipient is a model endpoint the
  person configures, named by provider, model and address. A connector
  recipient is an assistant app acting for an account Inherit cannot identify,
  under terms Inherit is not party to. This affects the capability register,
  the consent artifacts, and probably the jurisdiction matrix. Whether sending
  one's own results to such an app is adult self-analysis or needs its own
  express consent under genetic-privacy or health-data law in a given place is
  a legal question this ADR does not answer.

## Acceptance rows and registers touched

- **G4.8:** scope unchanged; record that the connector is outside it.
- **A9:** the Copilot consent scenario; the connector needs its own browser
  specification.
- **G5.1, G5.1a, G5.1b, G5.5:** the jurisdiction classification and the grant
  ending on a changed declaration.
- **G5.2:** a new versioned consent artifact and its re-consent contract.
- **G5.3a:** immediate end of access on disconnect.
- **G5.6:** grants, signatures and the history table go into the export.
- **G1.8, G5.7, G5.8:** the legal gate must cover the consent page.
- **G1.12:** new routes in `docs/route-register.json` (`/mcp`, the OAuth
  endpoints, the metadata documents, the settings page).
- **G6.1, G6.2:** the registry names assistant apps in product copy. xAI has no
  entry in `data/allowed-external-names.json`, and none of the four permitted
  categories plainly fits a data recipient.
- **G7.1:** this record. **G7.4:** a new capability register row.
- **Registers:** `docs/retention.md` (token, grant and history rows),
  `data/jurisdictions.json` (only if classed as restricted), and the
  account-deletion manifest.

## Risks and mitigations

| Risk | Mitigation | What remains |
| --- | --- | --- |
| The assistant states a diagnosis, a treatment or an invented figure. | Narrow outputs; the not-diagnostic sentence on every result; the consent and settings page say the checks do not apply. | Not preventable from Inherit's side. |
| Prompt injection from another source makes the assistant read results and pass them on through another tool. | Read-only tools, small responses, rate limits, a visible history of every call, one-action disconnect. | Reduced, not removed. |
| A stolen assistant account or token reads results. | 15-minute access tokens, rotation with reuse detection, a 90-day grant life, last-use shown in settings. | Reads happen until the person notices. |
| A work or school assistant account exposes results to an administrator. | A consent sentence says so. | Inherit cannot tell which kind of account connected. |
| A client impersonates a known app. | The closed registry, checked by `client_id` host and redirect URI. | Depends on each vendor's metadata hosting. |
| A vendor changes its terms or connector behaviour. | The registry row can be withdrawn, which ends every grant for that app. | Needs someone to watch vendor changes. |
| Consent fatigue: people accept every scope. | Every personal-data scope starts unticked and is chosen one by one. | Some will still choose all. |

## Open questions for the owner

1. **Classification.** Is the connector adult self-analysis (it can ship as own
   Copilot does), or a new restricted capability? If restricted, it is
   `unreviewed` everywhere and ships nowhere until a signed review exists for a
   jurisdiction, because `realJurisdictions` is empty today.
2. **Which apps are in the registry first?** All three, or only the apps whose
   connector documentation was read above in full.
3. **Result sentences that name allele copies.** Return them as the report's
   result (as proposed), or offer only the summary and evidence level?
4. **Grant life.** 90 days as proposed, or 30 days, or until revoked.
5. **Sign-out.** Should "sign out of all devices" and a password change also end
   connector grants?
6. **History retention.** 12 months as proposed, or the life of the account.

## Build plan

Sizes are engineering days, before review and legal time.

| Phase | Content | Size |
| --- | --- | --- |
| 0 | Owner answers; consent text drafted and approved; classification recorded; retention and route register rows drafted. | 2–3 days, plus legal time if restricted |
| 1 | Option (d), "copy a safe summary", on report and ancestry pages. | 1–2 days |
| 2 | Authorization server, token store, registry, consent page, Connected assistants page, ledger events, rate limits, and `explain_term` only, which proves the connection with each app without personal data. | 8–10 days |
| 3 | The three personal-data tools behind their scopes; projection filter; database, unit and browser tests; export and deletion integration; register updates. | 8–12 days |
| 4 | A manual check with each registry app, with dated evidence, then the capability register row. | 2–3 days |

## Decision needed

Choose one:

- **A.** Build (d) now, and start phase 0 of (b). Build phases 2–4 only after
  the consent text and the classification are approved. *(Proposed.)*
- **B.** Build (d) only; revisit (b) later.
- **C.** Go straight to (b), phases 0–4, without (d).
- **D.** Neither; keep bring-your-own-key and presets (c) only.

Whichever is chosen, option (a) stays rejected for all three vendors until a
vendor publishes terms that allow it for third-party apps.
