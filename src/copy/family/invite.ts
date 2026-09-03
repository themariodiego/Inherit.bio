/**
 * `/family/invite` — Path A, the only path that exists (design §2.6; brief
 * §5 §5.2). Every user-visible string of that page lives here.
 *
 * Path B ("Upload with their written permission") is not built, so its
 * secondary link is not rendered: a link to a screen that does not exist is
 * a dead link. The string is kept here, unused and guarded, so the day Path
 * B ships it is already written.
 */

/** The h1 and the document title; pinned by e2e/adult-subject-invitation.spec.ts. */
export const INVITE_H1 = "Invite another adult";

/**
 * Character-for-character (brief line 334), above the form and outside any
 * disclosure: both paths render it before anything is entered.
 */
export const PRE_CONSENT_STATEMENT =
  "Comparing two people’s DNA can show that they are related, or not related, in ways neither expected. Inherit cannot un-see this.";

/** Character-for-character (brief line 331): the Path A heading. */
export const INVITE_THEM_HEADING = "Invite them.";

export const INVITE_THEM_BODY =
  "They accept in their own account, add their own file, and choose what to share from their side. You never touch their file.";

export const EMAIL_LABEL = "Their email address";

/** The optional note travels in the invitation mail as plain text, never as a link. */
export const NOTE_LABEL = "A note for them";
export const NOTE_HINT = "Optional. They will read this in the invitation.";

export const ATTESTATION_LABEL =
  "I am at least 18. I know this invitation gives me no right to upload, analyse, or read the other person’s genetic data.";

export const SEND_BUTTON = "Send invitation";
export const SENDING_BUTTON = "Requesting…";

export const REQUESTED_HEADING = "Invitation requested";
export const REQUESTED_BODY =
  "If the address can receive an invitation, Inherit will send one. We do not reveal whether an address has refused invitations.";

/**
 * The two failure states. Neither names a jurisdiction: X7.3 keeps registered
 * terms out of short roles, and "yet" is honest here because the missing
 * legal review is within the operator's control.
 */
export const BLOCKED_HERE_STATUS = "Inherit cannot send invitations here yet.";
export const REQUEST_FAILED_STATUS = "The invitation could not be requested.";

/**
 * Path B does not exist: no screen, no route, no consent record. The link
 * renders only when this is true, so nothing dead ships (brief line 332).
 */
export const PATH_B_AVAILABLE = false;
export const PATH_B_LINK = "They can’t use Inherit themselves";
