import { unzipSync } from "fflate";

export interface ZipEntryInfo {
  name: string;
  /** Compressed size from the central directory. */
  size: number;
  /** Declared uncompressed size from the central directory. */
  originalSize: number;
}

/**
 * Lists a ZIP's entries from its central directory without inflating anything.
 * Throws if the archive is malformed.
 */
export function listZipEntries(bytes: Uint8Array): ZipEntryInfo[] {
  const entries: ZipEntryInfo[] = [];
  unzipSync(bytes, {
    filter: (file) => {
      entries.push({ name: file.name, size: file.size, originalSize: file.originalSize });
      return false; // never inflate while listing
    },
  });
  return entries;
}

/**
 * Inflates exactly one entry, refusing if its declared size exceeds `maxBytes`.
 * The output buffer is sized from the declared length, so an entry that actually
 * expands beyond it fails instead of consuming memory.
 */
export function readZipEntry(bytes: Uint8Array, name: string, maxBytes: number): Uint8Array | null {
  let tooBig = false;
  const result = unzipSync(bytes, {
    filter: (file) => {
      if (file.name !== name) return false;
      if (file.originalSize > maxBytes) {
        tooBig = true;
        return false;
      }
      return true;
    },
  });
  if (tooBig) throw new Error("zip entry too large");
  return result[name] ?? null;
}
