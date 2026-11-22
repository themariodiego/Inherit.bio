/**
 * The sentence for api.file-delete's answer. Its sign-in and not-found
 * refusals are the register's generic bodies (`unauthenticated`, `not_found`)
 * and read as the route's own did. Its cross-origin refusal is
 * `request_forbidden`, like the CSRF wrapper's, and reads as an unfinished
 * deletion (owner decision of 19 November 2026); no answer carries
 * `file_delete_unauthorized` any more.
 */
export function fileDeletionError(code: unknown): string {
  if (code === "file_delete_processing") return "This file is still processing. It was not deleted.";
  if (code === "unauthenticated") return "Please sign in again and try Delete.";
  if (code === "file_delete_subject_unavailable") return "This file cannot be deleted here. It was not deleted.";
  if (code === "not_found") return "This file is not available. Please check your files again.";
  return "Deletion did not finish. Please try Delete again. The file will stay listed until deletion is complete.";
}
