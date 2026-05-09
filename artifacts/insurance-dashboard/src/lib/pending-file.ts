/**
 * In-memory handoff for a File between the chat-first front door (Home) and
 * the existing UploadPage flow. We deliberately avoid sessionStorage because
 * File / Blob objects are not serializable across navigation.
 *
 * The Home page calls setPendingFile() and navigates to /upload. The
 * UploadPage consumes it on mount via consumePendingFile() and runs its
 * normal handleFile() pipeline.
 */
let pending: File | null = null;

export function setPendingFile(file: File): void {
  pending = file;
}

export function consumePendingFile(): File | null {
  const f = pending;
  pending = null;
  return f;
}
