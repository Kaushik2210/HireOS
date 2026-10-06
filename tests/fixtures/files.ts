import { Document, Header, Packer, Paragraph, TextRun } from "docx";
import { unzipSync, zipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";

/** Characters outside WinAnsi would make pdf-lib throw; these fixtures only need plain text. */
const winAnsiSafe = (text: string) => text.replace(/[^\x20-\x7e•–—·’]/g, "?");

/** A real, text-selectable PDF. Lines flow down the page and onto new pages as needed. */
export async function makePdf(
  text: string,
  options: { linesPerPage?: number } = {},
): Promise<Uint8Array> {
  const perPage = options.linesPerPage ?? 52;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = text.split("\n");
  for (let start = 0; start < Math.max(lines.length, 1); start += perPage) {
    const page = doc.addPage([700, 800]);
    lines.slice(start, start + perPage).forEach((line, i) => {
      if (line.trim()) page.drawText(winAnsiSafe(line), { x: 40, y: 770 - i * 14, size: 9, font });
    });
  }
  return doc.save();
}

/** A real .docx. Lines starting with "• " become genuine list paragraphs. */
export async function makeDocx(
  text: string,
  options: { header?: string } = {},
): Promise<Uint8Array> {
  const paragraphs = text
    .split("\n")
    .map((line) =>
      line.startsWith("• ")
        ? new Paragraph({ text: line.slice(2), bullet: { level: 0 } })
        : new Paragraph({ children: [new TextRun(line)] }),
    );
  const doc = new Document({
    sections: [
      {
        headers: options.header
          ? { default: new Header({ children: [new Paragraph(options.header)] }) }
          : undefined,
        children: paragraphs,
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

/** Adds extra entries to an existing zip (used to build macro-enabled and bomb-like files). */
export function addZipEntries(zip: Uint8Array, extra: Record<string, Uint8Array>): Uint8Array {
  return zipSync({ ...unzipSync(zip), ...extra });
}

const ascii = (text: string) => new TextEncoder().encode(text);

/** A tiny hand-written PDF whose catalog carries a JavaScript open action. */
export function pdfWithJavaScript(): Uint8Array {
  return ascii(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /JavaScript /JS (app.alert('x')) >> >>\nendobj\n" +
      "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF",
  );
}

/** A tiny hand-written PDF that declares encryption. */
export function pdfEncrypted(): Uint8Array {
  return ascii(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n" +
      "trailer\n<< /Root 1 0 R /Encrypt << /Filter /Standard /V 1 /R 2 >> >>\n%%EOF",
  );
}

/** Highly compressible entries that expand far beyond the allowed size. */
export function zipBomb(): Uint8Array {
  return zipSync({
    "[Content_Types].xml": ascii("<Types/>"),
    "word/document.xml": ascii("<w:document/>"),
    "word/huge.bin": new Uint8Array(13 * 1024 * 1024), // 13 MB of zeros compresses to a few KB
  });
}

export function zipWithManyEntries(count: number): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": ascii("<Types/>"),
    "word/document.xml": ascii("<w:document/>"),
  };
  for (let i = 0; i < count; i++) files[`word/extra${i}.xml`] = ascii("<x/>");
  return zipSync(files);
}

export const fileOf = (bytes: Uint8Array, name: string) => ({ bytes, fileName: name });
