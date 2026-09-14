# Copy drafted for signature — D-102 and D-103

**Status: SIGNED 2026-09-14, not yet wired.** Owner decision 2026-09-13: "I
draft, you sign." Both are now approved and this file becomes the record of
what was approved and when.

- **D-103's five statements: approved VERBATIM**, including statement 5's
  pointer to the published deadlines rather than the figures. Wiring them into
  the confirm body is queued work, not done here.
  - **BLOCKED 2026-09-14 on one sentence, and the measurement is the reason.**
    Putting the five into `src/copy/family/` subjects them to the readability
    gate, which holds a long block to grade 9. The approved `revocable`
    sentence measures **9.08**. Approved copy is not edited to pass a gate
    without the signature being renewed, so nothing was shipped and the module
    was withdrawn rather than left half-applied. Three choices, and they are
    yours:
    1. **Split the sentence.** "I can take this back at any time. Inherit then
       deletes what was built from my file, on the deadlines it publishes."
       Grade **4.79**, same promise, two words changed.
    2. **One word.** "…on the dates it publishes." Grade **8.54**, but
       "dates" is weaker than "deadlines" and the sentence is about an
       obligation.
    3. **Rule that a consent statement is legal copy**, which the gate already
       allows at grade 11 on a marketing legal path. That is the larger and
       probably the right answer, because it settles D-110 at the same time:
       the six statements already shipping in `co-parent-review-form.tsx` have
       never been measured, and three of them are at 9.13, 11.68 and 11.70 —
       all worse than the sentence being blocked here.

    **D-102 is unaffected and is wired.**
- **D-102: approved, and the owner chose ATTRIBUTION** over the unattributed
  wording recommended below. The recommendation is left standing rather than
  quietly deleted, so the trade-off that was weighed is still on the record;
  the strings below are updated to the decided form.

Each draft names the cause it answers, traced to the code or SQL that produces
it, so the wording can be checked against what actually happens rather than
against a description of it.

---

## D-102 — the locked permission that renders an empty paragraph

`PermissionGrantRow` renders `<p data-slot="permission-locked">{disabledReason}</p>`
whenever the row has no action. Two causes already supply a reason:
`INDEPENDENT_LOGIN_REQUIRED` and `onlyTheyCanTurnThisOn(name)`. A third does
not, and that is the defect: `actionFor()` returns `undefined` when
`prepareSharedReportGrant` / `preparePortraitGrant` / `prepareHealthPictureGrant`
return null, and nothing sets a reason, so the reader meets a blank.

**Traced cause.** `private.family_report_endpoint_v1(..., p_require_adult)`
requires `p.date_of_birth <= today - 18 years`, and
`family_portrait_endpoints_v1` calls it for BOTH sides — the granter and the
recipient. A profile with no recorded date of birth, on either side, fails it.
That is the case `e2e/portrait-no-file.spec.ts` hit: with only the granter's
account completed, the granter's "Turn on" control was simply absent.

### Draft

```ts
/** The other person is not an adult on record (family_report_endpoint_v1,
 *  p_require_adult). ATTRIBUTED, by owner decision 2026-09-14 — see the note
 *  below for the disclosure this accepts. */
export function adultDateRequiredFrom(name: string): string {
  return `This row needs a date of birth from ${name}. Inherit shares between adults only.`;
}

/** The viewer's own profile is the one missing it: actionable, and it
 *  discloses nothing about anyone else. */
export const YOUR_ADULT_DATE_REQUIRED =
  "This row needs your date of birth. Inherit shares between adults only.";

/** Every other cause: a principal, artifact or profile the page could not
 *  read. A fault, and it says so rather than looking like a rule. */
export const GRANT_UNAVAILABLE =
  "This row cannot be turned on right now. Nothing has changed; please try again.";
```

### The judgement call I did not make for you

Whether the first string should name the other person.

"This row needs a date of birth from **Bo**" is more actionable. It also tells
the reader that Bo either has not recorded one **or is under 18**, and a
product that shares genomes should not leak that someone might be a minor.

The unattributed wording still lets a reader who has recorded their own date
work out that it is the other person — that much is unavoidable if the row is
to be actionable at all — but it never says which of the two reasons applies.
The precedent cuts both ways and is worth knowing: `PORTRAIT_STEPS` already
names per-person missing steps ("Bo has not: opened their own Inherit
account"), so attribution is established on this surface; none of those steps
is an age.

**Recommended: leave it unattributed.** — **Owner decided 2026-09-14:
attribute it.** The recommendation stays above so the trade-off is legible
later; what was accepted is that a reader learns the named person either has
not recorded a date of birth or is under 18. `adultDateRequiredFrom(name)` is
the decided form. The `birthDateState` the database already computes has three
values — `missing`, `adult`, `underage` — and the sentence must NOT distinguish
the last two, or it stops being an inference a reader could draw and becomes
Inherit telling them.

---

## D-103 — the five adult-subject statements

The transaction records five keys — `age-18-plus`, `mailbox-control`,
`no-inviter-access`, `identity-not-verified`, `revocable` — and the register
asks for a body whose statements are individually tickable. The keys exist and
signatures already reference them; the sentences do not exist anywhere a page
could render them, which is why the confirm body cannot be built.

These are what a person is told they agreed to. Approve them verbatim, rewrite
them, or tell me to try again.

### Draft

| key | statement |
| --- | --- |
| `age-18-plus` | I am 18 or older. |
| `mailbox-control` | This email address is mine, and I am the only person who reads it. |
| `no-inviter-access` | The person who invited me cannot make this decision for me, and cannot see what I choose until I choose it. |
| `identity-not-verified` | Inherit has not checked who I am. It knows only that I can read this mailbox. |
| `revocable` | I can take this back at any time, and Inherit deletes what was built from my file on the deadlines it publishes. |

### Two things to decide with them

**The `revocable` deadline.** The draft says "on the deadlines it publishes"
rather than naming a number. The registered deadlines are 60 seconds for
derived data and seven days for sources, and a person ticking a box is owed
something more concrete than a pointer. I did not write the numbers in because
I have not proven that this path meets them end to end — the number belongs in
the sentence only once it is true here, not merely registered. Say the word and
I will either prove it and put the numbers in, or leave the pointer.

**`no-inviter-access` is two promises, and I checked the second rather than
asking about it.** It claims the inviter cannot see the decision *before* it is
made. That is true today, and true for a reason worth writing down: **there is
no inviter-facing surface at all.** `/settings/people` renders `FeatureNotBuilt`,
and nothing else in `src/app` reads a pending invitation's state — the
surfaces that read invitations are the subject's own rights pages.

So the statement can ship as two promises. But it is true by ABSENCE, not by
enforcement, and `/settings/people` is designed to "list the people you share
with". **The day that page is built, this sentence becomes a constraint on its
design**: it may show that an invitation is outstanding, and it may not show
what the person has chosen until they have chosen it. Recorded here so that
constraint arrives with the page rather than being discovered after it.
