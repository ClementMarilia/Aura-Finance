// Browser-only OCR for receipt photos. The engine and language models are
// served from /ocr (see scripts/copy-reader-assets.js); nothing leaves the device.
import { ocrLanguage, parseReceiptText } from "@/lib/receiptParser";

const MAX_SIDE = 2500;
const MIN_WIDTH = 1200;
// Adaptive threshold: neighbourhood of 5% of the width, pixel must be 12
// levels darker than it. Tuned on real photos of thermal receipts on a table.
const WINDOW_RATIO = 0.05;
const THRESHOLD_C = 12;

// Each pixel is compared with the mean of its neighbourhood (integral image),
// so a receipt lit unevenly or faded at the top still separates ink from
// paper. A single global threshold erased the whole header of real photos.
export function adaptiveThreshold(gray, width, height, windowRatio = WINDOW_RATIO, c = THRESHOLD_C) {
  const stride = width + 1;
  const integral = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      row += gray[y * width + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row;
    }
  }
  const half = Math.max(8, Math.round((width * windowRatio) / 2));
  const out = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(height, y + half + 1);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(width, x + half + 1);
      const sum = integral[y1 * stride + x1] - integral[y0 * stride + x1]
        - integral[y1 * stride + x0] + integral[y0 * stride + x0];
      out[y * width + x] = gray[y * width + x] < sum / ((y1 - y0) * (x1 - x0)) - c ? 0 : 255;
    }
  }
  return out;
}

// Rotate by EXIF, scale to a size Tesseract reads well, convert to grayscale
// and stretch contrast: faded thermal paper is the usual failure mode.
// `source` is an image File or a canvas (a scanned PDF page).
async function prepareImage(source) {
  const bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
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
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < gray.length; i += 1) {
    gray[i] = ((pixels[i * 4] - low) * 255) / range;
  }
  const binary = adaptiveThreshold(gray, width, height);
  for (let i = 0; i < binary.length; i += 1) {
    pixels[i * 4] = binary[i];
    pixels[i * 4 + 1] = binary[i];
    pixels[i * 4 + 2] = binary[i];
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

export async function readReceipt(source, { language = "pt", onProgress } = {}) {
  const [{ createWorker, OEM, PSM }, canvas] = await Promise.all([
    import(/* webpackChunkName: "ocr" */ "tesseract.js"),
    prepareImage(source),
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
