module.exports = [
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        // Browser/Node globals
        self: "readonly",
        caches: "readonly",
        fetch: "readonly",
        module: "readonly",
        require: "readonly",
        process: "readonly",
        __dirname: "readonly",
        global: "readonly",
        globalThis: "readonly",
        // Browser APIs
        localStorage: "readonly",
        sessionStorage: "readonly",
        document: "readonly",
        window: "readonly",
        console: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        Date: "readonly",
        // Test globals
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        vi: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        // Cypress globals
        cy: "readonly",
        Cypress: "readonly",
        // Project-specific globals (defined in frontend/index_v14.html)
        Sync: "writable",
        Sessao: "writable",
        Transport: "writable",
        D: "writable",
        aplicarRemoto: "writable",
        estadoDoServidor: "writable",
        desenhar: "writable",
        status: "writable",
        PULL_ATIVO_MS: "readonly",
        PULL_OCIOSO_TICKS: "readonly",
        JANELA_ATIVO_MS: "readonly",
        _pollTimer: "writable",
        _pollTick: "writable",
        _ultimaInteracao: "writable",
        _ultimaRemota: "writable",
        _ultimaVersao: "writable",
        hashPin: "readonly"
      }
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "error"
    }
  }
];
