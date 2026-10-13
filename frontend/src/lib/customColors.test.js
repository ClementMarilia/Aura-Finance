import { applyCustomColors, contrastText, sanitizeColors, isValidHex } from "./customColors";

describe("customColors", () => {
  test("valida hex", () => {
    expect(isValidHex("#aabbcc")).toBe(true);
    expect(isValidHex("red")).toBe(false);
    expect(isValidHex("#abc")).toBe(false);
  });

  test("sanitize descarta valores inválidos e chaves desconhecidas", () => {
    expect(sanitizeColors({ light: { primary: "#1268f4", bg: "x", evil: "#000000" }, dark: null }))
      .toEqual({ light: { primary: "#1268F4" }, dark: {} });
  });

  test("contraste", () => {
    expect(contrastText("#FFFFFF")).toBe("#061B4A");
    expect(contrastText("#000000")).toBe("#FFFFFF");
  });

  test("aplica e limpa variáveis por modo", () => {
    const root = document.createElement("div");
    const colors = { light: { primary: "#7C3AED" }, dark: { bg: "#000000" } };
    applyCustomColors(colors, "light", root);
    expect(root.style.getPropertyValue("--primary")).toBe("#7C3AED");
    expect(root.style.getPropertyValue("--primary-fg")).toBe("#FFFFFF");
    applyCustomColors(colors, "dark", root);
    expect(root.style.getPropertyValue("--primary")).toBe("");
    expect(root.style.getPropertyValue("--bg")).toBe("#000000");
  });
});
