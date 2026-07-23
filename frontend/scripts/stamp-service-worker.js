const fs = require("fs");
const path = require("path");
const packageJson = require("../package.json");

const serviceWorkerPath = path.join(__dirname, "..", "build", "service-worker.js");
const placeholder = "__CRELITH_BUILD_VERSION__";

if (!fs.existsSync(serviceWorkerPath)) {
  throw new Error(`Service worker não encontrado em ${serviceWorkerPath}`);
}

const commit =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  process.env.REACT_APP_BUILD_ID;
const buildId = commit
  ? `${packageJson.version}-${commit.slice(0, 12)}`
  : `${packageJson.version}-${Date.now()}`;

const source = fs.readFileSync(serviceWorkerPath, "utf8");
if (!source.includes(placeholder)) {
  throw new Error("Placeholder da versão não encontrado no service worker");
}

fs.writeFileSync(
  serviceWorkerPath,
  source.replaceAll(placeholder, buildId),
  "utf8",
);

console.log(`[Crelith Finance] Service worker gerado para ${buildId}`);
