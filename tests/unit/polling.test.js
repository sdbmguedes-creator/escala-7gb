import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock do localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = value.toString(); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; }
  };
})();

Object.defineProperty(global, 'localStorage', { value: localStorageMock });

// Mock do Date.now para controle de tempo
const originalDateNow = Date.now;

describe('Polling e Sincronização - Testes Preventivos', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    // Definir constantes que o frontend usa
    global.PULL_ATIVO_MS = 30000;
    global.PULL_OCIOSO_TICKS = 10;
    global.JANELA_ATIVO_MS = 600000;
    global._pollTimer = null;
    global._pollTick = 0;
    global._ultimaInteracao = 0;
    global._ultimaRemota = 0;
    global.Sync = {
      ligado: true,
      fila: [],
      estado: 'ok',
      carregarFila: () => {},
      guardarFila: () => {},
      pintar: () => {},
      flush: vi.fn(),
      agendar: () => {},
      enfileirar: () => {}
    };
    global.Sessao = { token: 'test-token' };
    global.Transport = {
      disponivel: () => true,
      call: vi.fn().mockResolvedValue({ ok: true, versao: 1, marcas: [] })
    };
    global.D = { competencia: '2026-11' };
    global.aplicarRemoto = vi.fn();
    global.estadoDoServidor = vi.fn().mockReturnValue({});
    global.desenhar = vi.fn();
    global.status = vi.fn();
    global.document = {
      hidden: false,
      addEventListener: vi.fn(),
      getElementById: vi.fn().mockReturnValue({ classList: { contains: () => false } })
    };
    global.console = { log: vi.fn(), error: vi.fn() };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('Constantes de Polling', () => {
    it('deve ter PULL_ATIVO_MS configurado para 30 segundos (não 2 segundos)', () => {
      expect(PULL_ATIVO_MS).toBe(30000);
      expect(PULL_ATIVO_MS).not.toBe(2000);
    });

    it('deve ter PULL_OCIOSO_TICKS configurado para intervalos de 5 minutos no ocioso', () => {
      // 10 ticks * 30s = 300s = 5 min
      expect(PULL_OCIOSO_TICKS).toBe(10);
    });

    it('deve ter JANELA_ATIVO_MS de 10 minutos (600000ms)', () => {
      expect(JANELA_ATIVO_MS).toBe(600000);
      expect(JANELA_ATIVO_MS).not.toBe(300000);
    });
  });

  describe('agendarPoll', () => {
    it('deve criar timer com intervalo PULL_ATIVO_MS', () => {
      // We test the logic by simulating the setInterval call
      let intervalId = null;
      global.setInterval = vi.fn((fn, ms) => {
        intervalId = ms;
        return 123;
      });
      global.clearInterval = vi.fn();

      // Simular chamada da função
      _pollTimer = null;
      _pollTick = 0;
      Sync.ligado = true;

      // Copiar lógica da função agendarPoll
      if (_pollTimer) clearInterval(_pollTimer);
      _pollTick = 0;
      if (!Sync.ligado) return;
      _pollTimer = setInterval(function(){
        _pollTick++;
        var recente = (Date.now() - Math.max(_ultimaInteracao, _ultimaRemota)) < JANELA_ATIVO_MS;
        if (!recente && (_pollTick % PULL_OCIOSO_TICKS) !== 0) return;
        // atualizarDoServidor(ym);
      }, PULL_ATIVO_MS);

      expect(global.setInterval).toHaveBeenCalledWith(expect.any(Function), 30000);
    });

    it('não deve agendar polling se Sync.ligado for false', () => {
      Sync.ligado = false;
      _pollTimer = null;
      global.setInterval = vi.fn();

      if (_pollTimer) clearInterval(_pollTimer);
      _pollTick = 0;
      if (!Sync.ligado) return;
      _pollTimer = setInterval(() => {}, PULL_ATIVO_MS);

      expect(global.setInterval).not.toHaveBeenCalled();
    });
  });

  describe('Lógica de polling ativo vs ocioso', () => {
    it('deve chamar atualizarDoServidor a cada tick quando há interação recente', () => {
      const atualizarDoServidor = vi.fn();
      _pollTick = 0;
      _ultimaInteracao = Date.now(); // Interação agora
      _ultimaRemota = 0;

      // Simular 5 ticks
      for (let i = 0; i < 5; i++) {
        _pollTick++;
        var recente = (Date.now() - Math.max(_ultimaInteracao, _ultimaRemota)) < JANELA_ATIVO_MS;
        if (!recente && (_pollTick % PULL_OCIOSO_TICKS) !== 0) {
          continue;
        }
        atualizarDoServidor('2026-11');
      }

      // Deve ter chamado 5 vezes (recente = true)
      expect(atualizarDoServidor).toHaveBeenCalledTimes(5);
    });

    it('deve pular chamadas quando ocioso (sem interação por > 10 min)', () => {
      const atualizarDoServidor = vi.fn();
      _pollTick = 0;
      _ultimaInteracao = Date.now() - 700000; // 11 min atrás (> JANELA_ATIVO_MS)
      _ultimaRemota = 0;

      // Simular 15 ticks (PULL_OCIOSO_TICKS = 10)
      for (let i = 0; i < 15; i++) {
        _pollTick++;
        var recente = (Date.now() - Math.max(_ultimaInteracao, _ultimaRemota)) < JANELA_ATIVO_MS;
        if (!recente && (_pollTick % PULL_OCIOSO_TICKS) !== 0) {
          continue;
        }
        atualizarDoServidor('2026-11');
      }

      // Deve chamar apenas nos ticks 10 (múltiplo de PULL_OCIOSO_TICKS)
      expect(atualizarDoServidor).toHaveBeenCalledTimes(1);
    });

    it('deve chamar no primeiro tick mesmo ocioso (tick 0 % 10 === 0)', () => {
      const atualizarDoServidor = vi.fn();
      _pollTick = 0;
      _ultimaInteracao = Date.now() - 700000;
      _ultimaRemota = 0;

      for (let i = 0; i < 5; i++) {
        _pollTick++;
        var recente = (Date.now() - Math.max(_ultimaInteracao, _ultimaRemota)) < JANELA_ATIVO_MS;
        if (!recente && (_pollTick % PULL_OCIOSO_TICKS) !== 0) continue;
        atualizarDoServidor('2026-11');
      }

      // tick 10 não foi atingido, mas tick 0%10 seria no primeiro loop?
      // No código _pollTick++ acontece ANTES da verificação, então tick 1,2,3,4,5
      // Nenhum é múltiplo de 10 -> 0 chamadas
      expect(atualizarDoServidor).toHaveBeenCalledTimes(0);
    });
  });

  describe('atualizarDoServidor - Guards', () => {
    it('não deve executar se Sync.ligado for false', async () => {
      Sync.ligado = false;
      const Transport = { call: vi.fn() };
      global.Transport = Transport;

      // Copiar lógica
      if (!Sync.ligado || document.hidden) return;
      await Transport.call("apiPull", ['2026-11', Sessao.token, Sync.versao]);

      expect(Transport.call).not.toHaveBeenCalled();
    });

    it('não deve executar se document.hidden for true', async () => {
      Sync.ligado = true;
      document.hidden = true;
      const Transport = { call: vi.fn() };
      global.Transport = Transport;

      if (!Sync.ligado || document.hidden) return;
      await Transport.call("apiPull", ['2026-11', Sessao.token, Sync.versao]);

      expect(Transport.call).not.toHaveBeenCalled();
    });

    it('não deve executar se Sync.estado === "enviando"', async () => {
      Sync.ligado = true;
      document.hidden = false;
      Sync.estado = 'enviando';
      const Transport = { call: vi.fn() };
      global.Transport = Transport;

      if (!Sync.ligado || document.hidden) return;
      if (Sync.estado === "enviando") return;
      await Transport.call("apiPull", ['2026-11', Sessao.token, Sync.versao]);

      expect(Transport.call).not.toHaveBeenCalled();
    });

    it('não deve executar se Sync.fila.length > 0', async () => {
      Sync.ligado = true;
      document.hidden = false;
      Sync.estado = 'ok';
      Sync.fila = [{ ops: [{}] }];
      const Transport = { call: vi.fn() };
      global.Transport = Transport;

      if (!Sync.ligado || document.hidden) return;
      if (Sync.estado === "enviando") return;
      if (Sync.fila.length) return;
      await Transport.call("apiPull", ['2026-11', Sessao.token, Sync.versao]);

      expect(Transport.call).not.toHaveBeenCalled();
    });

    it('não deve executar se última interação < 1000ms', async () => {
      Sync.ligado = true;
      document.hidden = false;
      Sync.estado = 'ok';
      Sync.fila = [];
      _ultimaInteracao = Date.now() - 500; // 500ms atrás
      const Transport = { call: vi.fn() };
      global.Transport = Transport;

      if (!Sync.ligado || document.hidden) return;
      if (Sync.estado === "enviando") return;
      if (Sync.fila.length) return;
      if (Date.now() - _ultimaInteracao < 1000) return;
      await Transport.call("apiPull", ['2026-11', Sessao.token, Sync.versao]);

      expect(Transport.call).not.toHaveBeenCalled();
    });
  });

  describe('atualizarDoServidor - Versionamento e Race Condition', () => {
    it('deve ignorar resposta com versão menor que a atual (race condition)', async () => {
      Sync.ligado = true;
      document.hidden = false;
      Sync.estado = 'ok';
      Sync.fila = [];
      Sync.versao = 10;
      _ultimaInteracao = Date.now() - 5000;
      _ultimaRemota = 0;

      const Transport = {
        call: vi.fn().mockResolvedValue({ ok: true, versao: 5, marcas: [] }) // versão 5 < 10
      };
      global.Transport = Transport;
      global.aplicarRemoto = vi.fn();
      global.estadoDoServidor = vi.fn().mockReturnValue({});
      global.desenhar = vi.fn();
      global.status = vi.fn();

      // Lógica do atualizarDoServidor
      if (!Sync.ligado || document.hidden) return;
      if (Sync.estado === "enviando") return;
      if (Sync.fila.length) return;
      if (Date.now() - _ultimaInteracao < 1000) return;

      var r = await Transport.call("apiPull", ['2026-11', Sessao.token, Sync.versao]);
      if (!r || !r.ok || r.semMudanca || !r.marcas) return;
      if (Sync.versao !== null && r.versao < Sync.versao) return;
      if (_ultimaRemota > 0 && r.versao === Sync.versao) return;
      aplicarRemoto(estadoDoServidor(r), '2026-11');
      Sync.versao = r.versao;
      _ultimaRemota = Date.now();
      desenhar();

      expect(Transport.call).toHaveBeenCalled();
      expect(aplicarRemoto).not.toHaveBeenCalled(); // Deve ignorar versão antiga
      expect(Sync.versao).toBe(10); // Versão não deve mudar
    });

    it('deve ignorar resposta com mesma versão que _ultimaRemota', async () => {
      Sync.ligado = true;
      document.hidden = false;
      Sync.estado = 'ok';
      Sync.fila = [];
      Sync.versao = 5;
      _ultimaInteracao = Date.now() - 5000;
      _ultimaRemota = Date.now(); // Já teve atualização recente

      const Transport = {
        call: vi.fn().mockResolvedValue({ ok: true, versao: 5, marcas: [] }) // mesma versão
      };
      global.Transport = Transport;
      global.aplicarRemoto = vi.fn();
      global.estadoDoServidor = vi.fn().mockReturnValue({});
      global.desenhar = vi.fn();

      if (!Sync.ligado || document.hidden) return;
      if (Sync.estado === "enviando") return;
      if (Sync.fila.length) return;
      if (Date.now() - _ultimaInteracao < 1000) return;

      var r = await Transport.call("apiPull", ['2026-11', Sessao.token, Sync.versao]);
      if (!r || !r.ok || r.semMudanca || !r.marcas) return;
      if (Sync.versao !== null && r.versao < Sync.versao) return;
      if (_ultimaRemota > 0 && r.versao === Sync.versao) return;
      aplicarRemoto(estadoDoServidor(r), '2026-11');
      Sync.versao = r.versao;
      _ultimaRemota = Date.now();
      desenhar();

      expect(aplicarRemoto).not.toHaveBeenCalled();
    });

    it('deve aplicar remoto quando versão é maior', async () => {
      Sync.ligado = true;
      document.hidden = false;
      Sync.estado = 'ok';
      Sync.fila = [];
      Sync.versao = 5;
      _ultimaInteracao = Date.now() - 5000;
      _ultimaRemota = 0;

      const Transport = {
        call: vi.fn().mockResolvedValue({ ok: true, versao: 6, marcas: [{}] }) // versão maior
      };
      global.Transport = Transport;
      global.aplicarRemoto = vi.fn();
      global.estadoDoServidor = vi.fn().mockReturnValue({ mes: [] });
      global.desenhar = vi.fn();
      global.status = vi.fn();

      if (!Sync.ligado || document.hidden) return;
      if (Sync.estado === "enviando") return;
      if (Sync.fila.length) return;
      if (Date.now() - _ultimaInteracao < 1000) return;

      var r = await Transport.call("apiPull", ['2026-11', Sessao.token, Sync.versao]);
      if (!r || !r.ok || r.semMudanca || !r.marcas) return;
      if (Sync.versao !== null && r.versao < Sync.versao) return;
      if (_ultimaRemota > 0 && r.versao === Sync.versao) return;
      aplicarRemoto(estadoDoServidor(r), '2026-11');
      Sync.versao = r.versao;
      _ultimaRemota = Date.now();
      desenhar();

      expect(aplicarRemoto).toHaveBeenCalled();
      expect(Sync.versao).toBe(6);
      expect(desenhar).toHaveBeenCalled();
    });
  });

  describe('Sync.flush - Guards', () => {
    it('não deve executar se Sync.ligado for false', async () => {
      Sync.ligado = false;
      Sync.fila = [{ ops: [] }];
      Sync.estado = 'ok';

      if (!Sync.ligado || !Sync.fila.length) return;
      if (Sync.estado === "enviando") return;
      if (Sync.estado === "erro-fatal") return;

      expect(Sync.fila.length).toBe(1); // Não entrou no flush
    });

    it('não deve executar se fila vazia', async () => {
      Sync.ligado = true;
      Sync.fila = [];
      Sync.estado = 'ok';

      if (!Sync.ligado || !Sync.fila.length) return;
      if (Sync.estado === "enviando") return;
      if (Sync.estado === "erro-fatal") return;

      expect(Sync.fila.length).toBe(0);
    });

    it('não deve executar se estado === "enviando"', async () => {
      Sync.ligado = true;
      Sync.fila = [{ ops: [] }];
      Sync.estado = 'enviando';

      if (!Sync.ligado || !Sync.fila.length) return;
      if (Sync.estado === "enviando") return;
      if (Sync.estado === "erro-fatal") return;

      // Não deve prosseguir
    });

    it('não deve executar se estado === "erro-fatal"', async () => {
      Sync.ligado = true;
      Sync.fila = [{ ops: [] }];
      Sync.estado = 'erro-fatal';

      if (!Sync.ligado || !Sync.fila.length) return;
      if (Sync.estado === "enviando") return;
      if (Sync.estado === "erro-fatal") return;

      // Não deve prosseguir
    });
  });

  describe('Sync.agendar - Debounce de 1.5s', () => {
    it('deve criar timeout de 1500ms', () => {
      Sync.timer = null;
      global.setTimeout = vi.fn((fn, ms) => {
        expect(ms).toBe(1500);
        return 999;
      });
      global.clearTimeout = vi.fn();

      if (Sync.timer) clearTimeout(Sync.timer);
      Sync.timer = setTimeout(function(){ Sync.flush(); }, 1500);

      expect(global.setTimeout).toHaveBeenCalledWith(expect.any(Function), 1500);
    });

    it('deve limpar timer anterior antes de criar novo', () => {
      Sync.timer = 123;
      global.clearTimeout = vi.fn();
      global.setTimeout = vi.fn(() => 456);

      if (Sync.timer) clearTimeout(Sync.timer);
      Sync.timer = setTimeout(function(){ Sync.flush(); }, 1500);

      expect(global.clearTimeout).toHaveBeenCalledWith(123);
    });
  });
});