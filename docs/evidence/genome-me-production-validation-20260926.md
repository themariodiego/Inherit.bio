# `/genome/me` validated on production — 26 September 2026

The owner asked for `/genome/me` to be finished and validated end to end on
production, including `/genome/me/reports`, `/genome/me/ancestry` and
`/copilot/me`. This records that run on `https://inherit.bio`, what it found,
the fixes, and the same steps run again after the fixes were deployed.

The owner's choices for the run are in `docs/protocol/decisions.md`
(26 September):

- One account, signed up through the real sign-up page with a Gmail `+` alias
  of the owner's address. Its id is `9416a320-4716-4c90-a1e6-b5f9ad587c9e`.
- Synthetic DNA files only. Nothing here is anyone's genome.
- The live Copilot conversation is skipped, so `/copilot/me` is validated up to
  the provider step. That is a gap, named below.
- Afterwards, the account goes through the normal seven-day deletion.

Everything was driven through a real Chromium browser against production, the
way a person would use it. Files were chosen with the page's own "Choose file"
button. Database reads were read-only, and only checked results and residue.

## What works on production

| Step | Result |
| --- | --- |
| Sign-up | The confirmation email arrived within seconds (09:19:53 UTC), from Supabase's built-in sender. |
| First sign-in | The country declaration (GB) came first, then Overview. |
| Upload, 12 files in 10 formats | Each finished and prepared in 2–6 seconds: 23andMe (plain, `.gz` and `.zip`), AncestryDNA, MyHeritage, FamilyTreeDNA, VCF, gVCF with `<NON_REF>`, gVCF with `<*>`, a gzipped ancestry-marker VCF and a Medicines VCF. |
| `/genome/me/reports` | The three permissions were chosen, reports generated and the "reports are ready" email arrived (first at 09:39:39 UTC). Of the statistical estimates, 149 of 151 were covered, and 11 of 11 Medicines reports. Report pages show the genotype, evidence level, sources and provenance. |
| `/genome/me/ancestry` | A low-coverage file got the honest low-coverage message. The ancestry-marker file got a full map, the mother's and father's lines, the Neanderthal section and the sources. |
| Data page and genome browser | Searching rs4988235 returned G/G. |
| Original download | Byte-identical to the upload (SHA-256 `77717cca…`). |
| File deletion | A confirmation dialog, then 204. A read-only check at 09:45:28 UTC found nothing left: 0 rows across 16 tables, no `genome_files` row and no storage objects. |
| Turning Ancestry off, and back on | Ancestry results were purged, then made again. |
| `/copilot/me` | Reached the provider step, where a person saves their own model and key. |

## What was found, and fixed

| # | Found | Fix | Checked again on production |
| --- | --- | --- | --- |
| F1 | A sign-up link opened late, or on another device, landed on a bare sign-in page. The address was in fact confirmed. | #220 | This morning's confirmation link, already used, was opened again in a fresh browser.<br>• Before, at 11:50 UTC: `/auth/sign-in?error=verification_failed`, with no message, and Supabase's `#error=…&error_description=…` in the address bar.<br>• After, at 12:37 UTC: `/auth/sign-in?error=link_expired`, with no fragment, and the alert "That link has expired or was already used. Sign in, or create your account again if you never finished."<br>The case of a link opened in another browser is proven by `e2e/auth.spec.ts` in CI. It was not repeated on production, because that needs a second new account. |
| F3 | The original download saved as `Genome file`, with no extension, so nothing opened it. | #223 | Saved as `Genome file.txt`. The export stores `originals/<file>.txt`. |
| F4 | `/settings/data` promised legal audit records and permission records the export did not hold, and the export left out the birth date and country. | #223 | The page lists only what the ZIP holds and says legal audit records are not in it yet. The export now includes the profile's birth date and country (GB), 6 consent signatures and 4 permission grants, the same counts a read-only query gives. No signing name is included. Attestations: 0, and the table is empty across production. |
| F5 | The export said Copilot conversations "are not stored server-side", and would have exported chats the chat history hides. | #223 | `chats.json` says "Your chat history has no saved Copilot conversations." Chats now follow their own grants, as the owner decided. |
| F6 | Four hosts served the app separately, and mail linked to `www`, so a signed-in person was asked to sign in again. | #222; `NEXT_PUBLIC_SITE_URL` set to `https://inherit.bio` | `www.inherit.bio`, `sequence.plus.bio` and `sequence-murex.vercel.app` answer every page with 308 to the same path and query on `https://inherit.bio`. `/api/cron/` and `/api/jobs/` answer on every host, and the mail and retention jobs ran 200 on the new deployment (11:39–11:40 UTC). The report-ready email sent at 11:49:39 UTC links to `https://inherit.bio/genome/me/reports`. This morning's emails linked to `www`. |
| F7 | With Ancestry off, the ancestry page said "Nothing to show until a file has been processed", under a caption naming five regions. | #224 | Checked 11:48–11:49 UTC:<br>• Ancestry off: "Ancestry is off…" in all three panels, each with an "Open Reports" link to `/genome/me/reports`.<br>• Turned back on without generating: "Ancestry is on… after you generate…" in all three.<br>• After generating, the result is back.<br>In no state does the page say "Nothing to show until a file has been processed", or mention five regions. |
| F8 | The deletion-scheduled email printed its date as a raw timestamp: "on 2026-10-03T11:51:13.946371+00:00". | #225 | Merged at 12:44 UTC. The email now reads "3 October 2026 at 11:51 UTC", and the new test passes in UTC, UTC+14 and Los Angeles time. It was not re-sent on production: that would mean cancelling this account's deletion and restarting its notice period. |

Also added from this run:

- #221: Claude, ChatGPT and Grok presets on `/settings/copilot`. They are live, with the guidance that a chat subscription is separate from an API key.
- #219: ADR 0033. The owner chose to keep bring-your-own-key, and not to build a subscription connector.

## Gaps this run does not close

- The live Copilot conversation was skipped by owner decision, so no answer
  from a model was checked on production.
- Legal audit records are not in the export. Selecting one account's events
  needs the requester resolver in `docs/export-member-selection-design.md`.
- The chat export can carry fewer chats than the job reader, never more. A chat
  whose own grant is current while the account's Copilot authority cannot be
  resolved is left out (#223).
- Family and embryo flows are out of scope. `realJurisdictions` is empty, so
  both are closed on production.

## Account deletion

The account's deletion was scheduled through `/settings/data`, after a fresh
sign-in. Deletion needs a session less than 15 minutes old, and an older one
correctly got 403 `recent_reauthentication_required`.

- Requested at 11:51:13 UTC. The notice period ends on 3 October 2026 at 11:51 UTC.
- The page shows "Account deletion scheduled", with a cancel button.
- During the notice period, `/genome/me`, `/genome/me/reports`, `/copilot/me`
  and `/overview` all send the person to `/settings/data`, and the files API
  answers 423.
- The notice email arrived at 11:51:39 UTC. Its links point to `inherit.bio`. Its
  date was a raw timestamp, which is finding F8.

Physical deletion runs after the notice period ends. It is not recorded here.
