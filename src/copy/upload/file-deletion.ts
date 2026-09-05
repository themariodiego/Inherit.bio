export function fileDeletionError(code: unknown): string {
  if (code === "file_delete_processing") return "This file is still processing. It was not deleted.";
  if (code === "file_delete_unauthorized") return "Please sign in again and try Delete.";
  if (code === "file_delete_subject_unavailable") return "This file cannot be deleted here. It was not deleted.";
  if (code === "file_delete_not_found") return "This file is not available. Please check your files again.";
  return "Deletion did not finish. Please try Delete again. The file will stay listed until deletion is complete.";
}
