const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const write = process.argv.includes("--write");
const srcRoot = path.resolve(__dirname, "../src");
const i18nRoot = path.join(srcRoot, "i18n");
const sourceFiles = [];
const messages = new Set();

function walk(dir, callback) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, callback);
    else callback(fullPath);
  }
}

for (const file of ["index.js", "en.js", "it.js", "es.js"]) {
  const source = fs.readFileSync(path.join(i18nRoot, file), "utf8");
  const ast = parser.parse(source, { sourceType: "module" });
  traverse(ast, {
    ObjectProperty(nodePath) {
      const key = nodePath.node.key;
      if (key?.type === "StringLiteral") messages.add(key.value);
    },
  });
}

walk(srcRoot, (file) => {
  if (!/\.(js|jsx)$/.test(file) || file.startsWith(i18nRoot)) return;
  sourceFiles.push(file);
});

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const orderedMessages = [...messages].sort((a, b) => b.length - a.length);
let changedFiles = 0;

for (const file of sourceFiles) {
  let source = fs.readFileSync(file, "utf8");
  const before = source;

  for (const message of orderedMessages) {
    const escaped = escapeRegex(message);
    const encoded = JSON.stringify(message);

    // JSX attributes need braces around expressions.
    source = source.replace(
      new RegExp(`(\\b[\\w:-]+=)(["'])${escaped}\\2`, "g"),
      `$1{tr(${encoded})}`,
    );

    // Plain JSX text. Preserve surrounding layout whitespace.
    source = source.replace(
      new RegExp(`>(\\s*)${escaped}(\\s*)<`, "g"),
      `>$1{tr(${encoded})}$2<`,
    );

    // JavaScript string values, including labels, toast messages and ternaries.
    // Existing tr("...") calls are intentionally left alone.
    source = source.replace(
      new RegExp(`(?<!tr\\()(["'])${escaped}\\1`, "g"),
      `tr(${encoded})`,
    );
  }

  if (source === before) continue;
  if (!source.includes('from "@/i18n"')) {
    const imports = [...source.matchAll(/^import .*?;\s*$/gm)];
    const insertionPoint = imports.length
      ? imports[imports.length - 1].index + imports[imports.length - 1][0].length
      : 0;
    source = `${source.slice(0, insertionPoint)}\nimport { translate as tr } from "@/i18n";${source.slice(insertionPoint)}`;
  }

  changedFiles += 1;
  process.stdout.write(`${write ? "updated" : "would update"} ${path.relative(srcRoot, file)}\n`);
  if (write) fs.writeFileSync(file, source);
}

process.stdout.write(`${changedFiles} file(s) ${write ? "updated" : "would be updated"}\n`);
