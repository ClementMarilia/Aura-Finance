// Must match SHARE_INBOX / SHARE_KEY in public/service-worker.js.
export const SHARE_INBOX = "shared-receipt-inbox";
export const SHARE_KEY = "/shared-receipt/latest";

// Reads (and removes) the file the service worker stored when another app
// shared a receipt with the installed PWA.
export async function takeSharedReceipt(cacheStorage = globalThis.caches) {
  if (!cacheStorage) return null;
  try {
    const cache = await cacheStorage.open(SHARE_INBOX);
    const response = await cache.match(SHARE_KEY);
    if (!response) return null;
    await cache.delete(SHARE_KEY);
    const blob = await response.blob();
    const name = decodeURIComponent(response.headers.get("x-file-name") || "recibo");
    return new File([blob], name, { type: blob.type || response.headers.get("content-type") || "" });
  } catch {
    return null;
  }
}
