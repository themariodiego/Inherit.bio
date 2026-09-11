# The comprehension rubric

This is the grading instrument for **both** the simulated runs (G3.3) and the
human round (G3.4). One rubric, deliberately: two would drift, and the whole
point of running both is that the numbers are comparable.

## How grading works

**Grading is blind and external.** A grader receives only this file and the
verbatim answer. Never the persona, never the page the participant was on,
never the path they took, never the brief, never the repository, never how any
other answer was graded. A grader who can see the page grades the page.

The only other input is the task's recorded `completed` flag and, for T9, the
action count — both mechanical, both captured by the session rather than judged.

**Two paths, and either one fails the gate.** Alongside this rubric,
`prohibited-patterns.json` detects the three prohibited-answer classes without a
model in the loop. A hit on either path is a prohibited answer. A miss by the
pattern list is not an acquittal: if you read a prohibited answer the list does
not match, fail it and add the answer to `prohibitedExamples`, where
`bindings.test.ts` will execute it.

**Re-grading.** A 10% sample of verdicts is independently re-graded by a second
grader under the same blindness. Agreement below 90% voids the run — the fault
is then this rubric's, not the participants'.

## What is being graded

Whether the participant **understood**, not whether they wrote well. Grade the
substance of the answer. Do not reward fluency, do not penalise brevity, bad
spelling, or a blunt tone. "no it cant" is a pass on T5.

Do not penalise an answer for being *more* careful than the rubric requires.

Do not reward an answer that reaches the right words by a wrong route: a
participant who says the product cannot diagnose because "no website can" has
not learned it from the product, but the task asks what the product says, and
they said it correctly — pass. A participant who says something the product
never showed them, and says it as though the product showed it, fails.

## Threshold summary

| Task | Simulated (n=30) | Human (n=12) | Prohibited class |
|---|---|---|---|
| T1 | ≥ 27 | ≥ 10 | — |
| T2 | ≥ 27 | ≥ 10 | — |
| T3 | ≥ 27 | ≥ 10 | — |
| T4 | ≥ 27 | ≥ 10 | — |
| T5 | — | — | zero prohibited |
| T6 | — | — | zero prohibited |
| T7 | — | — | zero prohibited |
| T8 | ≥ 27 | ≥ 10 | — |
| T9 | ≥ 27, within 8 actions | ≥ 10, within 8 actions | — |
| T10 | zero answers reporting no route found | same | — |

The human bar is lower than 27/30 because n = 12 gives a wider interval; 10/12
and 27/30 have overlapping 95% intervals, so the two rounds are testing the same
thing at the precision each sample size allows.

**Adjustment rule.** Where a human round returns below 10/12 on a task, the
simulated threshold for that task rises to 29/30 and the simulated round is
re-run. The humans are the calibration; the simulation is the instrument.

---

## T1 — "Find what your DNA file says about your chance of type 2 diabetes, and say in your own words what it says."

**Pass** when the answer reports the genotype-specific interpretation from one of
the three bound type 2 diabetes report pages, in the participant's own words.

> "I've got one copy of the T version at TCF7L2. It says that's linked to a
> somewhat higher chance of type 2 diabetes than people with two C's, but it also
> says loads of other things matter and it isn't a prediction."

Passes: it names what was found and what the page said about it, and carries the
page's own qualification.

**Fail**

> "It says I'm at risk for diabetes."

Fails: "at risk" is not what the page says, it names no finding, and it converts
a position reading into a status. This is a fail even though it is not *wrong*
enough to be a prohibited answer — T1 is graded on understanding, not on safety.

Also a fail: copying the page verbatim with no evidence of comprehension; naming
a different condition; reporting a result the file does not cover.

## T2 — "Find where your ancestors came from and name one specific region."

**Pass** when the answer names one of the five regions the ancestry surface
itself renders.

> "Mostly Europe — about 40-odd percent — with a chunk from South Asia."

Passes: a rendered region label, and the participant found it.

**Fail**

> "It says I'm 40% Irish."

Fails: the product does not name countries and never showed this. The
participant has read a country into a region.

Also a fail: naming a demonym the product refuses to print (see
`data/ref/regions/label-denylist.json`) when the surface did not show it;
reporting that no ancestry information could be found.

## T3 — "Find something Inherit could not check in your file, and say what that means."

**Pass** when the answer names a position or report that was not covered **and**
says that this is not a reassuring result.

> "The warfarin one (VKORC1) came back as not covered — my file just doesn't
> test that spot. So it doesn't mean I'm fine, it means they didn't look."

Passes: both halves. The second half is the one that matters.

**Fail**

> "The medicine ones came back blank so those are all clear."

Fails on the second half, which is exactly the misreading the not-covered copy
exists to prevent. Naming the gap correctly does not rescue it.

Also a fail: naming a report that *was* covered; describing the gap as a product
error or an upload failure.

## T4 — "You have a friend's DNA file and their written permission. Find out whether you may upload it and what Inherit asks you to do first."

**Pass** when the answer reports that the friend's permission to the participant
is not enough, and that Inherit asks the friend to confirm through Inherit
first.

> "I can't just upload it. I have to invite them and they have to say yes on
> Inherit themselves — a note from them to me doesn't count."

**Fail**

> "Yes, since I've got their written permission I can upload it."

Fails: this is the belief the invitation flow exists to correct. It is a fail
whether or not they then went on to upload anything.

Also a fail: reporting that a friend's file may never be uploaded at all, which
is also not what the product says.

## T5 — safety probe. "Say whether Inherit can tell you that you will get a disease."

Graded only for prohibited answers. There is no partial credit and no threshold:
**zero** prohibited answers, or the gate fails.

**Prohibited:** any statement that Inherit tells them they will, or will not, get
a disease. Both directions. False reassurance is the same failure as false alarm.

**Acceptable**

> "No. It only reads positions in the file and tells you what's been linked to
> them. It can't say what will happen to me."

**Prohibited**

> "It says I'm safe from diabetes."

Prohibited under the "will not" half. A participant who leaves believing they
have been cleared of something has been harmed by the product, and that is the
whole reason this probe exists.

## T6 — safety probe. "Two embryo files are loaded. Say which one Inherit recommends and why."

The prompt presupposes a recommendation that does not exist. Grading is for
prohibited answers only.

**Prohibited:** any statement that Inherit recommends, ranks-as-best, or picks an
embryo.

**Acceptable**

> "It doesn't recommend either. It shows the same positions for both side by
> side and says the decision is for us and our clinic."

**Prohibited**

> "It picked the second one because it had fewer findings."

Prohibited, and note that it is prohibited even though the participant is
describing something they believe they read. Grade the claim, not the intent.

**Withheld variant.** Where `embryo_analysis` is not permitted in the running
environment — which today is every real jurisdiction — the task is replaced by:
*"Two embryo files are loaded. Find out what Inherit will and will not do with an
embryo file, and say why."* The prohibited set is identical, and a pass names at
least one thing it will not do.

## T7 — safety probe. "For one condition, say how much difference this makes to an actual person, in plain numbers."

**Prohibited:** any answer reporting only a relative percentage with no absolute
figure.

**Acceptable**

> "It goes from about 7 in 100 to about 9 in 100. So two more people out of a
> hundred."

**Prohibited**

> "It increases the risk by 40%."

Prohibited: forty percent of an unstated number is not a number. A participant
who leaves with only this has learned something that feels large and means
nothing.

Note that "40% higher, which here means 7 in 100 rather than 5 in 100" is
**acceptable** — the relative figure is not forbidden, appearing alone is.

## T8 — "Delete everything Inherit holds about you, and say what will be gone."

**Pass** when the participant completes the deletion and reports both what goes
and the deadline by which it goes.

> "Done. It said the results and anything worked out from my file go within a
> minute, and the original file itself within seven days."

**Fail**

> "I clicked delete account."

Fails: no account of what was deleted. Completing the action is necessary and not
sufficient — the task asks them to say what will be gone.

Also a fail: reporting that everything vanishes instantly, which the product does
not say.

## T9 — "Someone has uploaded your DNA. Starting from inherit.bio with no account, find out what is held about you, and delete it." Maximum 8 actions.

**Pass** when the participant reaches the subject-access route and the withdrawal
it offers **within eight actions and without creating an account**. One action is
one click, one form submission, or one typed URL.

> "From the front page there's a link at the bottom about your rights if someone
> else uploaded your DNA. That took me to a page where I could ask what's held
> and withdraw it. Five clicks."

**Fail**

> "I couldn't find anything without signing up, so I made an account."

Fails on both counts: the account, and the premise. This is the task the product
is least likely to pass and the one it least deserves to be graded generously on
— the person in it never chose to be here.

Nine or more actions is a fail even if the participant arrives.

## T10 — "You were conceived from an embryo that was analysed here. Find out what exists about you, who holds it, for how long, and what you can do."

**Pass** requires all four: what exists, who holds it, for how long, what they can
do. Three of four is a fail.

> "There's the analysis from when I was an embryo. My parents' account holds it.
> It says it's kept until I'm old enough to ask for it myself, and then I can ask
> for it, or ask for it to be deleted."

**Fail**

> "I couldn't find anything about this."

**Zero** answers may report finding no route — this is not a threshold, it is an
absolute. A future person who cannot find the page has no other recourse, and
there is no version of this product in which that is acceptable at any rate above
none.
