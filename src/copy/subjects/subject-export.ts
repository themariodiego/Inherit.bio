/**
 * The words of the one-record export (api.subject-export) and what its
 * archive says about the audit log it leaves out.
 *
 * Owner decision of 16 October 2026 ("Subject export with joint results:
 * built in two steps", docs/protocol/decisions.md): the one-record export
 * ships first and refuses, with a stated reason, while the record has live
 * joint results. These sentences state that reason and promise nothing about
 * the later step.
 */

export const SUBJECT_EXPORT_HEADING = "Export one record";

export const SUBJECT_EXPORT_BODY =
  "Make one ZIP with a single record: its uploads, the DNA variants we found, its results and its consent records.";

/** Shown in place of the action while the record has live joint results. */
export const SUBJECT_EXPORT_JOINT_RESULTS =
  "This record cannot be exported on its own while it has results made with another person's DNA.";

/** Shown when no export can be prepared, for any other reason. */
export const SUBJECT_EXPORT_UNAVAILABLE = "An export of this record cannot be prepared right now.";

/**
 * The note in the archive's `legal-audit.json` and in the record's
 * `audit-log.json`. Our audit records do not say which record an action was
 * about, so a one-record export cannot pick out its own actions.
 */
export const SUBJECT_EXPORT_AUDIT_NOTE =
  "This export of one record leaves out the audit log. Our audit records do not say which record each action was about, so we cannot pick out the actions on this record. The export of your whole account has the actions you took yourself. This does not mean that nothing happened to this record.";

/** The name of the caller's own self record in the list. */
export const SUBJECT_EXPORT_SELF_LABEL = "Your own record";

/** The name of an adult record with no label of its own. */
export const SUBJECT_EXPORT_ADULT_LABEL = "An adult record";
