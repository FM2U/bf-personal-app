import { describe, expect, it } from "vitest";
import { documentPath, documentSizeError, formatBytes, isDocumentPathFor, MAX_DOCUMENT_BYTES, safeFileName } from "./documents";

const OWNER = "00000000-0000-0000-0000-000000000001";
const REC = "11111111-1111-1111-1111-111111111111";

describe("document uploads", () => {
  it("accepts files up to 25 MB and names the size of a larger one", () => {
    expect(documentSizeError(2_000_000)).toBeNull();
    expect(documentSizeError(MAX_DOCUMENT_BYTES)).toBeNull();
    expect(documentSizeError(MAX_DOCUMENT_BYTES + 1)).toMatch(/^This file is 25 MB\. The limit is 25 MB\./);
    expect(documentSizeError(31 * 1024 * 1024)).toMatch(/^This file is 31 MB\./);
    expect(documentSizeError(0)).toMatch(/empty/);
  });

  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 bytes");
    expect(formatBytes(830 * 1024)).toBe("830 KB");
    expect(formatBytes(2.45 * 1024 * 1024)).toBe("2.5 MB");
  });

  it("keeps file names safe for storage paths", () => {
    expect(safeFileName("Signed LOI (final).pdf")).toBe("Signed_LOI_final_.pdf");
    expect(safeFileName("../../etc/passwd")).toBe("_.._etc_passwd");
    expect(safeFileName("")).toBe("file");
  });

  it("stores under the owner's folder and checks paths before saving the record", () => {
    const p = documentPath(OWNER, "commitments", REC, "CIM v2.pdf", 1700000000000);
    expect(p).toBe(`${OWNER}/commitments/${REC}/1700000000000_CIM_v2.pdf`);
    expect(isDocumentPathFor(p, OWNER, "commitments", REC)).toBe(true);
    expect(isDocumentPathFor(p, OWNER, "tasks", REC)).toBe(false);
    expect(isDocumentPathFor(`${OWNER}/commitments/${REC}/../x`, OWNER, "commitments", REC)).toBe(false);
    expect(isDocumentPathFor(`other/commitments/${REC}/1_x.pdf`, OWNER, "commitments", REC)).toBe(false);
  });
});
