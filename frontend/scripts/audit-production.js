const { readFileSync, readdirSync } = require("fs");
const { spawnSync } = require("child_process");
const path = require("path");

const audit = spawnSync(
  process.platform === "win32" ? "yarn.cmd" : "yarn",
  ["audit", "--groups", "dependencies", "--json"],
  { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }
);

const records = audit.stdout
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

const advisories = records
  .filter((record) => record.type === "auditAdvisory")
  .map((record) => record.data.advisory);
const summary = records.find((record) => record.type === "auditSummary");

if (!summary) {
  console.error(audit.stderr || "Dependency audit did not return a summary.");
  process.exit(1);
}

const sourceRoot = path.join(__dirname, "..", "src");
const sourceFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.[jt]sx?$/.test(entry.name) ? [entryPath] : [];
  });
const usesRscDataRouter = sourceFiles(sourceRoot).some((sourceFile) =>
  /\b(createBrowserRouter|RouterProvider)\b/.test(readFileSync(sourceFile, "utf8"))
);

const acceptedAdvisory = (advisory) =>
  advisory.id === 1124282 &&
  advisory.module_name === "react-router" &&
  !usesRscDataRouter &&
  advisory.findings.every((finding) =>
    finding.paths.every((dependencyPath) => dependencyPath === "react-router-dom>react-router")
  );

const blocking = advisories.filter(
  (advisory) =>
    ["high", "critical"].includes(advisory.severity) && !acceptedAdvisory(advisory)
);
const accepted = advisories.filter(acceptedAdvisory);

for (const advisory of accepted) {
  console.warn(
    `Accepted non-applicable advisory ${advisory.id}: ${advisory.title} ` +
      "(SPA BrowserRouter; no React Server Components or server actions)."
  );
}

if (blocking.length) {
  for (const advisory of blocking) {
    console.error(
      `${advisory.severity.toUpperCase()} ${advisory.module_name}: ${advisory.title} ` +
        `(advisory ${advisory.id})`
    );
  }
  process.exit(1);
}

console.log(
  `Dependency audit passed: no applicable high/critical vulnerabilities ` +
    `(${accepted.length} documented non-applicable advisory).`
);
