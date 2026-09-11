# The human comprehension protocol

**Status: packaged and runnable. Not run. No result in this repository is a
human result, and none may be invented.**

Brief G3.4 separates two things that are easy to confuse. *Code completion* is
satisfied by this protocol being committed and runnable alongside a green G3.3.
*Launch* additionally requires the human round to have been run, which is a
thing only the operator can do. `docs/release-checklist.md` records that as
launch-blocking. Where a round has been run, its per-task results belong in
`docs/comprehension-results-<date>.md`, one file per round, and nowhere else.

**As of 2026-09-11, G3.3 is not green** — `scripts/comprehension/` carries the
protocol's shared instruments (the rubric, the prohibited-answer patterns, the
task bindings and their test) but not the 30-persona harness, and
`docs/comprehension-runs/` does not exist. So this document completes G3.4's own
half and G3.4 remains NO on the other half. That is the honest state and it is
recorded in `docs/acceptance-matrix.md` rather than smoothed over here.

## What a facilitator needs

| File | What it is |
|---|---|
| This file | Recruitment, environment, session script, consent, thresholds |
| `scripts/comprehension/bindings.json` | Each task's account, fixture, surface and success condition |
| `scripts/comprehension/rubric.md` | The grading instrument, shared with the simulated round |
| `scripts/comprehension/prohibited-patterns.json` | The reproducible half of prohibited-answer detection |
| `scripts/comprehension/bindings.test.ts` | Resolves every binding against the repository; run it before the round |

Run `npx vitest run scripts/comprehension/` before a round. It re-measures the
coverage claims the tasks depend on and fails if a fixture, template, route,
copy constant or region label has moved since. A protocol whose bindings have
rotted grades navigation, not comprehension.

## Recruitment

**Twelve participants.** Each must meet all three:

1. **No genetics or medical training.** No degree, qualification or professional
   role in genetics, genomics, medicine, nursing, pharmacy, or genetic
   counselling. Secondary-school biology is expected and fine.
2. **No prior consumer-genomics purchase.** They have never bought or used
   23andMe, AncestryDNA, MyHeritage DNA, FamilyTreeDNA, Nebula, Dante, or any
   comparable service, and have never received a raw genetic data file.
3. **No connection to this project.** Not an employee, contractor, investor,
   friend or family member of anyone who worked on Inherit. A participant who
   wants the product to do well is not a naive participant.

**Screen by asking, and record the answers.** Do not infer eligibility from a
job title. Someone may have bought a kit for a relative; that counts.

**Recruit for range, not for representativeness.** Twelve people cannot be
representative of anything and claiming otherwise would be one of the invented
numbers this project forbids. What twelve can do is span: age, first language,
confidence with computers, and whether they have ever had a reason to think
about a health risk. Aim to vary all four and record what you got.

**Exclusions after the fact.** A participant who turns out to be ineligible is
removed and replaced, and the round is re-run to twelve. Their session is
discarded, not graded. Record that this happened.

## The environment

The round runs against a build under the `TEST-LOCAL` jurisdiction. Brief line
2548 settles why: every restricted capability is `unreviewed` in every real
jurisdiction, so a round run against a production configuration would show
`jurisdiction-unavailable` for T6, T7 and T10's embryo half and would grade the
gate rather than the product.

`INHERIT_TEST_JURISDICTION=1` selects it. A production build refuses to start
with it set, and `TEST-LOCAL` never appears in a jurisdiction picker. Both are
asserted by test. **Never run a participant session against production.**

Four participant contexts are defined in `bindings.json`:

- **participant-a** — the account holder, with two files loaded:
  `data/samples/synthetic_23andme.txt` and `e2e/fixtures/aims-mixed-grch38.vcf`.
  Two files because no single committed fixture both answers a report task and
  supports an ancestry estimate: the array sample covers 151 of 162 report
  templates but only 5 of 168 ancestry-informative markers, which the product
  correctly reports as low confidence; the AIMs fixture covers all 168 and no
  report position.
- **participant-b** — the friend in T4. Holds no file.
- **participant-c** — the intending parent in T6, T7 and T10, with
  `e2e/fixtures/tiny-grch38.vcf` and `e2e/fixtures/tiny-b-grch38.vcf` loaded.
- **no-account** — T9 and T10 start signed out at the marketing home page.
  Creating an account is not a permitted step in either.

Every fixture is synthetic and belongs to no person. **A real genetic file must
never be used in this protocol**, including a facilitator's own.

Each participant gets a freshly seeded context. A second participant must not
inherit the first one's deletions, consents or Copilot history.

## The ten tasks

The prompts are in `bindings.json` and are read to the participant **verbatim**.
They are the brief's own wording and must not be softened, expanded, or
explained. Two of them — T6's presupposed recommendation and T9's premise — are
deliberately loaded, and rewording them destroys what they measure.

Their bindings, in brief:

| | Task | Context | Bound surface |
|---|---|---|---|
| T1 | Type 2 diabetes finding | participant-a | any of three covered T2D report pages |
| T2 | Name one ancestry region | participant-a | the ancestry surface's own region labels |
| T3 | Something not checked | participant-a | any of the eleven not-covered medicines pages |
| T4 | A friend's file and permission | participant-a | upload, invitation, people |
| T5 | Can it say you will get a disease | participant-a | any result page, limits, Copilot |
| T6 | Which embryo does it recommend | participant-c | embryo comparison |
| T7 | How much difference, in plain numbers | participant-c | embryo comparison |
| T8 | Delete everything | participant-a | data and deletion |
| T9 | Someone uploaded your DNA | no account | home → subject access → withdrawal, ≤ 8 actions |
| T10 | You were the embryo | no account | home → future person → claim |

**T3's binding is measured, not chosen.** Eleven of the 162 committed report
templates are not covered by participant-a's files, and they are exactly the
eleven medicines templates. Neither of participant-a's two files covers any of
them. `bindings.test.ts` re-measures this and fails if the set changes size or
membership.

**T7 carries a constraint worth reading before the round.** Measured
2026-09-11: the My Genome report detail page renders exactly one figure kind —
`genotype` — and no percentage at all. The only surface in the product that
renders a personal absolute figure is the embryo comparison cell. So T7 is bound
there, and **outside an environment where `embryo_analysis` is permitted, T7 has
no bound surface at all.** Under `TEST-LOCAL` it runs. In production today it
cannot, because no real jurisdiction has a signed review. This is recorded
rather than worked around: binding T7 to a surface that shows no number would
make every answer prohibited by construction, which would measure nothing.

**Withheld variants.** Where a capability a task depends on is withheld, the
task is replaced by its variant. Only T6 has one, and it is in `bindings.json`
and the rubric with the same prohibited-answer set. Record in the results file
which variant was used.

## Consent

Obtain written consent before the session. The form below is the minimum; add
whatever your jurisdiction requires, never less.

> ### Taking part in an Inherit comprehension session
>
> **What this is.** We are testing whether a website is understandable. We are
> not testing you, and there is no way for you to do badly.
>
> **What you will do.** You will be given ten short tasks on a test version of a
> website, one at a time, and asked to say in your own words what you found.
> This takes about 45 minutes.
>
> **Whose DNA.** None. Every file in the test is computer-generated and belongs
> to no person. You will not be asked for any genetic sample, any genetic file,
> or any information about your own or your family's health. **Nothing about
> your body or your family is collected, at any point.**
>
> **What we record.** Your typed or spoken answers to the ten tasks, which pages
> you visited, and how many actions each task took. If the session is recorded,
> the recording covers the screen and your voice. We do not record your face.
>
> **What we do with it.** Your answers are graded by someone who is given only
> the answer and a grading guide — not your name and not anything about you.
> Answers are published in aggregate and may be quoted; quotations carry no name
> and we remove anything that could identify you before publishing.
>
> **How long we keep it.** Answers and any recording are deleted within 90 days
> of the round finishing. The screening answers you gave to check eligibility are
> deleted as soon as the round is complete.
>
> **Stopping.** You can stop at any moment, skip any task, or ask us to delete
> your session afterwards, without giving a reason and without any consequence.
> To have your session deleted after the fact, contact the facilitator named
> below at any time in the 90 days.
>
> **Payment.** If you were offered payment for taking part, you receive it in
> full whether or not you finish, and whether or not you stop early.
>
> **Who is doing this.** [facilitator name and contact]
>
> I have read the above and agree to take part.
>
> Name ............................  Signed ............................
> Date ............................

## The session script

**Unmoderated.** The facilitator sets the participant up, reads the opening,
and then does not speak except as scripted below. This is the hard part and it
is the whole method: a facilitator who helps has measured their own helpfulness.

### Opening, read once, verbatim

> Thank you for doing this. I'm going to give you ten short tasks on a website,
> one at a time. I want to be clear that we're testing the website, not you.
> There is no right way to do these, and if something is confusing that is
> useful for us to see — it means we built it wrong.
>
> Please do each task however you would if you were at home on your own. When
> you're done with a task, or if you decide you can't do it, tell me and I'll
> write down what you say. Say it in your own words — don't read from the screen.
>
> I won't be able to help you during the tasks, and I'm not being unfriendly when
> I don't answer. I just can't, or the test doesn't work. You can stop any time.
>
> Any questions before we start?

Answer questions about the *procedure*. Answer no question about the website.

### Per task

1. Read the task prompt verbatim from `bindings.json`. Do not paraphrase.
2. Say nothing while they work. Do not react to a wrong turn, a sigh, or a
   correct answer. Do not say "mm-hm".
3. When they stop, ask exactly: **"What did you find?"** Record the answer
   verbatim — their words, their grammar, their hedges. Do not tidy it.
4. If they ask for help, say exactly once: **"I can't help with that one — do
   whatever you'd do on your own."** If they ask again, repeat it verbatim.
5. If they give up, record `completed: no` and their verbatim explanation. A
   give-up is a fail, and it is data. Move on without consoling them.
6. Record the path taken and the action count. For T9 the action count is part
   of the threshold: one click, one form submission or one typed URL is one
   action.

**Never**: explain a page, define a word, point at anything, re-read a prompt
with different emphasis, confirm an answer, or say "nearly". If a participant
looks to you for a reaction, look at your notes.

**Order.** Run T1–T10 in order. T5, T6 and T7 come after the participant has
seen results, which is the only order in which the probes mean anything.

**Stop the session** if the participant becomes distressed, if they disclose
something about their own health and want to talk about it, or if they ask to
stop. Their consent stands above the round.

### Closing

> That's all ten. Before you go: nothing you saw was anyone's real DNA, and
> nothing about you was collected. If anything in there worried you, it was
> made up by a computer.
>
> Is there anything that stood out, or anything you'd change?

Record the closing comment. It is not graded and it is often the most useful
thing in the session.

## Thresholds

- **≥ 10 of 12 unassisted successes per task** for T1, T2, T3, T4, T8, T9.
- **Zero prohibited answers** on T5, T6 and T7. Not a rate — zero.
- **T9** additionally: within 8 actions, without creating an account.
- **T10**: zero answers may report finding no route.

"Unassisted" means the facilitator gave nothing beyond the scripted refusal. A
session in which the facilitator helped is discarded and re-run with a new
participant, not graded generously.

**The adjustment rule.** Where a round returns below 10/12 on a task, the
simulated threshold for that task rises to **29/30** and the simulated round is
re-run. The humans calibrate the simulation; a disagreement is resolved in the
humans' favour, every time.

## Recording results

Per-task results go in `docs/comprehension-results-<date>.md` — one file per
round, named for the date the round finished. It records, per task: successes
out of twelve, prohibited answers if the task has a class, action counts where
they are part of the threshold, which variant was used, and every verbatim
answer. Discarded sessions are listed with the reason.

It also records what the recruitment actually produced, against what was aimed
for, because a round that ended up with twelve people of similar background is a
round whose numbers mean less than they look like they mean, and the only way
anyone can know that is if it is written down.

**Nothing writes such a file except a facilitator who ran a round.** No part of
this repository generates one, and no reviewer, agent or tool may author one.
