# Proposed legal copy — awaiting operator and counsel

**Status: PROPOSED. Nothing here has been applied to any legal page.**

`scripts/legal-fee-exceptions.json` records its own reason for not editing this
in passing, and it is the right one: *"a limitation-of-liability clause is not
copy an engineer should edit on their own reading of an acceptance row."* This
file therefore drafts and does not apply.

---

## 1. The damages cap in `8. Limitation of liability`

**File:** `src/app/(marketing)/terms/page.tsx`, section `8. Limitation of liability`.

**Current text:**

> Our total aggregate liability for all claims relating to the service is
> capped. The cap is the greater of one hundred US dollars (US$100) or the
> amount you paid us for the service in the twelve months before the claim
> arose.

**Proposed text:**

> Our total aggregate liability for all claims relating to the service is
> capped at one hundred US dollars (US$100).

### Why

**The second branch describes a relationship the product promises will never
exist.** G5.7 is "No fee path exists and the legal gate proves it", and
`/terms` itself says Inherit sells nothing. A clause measuring liability
against "the amount you paid us for the service" reads as boilerplate carried
from a paid-service template, and on a page whose whole job is to be believed,
a sentence that contradicts the product's central promise costs more than it
protects.

**Dropping it changes the cap's effect by nothing.** The clause is "the greater
of US$100 or the amount you paid us". The amount paid is always zero, so the
greater of the two is always US$100. The second branch is dead text today and
would only ever become live if Inherit started charging — which is the thing it
promises not to do. This is a clarity change, not a liability change, and that
is the strongest argument for it being safe to make.

**The figure is untouched, deliberately.** Brief §12 item 7 says the liability
cap figure "must be a real number before any build ships, and no dimension can
invent one. Until counsel supplies it the specification cannot state it." US$100
is already in the page; this proposal does not change it, does not endorse it,
and does not treat its presence as counsel having supplied it. If the number is
itself a placeholder, that is a separate and larger question than this wording.

### What this does not resolve

G5.7's copy half objects to a price appearing on a legal page at all. The
proposed text still names US$100, because a liability cap without a figure is
not a cap. If the intent of that half is that no legal page may show a currency
amount under any circumstances, then the cap has to be expressed some other way
or the rule needs an explicit carve-out — and either is counsel's call, not an
editorial one.

### If accepted

1. Apply the wording to `src/app/(marketing)/terms/page.tsx`.
2. Update the entry in `scripts/legal-fee-exceptions.json`: its `match` is
   `US$100`, which still matches, so the exception stays — but its
   `openQuestion` is answered and should say so, and its `why` should quote the
   new sentence rather than the old one. The gate compares that file against the
   pages in both directions, so a stale quotation there fails it.
3. `pnpm gate:legal` must pass before and after; it reads `surfaces`, `label`
   and `match` only, so the prose fields can be corrected freely.
