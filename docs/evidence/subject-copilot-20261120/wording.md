# Copilot for one other adult's record: new wording, for the owner's approval

**APPROVED by the owner on 22 November 2026** (`docs/protocol/decisions.md`, "The wording of Copilot for another adult's record is approved"). The strings below are the approved text; the notes about it are kept as they were written.

Owner decision of 19 November 2026, "G8.5: Copilot for another adult's record opens": "The permission wording comes to the owner for approval before it ships." **None of the strings below is approved.** Every one lives in the copy registry and passes `pnpm gate:readability`: the page's and the links' in `src/copy/copilot/subject-scope.ts`, the Path B choice's beside its sibling choices in `src/copy/upload/other-adult.ts` (`PATH_B_CHOICES_COPY`). `{name}` is the person's name as the asker already sees it (on the Family pages: the counterpart's own label, or "Invited adult"; on Files: the label the uploader gave the Path B record).

## The permission itself

### Grantee (a person on the asker's Family pages): no new string

The existing "Copilot" row of the person-to-person permissions page is reused unchanged (`src/copy/family/permissions.ts`, `PERMISSION_ROWS`, id `copilot.local`), signed through `POST /api/consents` → `grant_directional_purpose_v1` as before:

- label: `Copilot`
- consequence: `They can ask Copilot about the reports you share, on a model that runs on their own computer.`

What changes is what it does: until now the row took effect only in the Family group view, and only with Health picture on as well. From this change it also lets that one person's Copilot read the reports you share with them, with any one report row on and no Health picture. The sentence above already says exactly that, so no wording changes; **the owner should confirm that the existing sentence covers the new use** (people who turned it on before this change agreed to the same sentence).

### Uploader (Path B): three new strings, on the person's own choices (Files page)

| Export | Where it appears | Text |
|---|---|---|
| `PATH_B_CHOICES_COPY.copilotLabel` | the row heading under "What can be made from your file", and in the row's button (`Turn on: Copilot, for the person who added your file` / `Turn off: …`, assembled from existing words) | `Copilot` |
| `PATH_B_CHOICES_COPY.copilotConsequence` | the sentence under that heading | `They can ask Copilot about the reports you share with them, on a model that runs on their own computer.` |
| `PATH_B_CHOICES_COPY.affirmCopilot` | the checkbox the person ticks before turning it on (beside the share text's "Permission details · version N", unchanged) | `I let the person who added my file ask Copilot about the reports I share with them.` |

The approved text the person signs is the existing `consent.share-with-adult` (the same artifact every share with the uploader signs, with its four statements), exactly as for the three result layers. If the owner wants a Copilot-specific consent artifact instead, that is a new legal artifact and a new migration.

## The page `/copilot/s-{record}`

| Export | Where it appears | Text |
|---|---|---|
| `subjectScopeHeading(name)` | the page h1 in every state but the unavailable page; it is the thread header (brief §8.6) | `Ask about {name}` |
| `subjectCopilotLede(name)` | the ready page's first paragraph | `Copilot answers only about {name}, from the reports they let it read. It reads only the report types they chose for you, never their whole file.` |
| `SUBJECT_LAYERS_HEADING` | the box heading on the ready page | `What Copilot can read` |
| `subjectLayersLine(name, layers)` | the one line in that box (built by the Family scope's `familyMemberLine`) | `{name}: {layer labels, comma-separated}` (e.g. `Invited adult: Statistical estimates`) |
| `subjectPermissionMissingNote(name)` | the permission-missing state, as a status | `{name} has not let Copilot read what they share with you.` |
| `subjectHowToTurnOn(name)` | the line under it | `Only {name} can turn this on. They need Copilot and at least one report type on for you.` |
| `subjectHeldText(name)` | the held state (the mitigation decision denies; nothing about why is said) | `Copilot cannot read {name}’s reports right now.` |
| `subjectThreadHint(name)` | the empty thread's hint in the composer area | `Ask about the reports {name} shared with you. Each answer names whose results it used.` |
| `subjectPlaceholderLabel(name)` | the composer's placeholder | `Ask about {name}…` |

Reused unchanged on this page: the unavailable page (`Copilot for other people is not open here` and its reason, requirement and `Back to Overview`), `Copilot` (the eyebrow), `Set Copilot to a model on this computer and allow it in Copilot settings. Then come back here.` (provider required), `Review Copilot settings`, `For anyone’s genome but your own, Copilot only runs on a model you host yourself. Nothing leaves Inherit.`, the jurisdiction refusal (`jurisdiction-v1` copy), the Family Tier-2 gate, the panel's own strings, and the answer's source labels `Shared by {name}` and `{title} (shared by {name})`.

## The entry links

| Export | Where it appears | Text |
|---|---|---|
| `askCopilotAboutButton(name)` | `/family/[person]`, above the local-only caption, only when the scope would open; and on Files, beside an uploader's "Read shared reports" for a Path B person, only when the scope would open | `Ask Copilot about {name}` |

## Model-facing text

No new system-prompt text. The scope sends the Family group scope's prompt unchanged (`FAMILY_SYSTEM_PROMPT` with `familySystemMessage`), which names the one person: `People whose shared reports you may read now: {name} (person-1). Tools read only what each person currently shares.` The two tool descriptions are new model-facing strings in `src/lib/copilot/subject-chat-route.ts` (not shown to a person): `List the saved reports {name} shared with you for Copilot. Never generates results.` and `Read one saved report {name} shared with you. The source names its person.`

## Not changed, and a question

`ADULT_UPLOAD_DERIVED_LIST` (the upload-time notice and the review page tell the Path B person "What can be made from this file" and "Nothing else is made from this file.") is unchanged: Copilot makes nothing new from the file, it reads saved reports already shared. **Owner question:** should that notice also say that the person may let the uploader's own Copilot read the reports they share? Changing it changes a notice already sent in test mode, so it is not changed here.
