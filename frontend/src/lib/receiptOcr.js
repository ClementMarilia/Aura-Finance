// Browser-only OCR for receipt photos. The engine and language models are
// served from /ocr (see scripts/copy-ocr-assets.js); nothing leaves the device.
import { ocrLanguage, parseReceiptText } from "@/lib/receiptParser";

const MAX_SIDE = 2000;
const MIN_WIDTH = 1000;

// Rotate by EXIF, scale to a size Tesseract reads well, convert to grayscale
// and stretch contrast: faded thermal paper is the usual failure mode.
async function prepareImage(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(MAX_SIDE / Math.max(bitmap.width, bitmap.height), Math.max(1, MIN_WIDTH / bitmap.width));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const image = context.getImageData(0, 0, width, height);
  const pixels = image.data;
  const histogram = new Uint32Array(256);
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
    pixels[i] = gray;
    histogram[gray] += 1;
  }
  // Ignore the darkest/lightest 1% so a shadow or glare doesn't flatten the stretch.
  const cutoff = (pixels.length / 4) * 0.01;
  let low = 0;
  let high = 255;
  for (let sum = 0; low < 255 && sum + histogram[low] < cutoff; low += 1) sum += histogram[low];
  for (let sum = 0; high > 0 && sum + histogram[high] < cutoff; high -= 1) sum += histogram[high];
  const range = Math.max(1, high - low);
  for (let i = 0; i < pixels.length; i += 4) {
    const value = Math.max(0, Math.min(255, ((pixels[i] - low) * 255) / range));
    pixels[i] = value;
    pixels[i + 1] = value;
    pixels[i + 2] = value;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

export async function readReceipt(file, { language = "pt", onProgress } = {}) {
  const [{ createWorker, OEM, PSM }, canvas] = await Promise.all([
    import(/* webpackChunkName: "ocr" */ "tesseract.js"),
    prepareImage(file),
  ]);
  const worker = await createWorker(ocrLanguage(language), OEM.LSTM_ONLY, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr",
    langPath: "/ocr",
    gzip: true,
    workerBlobURL: false,
    logger: (message) => {
      if (onProgress && typeof message.progress === "number") onProgress(message.status, message.progress);
    },
  });
  try {
    // SINGLE_BLOCK keeps "VALOR A PAGAR R$ ....... 57,00" on one line; the
    // column modes drop the right-aligned amounts of fiscal receipts.
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      preserve_interword_spaces: "1",
    });
    const { data } = await worker.recognize(canvas);
    return { ...parseReceiptText(data.text), text: data.text };
  } finally {
    await worker.terminate();
  }
}
