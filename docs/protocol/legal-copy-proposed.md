# Proposed legal copy — awaiting operator and counsel

**Status: PROPOSED. Nothing here has been applied to any legal page.**

`scripts/legal-fee-exceptions.json` records its own reason for not editing this
in passing, and it is the right one: *"a limitation-of-liability clause is not
copy an engineer should edit on their own reading of an acceptance row."* This
file therefore drafts and does not apply.

---

## 1. The damages cap in `8. Limitation of liability`

**File:** `src/app/(marketing)/terms/page.tsx`, section `8. Limitation of liability`.

**Status: REDRAFTED 2026-09-12 on the operator's decision, and still not
applied.** The operator was given four ways to take this and chose the
strictest: express the cap with **no currency amount at all**. The option they
chose said in terms that a cap without a figure needs rewriting on a different
principle and that this is counsel's call, so what follows is a draft for
counsel. `src/app/(marketing)/terms/page.tsx` is untouched.

The earlier draft — keep US$100, drop the "amount you paid us" branch — is
recorded at the bottom as the superseded proposal, because the reasoning that
produced it is still the reasoning that shows the payment branch is dead text.

**Current text:**

> Our total aggregate liability for all claims relating to the service is
> capped. The cap is the greater of one hundred US dollars (US$100) or the
> amount you paid us for the service in the twelve months before the claim
> arose.

**Proposed text:**

> We exclude our liability for all claims relating to the service to the
> fullest extent the law allows. Where the law does not allow it to be
> excluded, it is not limited by this section to any particular amount.

### Why the operator's reading is coherent, stated before the objection

G5.7 has two halves. The fee-path half — "no fee path exists and the legal gate
proves it" — is satisfied and unaffected either way; a damages cap charges
nobody. The copy half objects to **a price appearing on a legal page**, and
`US$100` is a price on a legal page. Read strictly, no wording that names a
figure can satisfy it. The operator read it strictly. That is a defensible
reading of their own specification and it is not this dimension's to overrule.

It also removes a smaller problem the earlier draft could not: brief §12 item 7
reserves the cap figure for counsel — "must be a real number before any build
ships, and no dimension can invent one" — and `US$100` is in the page today
with no record of counsel having supplied it. A clause with no figure cannot be
carrying an unattributed one.

### What this changes that the earlier draft did not, and it is not nothing

**The earlier draft was a clarity change. This one is a liability change**, and
the difference should not be blurred by the fact that both start from the same
observation.

Dropping the payment branch changed the cap's effect by literally nothing: the
clause read "the greater of US$100 or the amount you paid us", the amount paid
is always zero, so the greater is always US$100. Removing a figure entirely is
different in kind. A cap says "our exposure stops here". Text with no figure
says "we exclude what we can, and where we cannot, nothing here limits it" —
which is an exclusion plus a saving clause, not a cap. Whether that leaves
Inherit better or worse off than a US$100 cap depends on the jurisdiction and
on what the law refuses to let anyone exclude, and that is exactly the question
a lawyer answers and this dimension cannot.

**So this is drafted, not applied, and the reason is not caution for its own
sake.** Editing a limitation-of-liability clause on an engineer's reading of an
acceptance row is what `scripts/legal-fee-exceptions.json` already says not to
do, and the change now proposed is larger than the one that rule was written
about.

### What counsel is actually being asked

1. Is an exclusion-plus-saving-clause acceptable in place of a monetary cap for
   a free, open-source service that sells nothing? If not, G5.7's copy half
   needs an explicit carve-out for a liability figure, because the two cannot
   both hold.
2. If a figure must stay, was `US$100` ever supplied by counsel? Brief §12 item
   7 says it has to be. Nothing in this repository records who chose it.
3. The proposed wording is a starting point from a non-lawyer and should be
   treated as one. It is here so the review has something concrete to react to,
   not because it is right.

### If accepted

1. Apply the wording to `src/app/(marketing)/terms/page.tsx`.
2. `scripts/legal-fee-exceptions.json` loses its only entry: with no `US$100`
   on the page, its `match` no longer matches, and `scripts/legal-placeholder-gate.ts`
   compares that file against the pages **in both directions**, so a stale
   entry fails the gate exactly as a new match would. Remove the entry in the
   same commit as the copy.
3. `pnpm gate:legal` must pass before and after.
4. Record the outcome in `docs/protocol/decisions.md`, including who supplied
   the wording, so the next reader can tell a counsel decision from an
   engineering one.

---

## 1a. Superseded: keep US$100, drop the payment branch

**Superseded 2026-09-12 by the operator's decision above. Kept because its
central observation still holds and is the reason the current text cannot
simply stay as it is.**

Proposed text was:

> Our total aggregate liability for all claims relating to the service is
> capped at one hundred US dollars (US$100).

**The second branch describes a relationship the product promises will never
exist.** G5.7 is "No fee path exists and the legal gate proves it", and
`/terms` itself says Inherit sells nothing. A clause measuring liability
against "the amount you paid us for the service" reads as boilerplate carried
from a paid-service template, and on a page whose whole job is to be believed,
a sentence that contradicts the product's central promise costs more than it
protects.

**Dropping it would have changed the cap's effect by nothing.** The amount paid
is always zero, so the greater of the two is always US$100. The branch is dead
text today and would only become live if Inherit started charging — the thing
it promises not to do.

Whichever wording counsel lands on, the payment branch should not survive it.

