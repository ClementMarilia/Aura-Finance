const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const packageJson = require("../package.json");

const root = path.join(__dirname, "..");
const templatePath = path.join(root, "public", "service-worker.js");
const builtPath = path.join(root, "build", "service-worker.js");
const registerPath = path.join(root, "src", "sw-register.js");

const template = fs.readFileSync(templatePath, "utf8");
const built = fs.readFileSync(builtPath, "utf8");
const registerSource = fs.readFileSync(registerPath, "utf8");

assert(
  template.includes("__CRELITH_BUILD_VERSION__"),
  "O template deve conter o placeholder da versão",
);
assert(
  !built.includes("__CRELITH_BUILD_VERSION__"),
  "O build deve ter uma versão real",
);
assert(
  built.includes(packageJson.version),
  "A versão do pacote deve aparecer no service worker gerado",
);
assert(
  registerSource.includes("if (!reloadRequested || refreshing) return;"),
  "O app só pode recarregar após confirmação explícita",
);

const handlers = {};
const inbox = new Map();
let skipWaitingCalls = 0;
const sandbox = {
  URL,
  Promise,
  console,
  fetch: () => Promise.reject(new Error("fetch não usado neste teste")),
  Response,
  Request,
  caches: {
    open: (name) => Promise.resolve({
      addAll: () => Promise.resolve(),
      put: (key, response) => {
        inbox.set(`${name}|${key}`, response);
        return Promise.resolve();
      },
    }),
    keys: () => Promise.resolve([]),
    match: () => Promise.resolve(null),
  },
  self: {
    location: { origin: "https://www.crelithtech.com" },
    clients: { claim: () => Promise.resolve() },
    skipWaiting: () => {
      skipWaitingCalls += 1;
      return Promise.resolve();
    },
    addEventListener: (name, handler) => {
      handlers[name] = handler;
    },
  },
};

vm.runInNewContext(built, sandbox);

let installPromise;
handlers.install({
  waitUntil: (promise) => {
    installPromise = promise;
  },
});

Promise.resolve(installPromise)
  .then(() => {
    assert.strictEqual(
      skipWaitingCalls,
      0,
      "Instalar uma versão não pode ativá-la automaticamente",
    );

    handlers.message({ data: { type: "SKIP_WAITING" } });
    assert.strictEqual(
      skipWaitingCalls,
      1,
      "A confirmação do usuário deve liberar a atualização",
    );

    // Android share sheet → POST multipart to the share_target action.
    const form = new FormData();
    form.append("receipt", new File(["jpeg"], "cupom mercado.jpg", { type: "image/jpeg" }));
    let shared;
    handlers.fetch({
      request: new Request("https://www.crelithtech.com/compartilhar-recibo", { method: "POST", body: form }),
      respondWith: (promise) => { shared = promise; },
    });
    assert(shared, "O service worker deve responder ao compartilhamento de recibo");
    return shared;
  })
  .then(async (response) => {
    assert.strictEqual(response.status, 303, "O compartilhamento deve redirecionar ao formulário");
    assert.strictEqual(response.headers.get("location"), "https://www.crelithtech.com/lancamentos?recibo=compartilhado");
    const stored = inbox.get("shared-receipt-inbox|/shared-receipt/latest");
    assert(stored, "O recibo compartilhado deve ficar na caixa de entrada");
    assert.strictEqual(stored.headers.get("content-type"), "image/jpeg");
    assert.strictEqual(decodeURIComponent(stored.headers.get("x-file-name")), "cupom mercado.jpg");
    assert.strictEqual(await stored.text(), "jpeg");

    console.log(
      `[Crelith Finance] PWA validada: v${packageJson.version}, atualização sob confirmação, recibo compartilhado recebido.`,
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
