/**
 * What a My Genome page says while a file exists and is still being prepared.
 *
 * Added 2026-09-12 (corrections item 9). Before this, these three pages
 * rendered, during preparation, exactly what they render for an account that
 * has uploaded nothing — so a reader who had just uploaded, and who was being
 * told on `/overview` that their file was in flight, found no sign of it here.
 * Two sibling pages did worse and told them to add a file they had already
 * added; those two sentences live in `./data.ts` beside the ones they replace.
 *
 * Each names what will fill in, because "please wait" without an object is
 * the kind of reassurance the brief rules out. None of them promises a
 * duration: the measured-or-withheld timing sentence belongs to `/overview`,
 * which has the sample to decide, and repeating a guess here would be a made
 * up number.
 *
 * They are not gated on the record being the reader's own. These pages all
 * carry a subject bar counting every file in the record whatever its status,
 * so on a relative's record the existence of a file is already on the page
 * and this sentence discloses nothing further. `/family/portrait/[pairId]`
 * shows no such count, which is why its gap stays open rather than being
 * closed with a fourth sentence.
 */

export const HUB_PREPARING =
  "A file is still being prepared. Reports and ancestry fill in here once it is ready.";

export const REPORTS_PREPARING =
  "A file is still being prepared. These reports say what it covers once it is ready.";

export const ANCESTRY_PREPARING =
  "A file is still being prepared. Regions and parent lines appear here once it is ready.";
