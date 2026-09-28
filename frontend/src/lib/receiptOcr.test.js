import { adaptiveThreshold } from "@/lib/receiptOcr";

test("finds faint ink on a background that fades from dark to light", () => {
  const width = 200;
  const height = 20;
  const gray = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Background brightens left→right (uneven light); ink is 30 levels darker.
      const background = 90 + x * 0.8;
      const ink = x % 20 === 10 && y > 5 && y < 15;
      gray[y * width + x] = ink ? background - 30 : background;
    }
  }

  const out = adaptiveThreshold(gray, width, height, 0.1, 12);

  // A single global threshold (e.g. 150) would call the whole left half ink.
  expect(out[10 * width + 10]).toBe(0); // faint stroke on the dark side
  expect(out[10 * width + 190]).toBe(0); // stroke on the bright side
  expect(out[10 * width + 5]).toBe(255); // dark-side paper stays white
  expect(out[2 * width + 195]).toBe(255); // bright-side paper stays white
});
