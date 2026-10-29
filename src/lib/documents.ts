/**
 * Document uploads (Documents card on every record page and in the task window). The browser sends the file
 * straight to Supabase Storage with a signed upload address made by the server (startDocumentUpload in
 * src/app/actions/records.ts), then the server saves the document record (saveDocumentRecord). The file never passes
 * through a server action or a Vercel function, so their request size limits (1 MB and about 4.5 MB) do not apply.
 * Pure functions, tested in src/lib/documents.test.ts.
 */

/** The largest file the Documents card accepts. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const MAX_DOCUMENT_LABEL = "25 MB";

export const DOCUMENT_KINDS = ["signed_agreement", "statement", "proof", "cim", "nda", "loi", "report", "other"] as const;

/** "2.4 MB", "830 KB". */
export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} bytes`;
}

/** The message shown under the file box when the file cannot be uploaded because of its size, or null. */
export function documentSizeError(size: number): string | null {
  if (!size) return "This file is empty. Choose another file.";
  if (size > MAX_DOCUMENT_BYTES) return `This file is ${formatBytes(size)}. The limit is ${MAX_DOCUMENT_LABEL}. Make it smaller (for example, save the PDF at a lower quality) or upload it in parts.`;
  return null;
}

/** The file name as stored: letters, numbers, dot, dash, and underscore; at most 120 characters. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "");
  return (cleaned || "file").slice(-120);
}

/** Where a document is stored: the owner's folder first (the storage rules check it), then the record. */
export function documentPath(ownerId: string, recordType: string, recordId: string, fileName: string, now: number): string {
  return `${ownerId}/${recordType}/${recordId}/${now}_${safeFileName(fileName)}`;
}

/** True when `path` is a document path for this owner and record (made by documentPath). */
export function isDocumentPathFor(path: string, ownerId: string, recordType: string, recordId: string): boolean {
  const prefix = `${ownerId}/${recordType}/${recordId}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return /^\d+_[a-zA-Z0-9._-]+$/.test(rest) && !rest.includes("..");
}
