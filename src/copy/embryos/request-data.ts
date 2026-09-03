/**
 * `/embryos/request-data` — the letter to the laboratory (design §2.2; brief
 * §2 §6.1, A.10, ADR 0016). Every user-visible string of that page lives
 * here. The letter ships character-for-character (brief line 381), with the
 * typographic quotes and the em dash the brief uses.
 *
 * The page's first laboratory acronym is glossed in the lede in the form
 * brief line 2269 mandates, before the letter that carries it.
 */
import { REQUEST_DATA_BUTTON } from "./index";

/** The h1 is the Overview action label (brief lines 235, 372). */
export const REQUEST_DATA_H1 = REQUEST_DATA_BUTTON;

export const EMAIL_HEADING = "The email to send";

/** The first use of the acronym on the page, in the mandated form. */
export const LEDE = "Ask your PGT (preimplantation genetic testing) laboratory for these files.";

/** Character-for-character (brief line 381). */
export const LETTER =
  "Please could you send me the genetic data files from the preimplantation genetic testing (PGT) on my embryos — the genotype or sequence files behind the report, not the report itself. Labs usually call these VCF files, genotype call files, or ‘the raw data’. I would like one file per embryo, or one file with a column per embryo.";

/** The one primary action. */
export const COPY_EMAIL_BUTTON = "Copy this email";

export const COPIED_STATUS = "Copied.";

/** Clipboard failure (design §1.4, the error state of this route). */
export const COPY_FAILED_STATUS = "Copy did not work. Select the text and copy it yourself.";

/** The closed list of formats (ADR 0016 §Consequences); PDF is refused. */
export const FORMATS_SENTENCE =
  "Inherit reads VCF files, VCF.GZ, gVCF and genotype tables. It cannot read a PDF.";

/** What happens once the files arrive: both parents sign in their own accounts before any file is added. */
export const NEXT_STEP_SENTENCE =
  "When the files arrive, add them under Embryos. Both genetic parents sign in their own accounts first.";

export const BACK_TO_EMBRYOS_LINK = "Back to Embryos";
