const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const localeDir = path.resolve(__dirname, "../src/i18n");
const localeFiles = ["en.js", "it.js", "es.js"];
const keySets = new Map();
let failed = false;

for (const file of localeFiles) {
  const source = fs.readFileSync(path.join(localeDir, file), "utf8");
  const ast = parser.parse(source, { sourceType: "module" });
  const keys = [];
  traverse(ast, {
    ObjectProperty(nodePath) {
      if (nodePath.node.key?.type === "StringLiteral") keys.push(nodePath.node.key.value);
    },
  });
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  if (duplicates.length) {
    failed = true;
    process.stderr.write(`${file}: duplicate keys: ${[...new Set(duplicates)].join(", ")}\n`);
  }
  keySets.set(file, new Set(keys));
}

const reference = keySets.get(localeFiles[0]);
for (const file of localeFiles.slice(1)) {
  const keys = keySets.get(file);
  const missing = [...reference].filter((key) => !keys.has(key));
  const extra = [...keys].filter((key) => !reference.has(key));
  if (missing.length || extra.length) {
    failed = true;
    process.stderr.write(`${file}: ${missing.length} missing, ${extra.length} extra translation keys\n`);
    if (missing.length) process.stderr.write(`  missing: ${missing.join(" | ")}\n`);
    if (extra.length) process.stderr.write(`  extra: ${extra.join(" | ")}\n`);
  }
}

if (failed) process.exit(1);
process.stdout.write(`Translation catalogs verified: ${reference.size} shared messages across ${localeFiles.length} languages.\n`);
