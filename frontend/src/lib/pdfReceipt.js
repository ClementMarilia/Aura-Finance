// Reads receipts that arrive as PDF (e-mailed invoices, NFC-e/DANFE, order
// confirmations). Text PDFs are read directly with pdf.js; scanned PDFs have
// no text layer, so their first page is rendered and handed to the OCR.
import { parseReceiptText } from "@/lib/receiptParser";

const MAX_PAGES = 3;
const MIN_TEXT_CHARS = 20;

// pdf.js returns loose text runs with coordinates. Rebuild visual lines: runs
// whose baselines are close belong to the same line, read left to right, and
// a wide horizontal gap becomes several spaces (like "TOTAL ...... 60,38").
export function itemsToLines(items) {
  const runs = items
    .filter((item) => item && typeof item.str === "string" && item.str.trim())
    .map((item) => ({
      text: item.str,
      x: item.transform[4],
      y: item.transform[5],
      width: item.width || 0,
      height: Math.abs(item.height || item.transform[3] || 10),
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const lines = [];
  for (const run of runs) {
    const line = lines.find((candidate) => Math.abs(candidate.y - run.y) <= Math.max(2, run.height * 0.4));
    if (line) line.runs.push(run);
    else lines.push({ y: run.y, runs: [run] });
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map(({ runs: lineRuns }) => {
      lineRuns.sort((a, b) => a.x - b.x);
      let text = "";
      let end = null;
      for (const run of lineRuns) {
        if (end !== null) {
          const charWidth = run.width / Math.max(1, run.text.length) || run.height * 0.5;
          const gap = run.x - end;
          if (gap > charWidth * 2) text += "   ";
          else if (gap > charWidth * 0.2 && !text.endsWith(" ") && !run.text.startsWith(" ")) text += " ";
        }
        text += run.text;
        end = run.x + run.width;
      }
      return text.replace(/\s+$/, "");
    })
    .filter(Boolean);
}

export function hasUsefulText(lines) {
  return lines.join("").replace(/[^\p{L}\d]/gu, "").length >= MIN_TEXT_CHARS;
}

async function loadPdfJs() {
  // Served from /pdfjs (scripts/copy-reader-assets.js), outside the bundle.
  const pdfjs = await import(/* webpackIgnore: true */ "/pdfjs/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  return pdfjs;
}

async function renderFirstPage(page) {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(3, 1800 / base.width) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, canvas, viewport }).promise;
  return canvas;
}

export async function readPdfReceipt(file, { language = "pt", onProgress } = {}) {
  const pdfjs = await loadPdfJs();
  const document_ = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
    isEvalSupported: false,
    enableXfa: false,
  }).promise;
  try {
    const lines = [];
    for (let number = 1; number <= Math.min(MAX_PAGES, document_.numPages); number += 1) {
      const page = await document_.getPage(number);
      const content = await page.getTextContent();
      lines.push(...itemsToLines(content.items));
    }
    if (hasUsefulText(lines)) {
      const text = lines.join("\n");
      return { ...parseReceiptText(text), text, source: "pdf-text" };
    }
    // Scanned PDF: no text layer, read the first page like a photo.
    const canvas = await renderFirstPage(await document_.getPage(1));
    const { readReceipt } = await import(/* webpackChunkName: "ocr" */ "@/lib/receiptOcr");
    return { ...(await readReceipt(canvas, { language, onProgress })), source: "pdf-ocr" };
  } finally {
    await document_.destroy();
  }
}
