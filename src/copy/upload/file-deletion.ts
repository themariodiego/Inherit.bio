/**
 * The sentence for api.file-delete's answer. Its sign-in and not-found
 * refusals are the register's generic bodies (`unauthenticated`, `not_found`)
 * and read as the route's own did; its cross-origin refusal keeps
 * `file_delete_unauthorized`.
 */
export function fileDeletionError(code: unknown): string {
  if (code === "file_delete_processing") return "This file is still processing. It was not deleted.";
  if (code === "unauthenticated" || code === "file_delete_unauthorized") return "Please sign in again and try Delete.";
  if (code === "file_delete_subject_unavailable") return "This file cannot be deleted here. It was not deleted.";
  if (code === "not_found") return "This file is not available. Please check your files again.";
  return "Deletion did not finish. Please try Delete again. The file will stay listed until deletion is complete.";
}
