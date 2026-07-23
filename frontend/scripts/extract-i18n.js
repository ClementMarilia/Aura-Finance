const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const sourceRoot = path.resolve(__dirname, "../src");
const files = [];

function collectFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name === "i18n") continue;
    if (entry.isDirectory()) collectFiles(fullPath);
    else if (/\.(js|jsx)$/.test(entry.name)) files.push(fullPath);
  }
}

const messages = new Map();
const add = (value, file, line, kind) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || !/[A-Za-zÀ-ÿ]/.test(normalized)) return;
  if (!messages.has(normalized)) messages.set(normalized, []);
  messages.get(normalized).push({
    file: path.relative(sourceRoot, file),
    line,
    kind,
  });
};

collectFiles(sourceRoot);
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const ast = parser.parse(source, {
    sourceType: "module",
    plugins: ["jsx"],
  });

  traverse(ast, {
    StringLiteral(nodePath) {
      if (nodePath.parentPath?.isImportDeclaration()) return;
      if (nodePath.parentPath?.isCallExpression()
          && nodePath.parentPath.node.callee?.name === "tr") return;
      if (/[À-ÿ]/.test(nodePath.node.value)) {
        add(nodePath.node.value, file, nodePath.node.loc?.start.line, "string");
      }
    },
    TemplateElement(nodePath) {
      const value = nodePath.node.value?.cooked || "";
      if (/[À-ÿ]/.test(value)) {
        add(value, file, nodePath.node.loc?.start.line, "template");
      }
    },
    JSXText(nodePath) {
      add(nodePath.node.value, file, nodePath.node.loc?.start.line, "jsx");
    },
    JSXAttribute(nodePath) {
      const name = nodePath.node.name?.name;
      if (!["placeholder", "title", "aria-label", "alt"].includes(name)) return;
      const value = nodePath.node.value;
      if (value?.type === "StringLiteral") {
        add(value.value, file, value.loc?.start.line, `attr:${name}`);
      }
    },
    ObjectProperty(nodePath) {
      const key = nodePath.node.key;
      const name = key?.name || key?.value;
      const value = nodePath.node.value;
      if (["label", "title", "desc", "description", "hint", "name"].includes(name)
          && value?.type === "StringLiteral") {
        add(value.value, file, value.loc?.start.line, `property:${name}`);
      }
    },
    CallExpression(nodePath) {
      const callee = nodePath.node.callee;
      const property = callee?.property?.name;
      if (!["success", "error", "warning", "info", "confirm"].includes(property)
          && callee?.name !== "alert") return;
      const arg = nodePath.node.arguments[0];
      if (arg?.type === "StringLiteral") {
        add(arg.value, file, arg.loc?.start.line, `call:${property || callee.name}`);
      }
    },
  });
}

for (const [message, usages] of [...messages.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  process.stdout.write(`${JSON.stringify(message)}\t${JSON.stringify(usages)}\n`);
}
