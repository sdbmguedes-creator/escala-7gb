const { defineConfig } = require("cypress");
const http = require("http");
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "frontend");
const PORTA = 4173;
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".png": "image/png" };

// Servidor estático local: os specs NUNCA dependem da URL de produção.
function iniciarServidorEstatico() {
  const srv = http.createServer((req, res) => {
    let rel = decodeURIComponent((req.url || "/").split("?")[0]);
    if (rel === "/") rel = "/index_v14.html";
    const arq = path.normalize(path.join(RAIZ, rel));
    if (!arq.startsWith(RAIZ) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) {
      res.writeHead(404); res.end("nao encontrado"); return;
    }
    res.writeHead(200, { "Content-Type": TIPOS[path.extname(arq)] || "application/octet-stream" });
    fs.createReadStream(arq).pipe(res);
  });
  srv.listen(PORTA, "127.0.0.1");
  return srv;
}

module.exports = defineConfig({
  e2e: {
    baseUrl: `http://127.0.0.1:${PORTA}`,
    video: false,
    setupNodeEvents(on) {
      const srv = iniciarServidorEstatico();
      on("after:run", () => { srv.close(); });
    },
  },
});
