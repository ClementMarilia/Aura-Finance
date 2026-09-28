import { SHARE_INBOX, SHARE_KEY, takeSharedReceipt } from "@/lib/sharedReceipt";

function fakeCaches(entries = {}) {
  const store = new Map(Object.entries(entries));
  const opened = [];
  return {
    opened,
    store,
    open: async (name) => {
      opened.push(name);
      return {
        match: async (key) => store.get(key) || undefined,
        delete: async (key) => store.delete(key),
      };
    },
  };
}

function fakeResponse(text, type, name) {
  const headers = new Map([["content-type", type], ["x-file-name", name]]);
  return {
    headers: { get: (key) => headers.get(key) ?? null },
    blob: async () => new Blob([text], { type }),
  };
}

test("returns the shared file once and removes it from the inbox", async () => {
  const caches = fakeCaches({ [SHARE_KEY]: fakeResponse("jpeg-bytes", "image/jpeg", "cupom%20mercado.jpg") });

  const file = await takeSharedReceipt(caches);

  expect(caches.opened).toEqual([SHARE_INBOX]);
  expect(file.name).toBe("cupom mercado.jpg");
  expect(file.type).toBe("image/jpeg");
  expect(caches.store.has(SHARE_KEY)).toBe(false);
  expect(await takeSharedReceipt(caches)).toBeNull();
});

test("returns null when the Cache API is unavailable", async () => {
  expect(await takeSharedReceipt(undefined)).toBeNull();
});
