// Copies the receipt OCR engine and language models into public/ocr so they
// are served from our own origin. The CSP only allows same-origin scripts and
// connections, and self-hosting keeps receipts from touching any third party.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const modules = path.join(root, "node_modules");
const target = path.join(root, "public", "ocr");
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
console.log(`[Crelith Finance] ${files.length} arquivos de OCR copiados para public/ocr.`);
