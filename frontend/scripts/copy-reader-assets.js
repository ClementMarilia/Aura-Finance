// Copies the receipt readers into public/ so they are served from our own
// origin: the OCR engine and language models (public/ocr) and pdf.js
// (public/pdfjs). The CSP only allows same-origin scripts and connections, and
// self-hosting keeps receipts from touching any third party.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const modules = path.join(root, "node_modules");
const target = path.join(root, "public", "ocr");
const pdfTarget = path.join(root, "public", "pdfjs");
const pdfjs = path.join(modules, "pdfjs-dist");
const LANGUAGES = ["por", "ita", "spa", "eng"];

const files = [
  [path.join(modules, "tesseract.js", "dist", "worker.min.js"), "worker.min.js"],
  ...["", "simd-", "relaxedsimd-"].map((variant) => [
    path.join(modules, "tesseract.js-core", `tesseract-core-${variant}lstm.wasm.js`),
    `tesseract-core-${variant}lstm.wasm.js`,
  ]),
  ...LANGUAGES.map((lang) => [
    path.join(modules, "@tesseract.js-data", lang, "4.0.0_best_int", `${lang}.traineddata.gz`),
    `${lang}.traineddata.gz`,
  ]),
];

fs.mkdirSync(target, { recursive: true });
for (const [source, name] of files) {
  if (!fs.existsSync(source)) {
    throw new Error(`Arquivo de OCR não encontrado: ${source}. Rode yarn install.`);
  }
  fs.copyFileSync(source, path.join(target, name));
}
fs.rmSync(pdfTarget, { recursive: true, force: true });
fs.mkdirSync(pdfTarget, { recursive: true });
// The legacy build ships polyfills: the modern one relies on brand-new JS
// (e.g. Map.prototype.getOrInsertComputed) that phone browsers lack.
for (const name of ["pdf.min.mjs", "pdf.worker.min.mjs"]) {
  fs.copyFileSync(path.join(pdfjs, "legacy", "build", name), path.join(pdfTarget, name));
}
// Character maps, standard fonts and image decoders are fetched only when a
// PDF needs them (CID fonts, non-embedded fonts, JBIG2/JPEG 2000 scans).
for (const folder of ["cmaps", "standard_fonts", "wasm"]) {
  fs.cpSync(path.join(pdfjs, folder), path.join(pdfTarget, folder), { recursive: true });
}

console.log(`[Crelith Finance] Leitores de recibo copiados: ${files.length} arquivos de OCR em public/ocr e pdf.js em public/pdfjs.`);
