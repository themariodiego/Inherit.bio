# UI renewal — scope and review evidence

This change refreshes Inherit's existing interface. It retains the paper, ink,
forest and tint palette, Fraunces display type, Inter body type, and the calm
editorial feel. It changes presentation and interaction feedback; scientific
calculations, account permissions, consent wording, APIs and database schema
are unchanged.

## Product understanding before visual generation

The repository and research were read before image generation:

| Source | Consequence for the interface |
| --- | --- |
| [Architecture](../../architecture.md) and [capability register](../../capability-register.md), checked against current routes and upload code | Bring supported array text or VCF/gVCF files. BAM/CRAM/FASTQ are currently refused. Historical prose does not override working code. |
| [Medicines research](../pharmacogenomics-research-2026-09-03.md) and [ADR 0021](../../adr/0021-pharmacogenomics-per-position-reports.md) | Show only supported per-position findings; no invented medication phenotype or dosing recommendation. |
| [ADR 0022](../../adr/0022-accurate-estimate-layer-copy.md) | Keep specific-variant and statistical-estimate layers distinct. Do not turn evidence limitations into confident predictions. |
| [Ancestry surface](../w7-ancestry-surface.md) and [part B](../w7-ancestry-surface-part-b-brief.md) | Describe only regions supported by the file. Missing coverage remains a visible state. |
| [Family](../w9-family-surfaces.md) and [embryo surfaces](../w10-embryo-surfaces.md) | Permission, jurisdiction, waiting, and missing-file screens are part of the product. A visual refresh does not grant access or rank embryos. |
| [Density contract](../../adr/0029-density-contract.md) and [comprehension protocol](../../comprehension-protocol.md) | Keep plain-language headings, clear next actions, source context, readable controls and mobile reflow. Simulated reviews do not replace human comprehension research. |

The value proposition is free, open-source exploration of a person's existing
genetic file, with explicit evidence, coverage and uncertainty, plus control over
sharing and deletion. Sequencing is purchased independently from providers.

## Visual direction and motion

After repository research, built-in image generation produced a six-panel board
covering the landing page, Overview, Reports, tablet ancestry, phone sign-in and
privacy. The direction was an editorial field guide using the current colour
and type system, quiet lines, readable cards and precise controls. The board was
a [layout reference](images/design-board.png). Invented carrier categories and a GitHub sign-in option in
the generated image were excluded from implementation.

The requested [React Bits Micro collection](https://reactbits.dev/c/micro) and
its [Glide Select demo](https://reactbits.dev/c/micro/glide-select) were inspected
in a browser. Adaptations use existing React and CSS, with no animation library:

- Navigation emphasis glides to the hovered or focused row using measured row
  geometry, including after text enlargement.
- Buttons provide a short press response. Linked cards change their outline
  and move a decorative arrow by 3px.
- Native disclosures reveal their content; theme icons rotate into place;
  switches retain their normal state transition.
- Feedback lasts 160–220ms and never delays navigation or form submission.
  Reduced motion removes animation and transition duration. Keyboard focus and
  the active navigation marker remain visible without motion.

Landing, public information, legal reading, authentication, app navigation,
Overview, genome/report tools, files, Family, Embryos and Settings share the
revised hierarchy and controls. Provider product summaries expose compatibility
and price before the purchase link on phones and tablets; desktop keeps its
comparison table. Long legal pages have a compact mobile contents disclosure
and a sticky desktop contents list. Search announces its pending state.

## Adversarial review loop

Independent agents used generated personas and actual local browser sessions.
These are simulated usability judgments, not human participant results.
The pass rule was at least 4/5 in every dimension, a mean of at least 4.3/5,
and no unresolved blocker or major issue.

| Review | Final result | Evidence |
| --- | --- | --- |
| Public visitor, cautious prospective uploader, mobile buyer | 4.46/5 | [Public review and retests](review-public-round1.md): 37 public route samples × 3 widths; phone axe checks on all 37. |
| New signed-in user, tablet reader, keyboard user | 4.48/5 | [Round 1](review-app-round1.md), [round 2](review-app-round2.md): 21 routes × 4 widths plus 12 retest captures; 21 phone axe checks. |
| Populated report/ancestry and valid embryo states | 4.44/5 | [Dynamic review and correction](review-app-dynamic.md): 36 valid captures plus two tablet/desktop retests; 12 phone axe checks. |
| Adversarial implementation/accessibility review | 4.5 robustness, 4.5 accessibility, 4.5 motion, 5 scope | [Round 1](review-code-round1.md), [round 2](review-code-round2.md). |

The iterations corrected hidden mobile provider pricing, an outdated upload
format claim, tablet account-header crowding, narrow three-column tablet hubs,
missing search feedback, navigation drift at enlarged text, unreachable links
in a short sidebar, dark switch contrast, and narrow report-choice consent cards on tablet. All were retested in a browser.

The [page inventory](page-inventory.md) covers all 71 page entrypoints at desktop,
tablet and phone sizes, including redirect destinations and dynamic templates.
The initial sweep recorded 213 captures with no horizontal page overflow.
One redirect capture lost its synthetic login when another reviewer reused its
cookie; redirect routes were rerun with an independent session.

Valid synthetic family person, permissions, Portrait waiting and family health
picture states were additionally opened at all three widths: 36 captures,
all HTTP 200, no page overflow. The populated-state extension added a generated
caffeine A/C report, an ancestry map/table, data provenance and the genome
browser, plus valid embryo consent-required, processing and awaiting-file
comparison states. No real genetic data was used. Full embryo analyses were
not enabled for review; existing paired-grant restrictions remained intact.

The valid withdrawal invitation form was also reviewed at all three sizes with
zero overflow or axe violations. Its local rendering fixture used a dedicated
synthetic rights session because the shared local database predates the adult
activation migration. No real invitation was sent and no invitation decision was
submitted; activation end-to-end is not claimed by this rendering review.

## Validation

- Clean checkout, Node 22: **319 unit test files, 5,296 tests passed**.
- Type generation, TypeScript and ESLint passed.
- Production Next.js build passed.
- Legal, first-glance, environment, template, readability, route, claims and
  jurisdiction gates passed. Existing gate coverage limits remain unchanged.
- Repository/history secret gate passed.
- Browser discovery found 499 tests in 76 files, including the new provider
  decision-order and enlarged-text/short-viewport navigation regressions.
- Final standard production-browser and CI results are recorded on the PR.

## Representative captures

[Desktop landing](images/home-desktop.png), [phone landing](images/home-phone.png),
[populated synthetic ancestry on phone](images/ancestry-phone.png).

 Raw local browser captures and measurements remain under
`work/ui-renewal/`; authentication state files are intentionally excluded from
the commit.
