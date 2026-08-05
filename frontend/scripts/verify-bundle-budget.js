const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const buildDirectory = path.resolve(__dirname, "..", "build", "static", "js");
const mainBundles = fs.existsSync(buildDirectory)
  ? fs.readdirSync(buildDirectory).filter((file) => /^main\.[a-f0-9]+\.js$/.test(file))
  : [];

if (mainBundles.length !== 1) {
  console.error(`Bundle principal não encontrado em ${buildDirectory}. Execute o build antes da verificação.`);
  process.exit(1);
}

const budgetKiB = 200;
const bundlePath = path.join(buildDirectory, mainBundles[0]);
const gzipBytes = zlib.gzipSync(fs.readFileSync(bundlePath), { level: 9 }).length;
const gzipKiB = gzipBytes / 1024;

console.log(`Bundle principal: ${gzipKiB.toFixed(2)} KiB gzip (limite: ${budgetKiB} KiB).`);

if (gzipKiB > budgetKiB) {
  console.error("Orçamento excedido. Mova novas páginas ou bibliotecas pesadas para carregamento sob demanda.");
  process.exit(1);
}
