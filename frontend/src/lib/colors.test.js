import { contrastRatio, readableOnDark } from "./colors";

const surface = [0x07, 0x1a, 0x3c];
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

describe("readableOnDark", () => {
  test("keeps colours that are already visible on the dark surface", () => {
    expect(readableOnDark("#E5A83B")).toBe("#E5A83B");
    expect(readableOnDark("#4FD49B")).toBe("#4FD49B");
  });

  test.each(["#061B4A", "#1F3B2C", "#000000", "#2C2C2C", "#5B2333"])(
    "lightens %s until it reaches 3:1 contrast",
    (color) => {
      const result = readableOnDark(color);
      expect(result).not.toBe(color);
      expect(contrastRatio(rgb(result), surface)).toBeGreaterThanOrEqual(3);
    },
  );

  test("supports shorthand hex and leaves unknown values alone", () => {
    expect(contrastRatio(rgb(readableOnDark("#000")), surface)).toBeGreaterThanOrEqual(3);
    expect(readableOnDark("tomato")).toBe("tomato");
    expect(readableOnDark(undefined)).toBeUndefined();
  });
});
