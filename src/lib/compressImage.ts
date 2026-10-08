// Shrinks phone-camera photos in the browser before upload (site-health
// batch, 2026-10-07). A typical certificate photo is 3–10 MB; the hosting
// platform rejects any request body over ~4.5 MB, and a big upload over
// mobile data is exactly what made the doctor sign-up page look "frozen".
// After this a photo is usually 300–900 KB and still perfectly readable.

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // keeps the whole form under the 4.5 MB platform limit

export interface PreparedUpload {
  file: File | null;
  error?: string;
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

async function renderJpeg(file: File, maxDim: number, quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = "#ffffff"; // PNGs with transparency
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", quality)
  );
}

export async function prepareUpload(file: File): Promise<PreparedUpload> {
  // PDFs can't be shrunk here — just enforce the limit with a clear message.
  if (file.type === "application/pdf") {
    if (file.size > MAX_UPLOAD_BYTES) {
      return {
        file: null,
        error: `This PDF is ${mb(file.size)}MB, which is too large (limit 4MB). Please upload a smaller PDF, or a photo of the certificate instead.`,
      };
    }
    return { file };
  }

  // Small images go up as they are.
  if (file.size <= 900 * 1024) return { file };

  try {
    let blob = await renderJpeg(file, 2000, 0.82);
    if (blob.size > MAX_UPLOAD_BYTES) blob = await renderJpeg(file, 1600, 0.65);
    if (blob.size > MAX_UPLOAD_BYTES) {
      return { file: null, error: "This photo is too large even after shrinking. Please take a new photo with lower resolution." };
    }
    const baseName = file.name.replace(/\.[^.]+$/, "") || "upload";
    return { file: new File([blob], `${baseName}.jpg`, { type: "image/jpeg" }) };
  } catch {
    // Browser couldn't decode it (rare format) — fall back to the original if it fits.
    if (file.size <= MAX_UPLOAD_BYTES) return { file };
    return {
      file: null,
      error: `This file is ${mb(file.size)}MB and couldn't be shrunk automatically (limit 4MB). Please choose a smaller photo.`,
    };
  }
}

// Much smaller target for ID-style document scans (2026-10-08). A
// certificate only needs to be READABLE by the admin, and doctors on weak
// mobile data could not push even a 1–2 MB photo through. This shrinks
// photos to roughly 150–450 KB (still sharp enough to read printed text)
// and warns about large PDFs, which can't be shrunk in the browser.
const DOC_TARGET_BYTES = 450 * 1024;

export interface PreparedDocument extends PreparedUpload {
  /** A gentle hint, e.g. a big PDF that will be slow on mobile data. */
  warning?: string;
}

export async function prepareDocumentUpload(file: File): Promise<PreparedDocument> {
  if (file.type === "application/pdf") {
    const base = await prepareUpload(file);
    if (base.file && file.size > 1.5 * 1024 * 1024) {
      return {
        file: base.file,
        warning: `This PDF is ${mb(file.size)}MB. On mobile data a photo of the certificate (usually under 0.5MB) uploads much faster.`,
      };
    }
    return base;
  }
  if (file.size <= DOC_TARGET_BYTES) return { file };
  try {
    const tiers: [number, number][] = [
      [1600, 0.7],
      [1400, 0.6],
      [1200, 0.5],
    ];
    let best: Blob | null = null;
    for (const [dim, q] of tiers) {
      const blob = await renderJpeg(file, dim, q);
      best = blob;
      if (blob.size <= DOC_TARGET_BYTES) break;
    }
    if (!best || best.size > MAX_UPLOAD_BYTES) {
      return { file: null, error: "This photo is too large even after shrinking. Please take a new photo with lower resolution." };
    }
    const baseName = file.name.replace(/\.[^.]+$/, "") || "upload";
    return { file: new File([best], `${baseName}.jpg`, { type: "image/jpeg" }) };
  } catch {
    return prepareUpload(file);
  }
}
