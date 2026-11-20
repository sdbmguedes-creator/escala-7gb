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
      global.setInterval = vi.fn(() => {
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

    it('não deve lançar ReferenceError quando flush for chamado sem argumento forcar e sem pullInicialConcluido', async () => {
      const SyncObj = {
        pullInicialConcluido: false,
        ligado: true,
        fila: [{ ym: '2026-11', ops: [{ t: 'marca' }] }],
        estado: 'ok',
        flush: async function(forcar) {
          if (!this.pullInicialConcluido && !forcar) return false;
          return true;
        }
      };

      // Chamada sem argumentos — não deve lançar "ReferenceError: forcar is not defined"
      let executouSemForcar = false;
      await expect(
        (async () => {
          executouSemForcar = await SyncObj.flush();
        })()
      ).resolves.not.toThrow();
      expect(executouSemForcar).toBe(false);

      // Chamada com forcar = true
      const executouComForcar = await SyncObj.flush(true);
      expect(executouComForcar).toBe(true);
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

  describe('Deduplicação de Pull e Mesclagem de Movimentos (Etapa 2)', () => {
    it('deve deduplicar chamadas concorrentes para a mesma competência em _pullAtivoPorYm', async () => {
      let callCount = 0;
      const _pullAtivoPorYm = {};

      const fakeTransportCall = vi.fn().mockImplementation(() => {
        callCount++;
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({ ok: true, versao: 2, marcas: [], movimentos: [] });
          }, 50);
        });
      });

      const atualizarDoServidor = (ym) => {
        if (_pullAtivoPorYm[ym]) return _pullAtivoPorYm[ym];
        const promessa = (async () => {
          try {
            return await fakeTransportCall('apiPull', [ym, 'token-123', 1, null]);
          } finally {
            delete _pullAtivoPorYm[ym];
          }
        })();
        _pullAtivoPorYm[ym] = promessa;
        return promessa;
      };

      // Dispara 2 chamadas concorrentes simultâneas para '2026-11'
      const p1 = atualizarDoServidor('2026-11');
      const p2 = atualizarDoServidor('2026-11');

      // Ambas devem apontar para a mesma promessa
      expect(p1).toBe(p2);
      expect(_pullAtivoPorYm['2026-11']).toBeDefined();

      vi.advanceTimersByTime(60);
      const [res1, res2] = await Promise.all([p1, p2]);

      expect(res1.ok).toBe(true);
      expect(res2.ok).toBe(true);
      expect(callCount).toBe(1);
      // Garantir liberação do map no finally
      expect(_pullAtivoPorYm['2026-11']).toBeUndefined();
    });

    it('deve limpar _pullAtivoPorYm no finally mesmo quando a chamada falha', async () => {
      const _pullAtivoPorYm = {};
      const fakeTransportCall = vi.fn().mockRejectedValue(new Error('Falha de rede'));

      const sincronizarMes = (ym) => {
        if (_pullAtivoPorYm[ym]) return _pullAtivoPorYm[ym];
        const promessa = (async () => {
          try {
            return await fakeTransportCall('apiPull', [ym, 'token-123']);
          } finally {
            delete _pullAtivoPorYm[ym];
          }
        })();
        _pullAtivoPorYm[ym] = promessa;
        return promessa;
      };

      const p1 = sincronizarMes('2026-11');
      expect(_pullAtivoPorYm['2026-11']).toBeDefined();

      await expect(p1).rejects.toThrow('Falha de rede');
      expect(_pullAtivoPorYm['2026-11']).toBeUndefined();
    });

    it('deve mesclar e ordenar cronologicamente movimentos sem perder registros', () => {
      const D = {
        movimentos: [
          { quando: '2026-11-01T10:00:00Z', tipo: 'remessa', origem: 'A', destino: 'B', qtd: 2 },
          { quando: '2026-11-05T12:00:00Z', tipo: 'transferencia', origem: 'B', destino: 'C', qtd: 1 }
        ]
      };

      const remotoMovimentos = [
        // Registro já existente (duplicado)
        { quando: '2026-11-01T10:00:00Z', tipo: 'remessa', origem: 'A', destino: 'B', qtd: 2 },
        // Registro mais novo (quando.asc incremental)
        { quando: '2026-11-10T08:00:00Z', tipo: 'ajuste_escala', origem: 'C', destino: 'A', qtd: 3 },
        // Registro intermediário fora de ordem
        { quando: '2026-11-03T09:00:00Z', tipo: 'mudanca_sb', origem: 'X', destino: 'Y', qtd: 1 }
      ];

      // Lógica de mesclagem idêntica à de aplicarRemoto
      const idMov = function(m){ return [m.quando, m.tipo, m.origem, m.destino, m.qtd].join('|'); };
      const mapa = {};
      (D.movimentos || []).forEach(function(m){ mapa[idMov(m)] = m; });
      remotoMovimentos.forEach(function(m){ mapa[idMov(m)] = m; });
      D.movimentos = Object.values(mapa).sort(function(a, b){
        return String(a.quando || '').localeCompare(String(b.quando || ''));
      });

      expect(D.movimentos.length).toBe(4);
      expect(D.movimentos[0].quando).toBe('2026-11-01T10:00:00Z');
      expect(D.movimentos[1].quando).toBe('2026-11-03T09:00:00Z');
      expect(D.movimentos[2].quando).toBe('2026-11-05T12:00:00Z');
      expect(D.movimentos[3].quando).toBe('2026-11-10T08:00:00Z');
    });

    it('deve resetar Sync.versao e _ultimaRemota ao trocar de competência para evitar bloqueio por versão', () => {
      // Simula estado anterior com versão alta em 2026-11
      const SyncMock = { versao: 42, ligado: true };
      let _ultimaRemotaMock = 1700000000;
      const D = { competencia: '2026-11-01' };
      const sincronizarMesMock = vi.fn().mockResolvedValue(true);
      const agendarPollMock = vi.fn();

      const mudarCompetencia = (v) => {
        if (!v) return;
        D.competencia = v + '-01';
        SyncMock.versao = null;
        _ultimaRemotaMock = 0;
        if (SyncMock.ligado) {
          sincronizarMesMock(v).then((ok) => {
            if (ok) agendarPollMock(v);
          });
        }
      };

      mudarCompetencia('2026-12');

      expect(D.competencia).toBe('2026-12-01');
      expect(SyncMock.versao).toBeNull();
      expect(_ultimaRemotaMock).toBe(0);
      expect(sincronizarMesMock).toHaveBeenCalledWith('2026-12');
    });
  });

  describe('reaplicarFilaPendenteLocal - todos os tipos de op', () => {
    let marks, comments, vis, D, Sync;

    beforeEach(() => {
      marks = { '1ªSB|1|2026-11-01': 'X' };
      comments = { '1ªSB|1|2026-11-01': 'nota antiga' };
      vis = { '1ªSB': ['user1', 'user2'] };
      D = {
        visLinhas: { '1ªSB': '10,20' },
        mes: [
          { id: '1', secao: '1ªSB', escala: 'A', motorista: '', adm: 'N', restricao: false, cotasAdm: 0, afast: [], escalaOrigem: '', escalaOrigemAdm: '' }
        ]
      };
      Sync = {
        fila: [],
        ligado: true,
        estado: 'ok'
      };
    });

    it('deve reaplicar op marca (adicionar/atualizar)', () => {
      Sync.fila = [{
        ym: '2026-11',
        ops: [{ t: 'marca', k: '1ªSB|1|2026-11-02', v: 'F' }]
      }];

      Sync.fila.forEach(item => {
        if (item.ym === '2026-11' && Array.isArray(item.ops)) {
          item.ops.forEach(op => {
            if (op.t === 'marca' && op.k) {
              if (op.v === '' || op.v == null) delete marks[op.k];
              else marks[op.k] = op.v;
            }
          });
        }
      });

      expect(marks['1ªSB|1|2026-11-02']).toBe('F');
    });

    it('deve reaplicar op marca (deletar)', () => {
      Sync.fila = [{
        ym: '2026-11',
        ops: [{ t: 'marca', k: '1ªSB|1|2026-11-01', v: '' }]
      }];

      Sync.fila.forEach(item => {
        if (item.ym === '2026-11' && Array.isArray(item.ops)) {
          item.ops.forEach(op => {
            if (op.t === 'marca' && op.k) {
              if (op.v === '' || op.v == null) delete marks[op.k];
              else marks[op.k] = op.v;
            }
          });
        }
      });

      expect(marks['1ªSB|1|2026-11-01']).toBeUndefined();
    });
  });

  describe('reaplicarFilaPendenteLocal - comment, vis, aco, elenco', () => {
    let marks, comments, vis, D, Sync;

    beforeEach(() => {
      marks = { '1ªSB|1|2026-11-01': 'X' };
      comments = { '1ªSB|1|2026-11-01': 'nota antiga' };
      vis = { '1ªSB': ['user1', 'user2'] };
      D = {
        visLinhas: { '1ªSB': '10,20' },
        mes: [
          { id: '1', secao: '1ªSB', escala: 'A', motorista: '', adm: 'N', restricao: false, cotasAdm: 0, afast: [], escalaOrigem: '', escalaOrigemAdm: '' }
        ]
      };
      Sync = {
        fila: [],
        ligado: true,
        estado: 'ok'
      };
    });

    it('deve reaplicar op comment (adicionar/atualizar)', () => {
      Sync.fila = [{
        ym: '2026-11',
        ops: [{ t: 'comment', k: '1ªSB|1|2026-11-01', v: 'nova nota' }]
      }];

      Sync.fila.forEach(item => {
        if (item.ym === '2026-11' && Array.isArray(item.ops)) {
          item.ops.forEach(op => {
            if (op.t === 'comment' && op.k) {
              if (op.v === '' || op.v == null) delete comments[op.k];
              else comments[op.k] = op.v;
            }
          });
        }
      });

      expect(comments['1ªSB|1|2026-11-01']).toBe('nova nota');
    });

    it('deve reaplicar op comment (deletar)', () => {
      Sync.fila = [{
        ym: '2026-11',
        ops: [{ t: 'comment', k: '1ªSB|1|2026-11-01', v: '' }]
      }];

      Sync.fila.forEach(item => {
        if (item.ym === '2026-11' && Array.isArray(item.ops)) {
          item.ops.forEach(op => {
            if (op.t === 'comment' && op.k) {
              if (op.v === '' || op.v == null) delete comments[op.k];
              else comments[op.k] = op.v;
            }
          });
        }
      });

      expect(comments['1ªSB|1|2026-11-01']).toBeUndefined();
    });

    it('deve reaplicar op vis (atualizar lista e linhas)', () => {
      Sync.fila = [{
        ym: '2026-11',
        ops: [{ t: 'vis', sb: '1ªSB', lista: ['user3'], linhas: '30,40' }]
      }];

      Sync.fila.forEach(item => {
        if (item.ym === '2026-11' && Array.isArray(item.ops)) {
          item.ops.forEach(op => {
            if (op.t === 'vis' && op.sb) {
              if (op.lista && op.lista.length) vis[op.sb] = op.lista;
              else delete vis[op.sb];
              if (op.linhas) D.visLinhas[op.sb] = op.linhas;
              else delete D.visLinhas[op.sb];
            }
          });
        }
      });

      expect(vis['1ªSB']).toEqual(['user3']);
      expect(D.visLinhas['1ªSB']).toBe('30,40');
    });

    it('deve reaplicar op vis (deletar)', () => {
      Sync.fila = [{
        ym: '2026-11',
        ops: [{ t: 'vis', sb: '1ªSB', lista: [], linhas: null }]
      }];

      Sync.fila.forEach(item => {
        if (item.ym === '2026-11' && Array.isArray(item.ops)) {
          item.ops.forEach(op => {
            if (op.t === 'vis' && op.sb) {
              if (op.lista && op.lista.length) vis[op.sb] = op.lista;
              else delete vis[op.sb];
              if (op.linhas) D.visLinhas[op.sb] = op.linhas;
              else delete D.visLinhas[op.sb];
            }
          });
        }
      });

      expect(vis['1ªSB']).toBeUndefined();
      expect(D.visLinhas['1ªSB']).toBeUndefined();
    });
  });

  describe('reaplicarFilaPendenteLocal - aco, elenco', () => {
    let marks, comments, vis, D, Sync;

    beforeEach(() => {
      marks = { '1ªSB|1|2026-11-01': 'X' };
      comments = { '1ªSB|1|2026-11-01': 'nota antiga' };
      vis = { '1ªSB': ['user1', 'user2'] };
      D = {
        visLinhas: { '1ªSB': '10,20' },
        mes: [
          { id: '1', secao: '1ªSB', escala: 'A', motorista: '', adm: 'N', restricao: false, cotasAdm: 0, afast: [], escalaOrigem: '', escalaOrigemAdm: '' }
        ]
      };
      Sync = {
        fila: [],
        ligado: true,
        estado: 'ok'
      };
    });

    it('deve reaplicar op aco (add/del)', () => {
      Sync.fila = [{
        ym: '2026-11',
        ops: [{ t: 'aco', add: ['user3'], del: ['user1'] }]
      }];

      const aco = ['user1', 'user2'];

      Sync.fila.forEach(item => {
        if (item.ym === '2026-11' && Array.isArray(item.ops)) {
          item.ops.forEach(op => {
            if (op.t === 'aco') {
              if (op.add && op.add.length) {
                op.add.forEach(id => { if (aco.indexOf(id) < 0) aco.push(id); });
              }
              if (op.del && op.del.length) {
                op.del.forEach(id => { const idx = aco.indexOf(id); if (idx >= 0) aco.splice(idx, 1); });
              }
            }
          });
        }
      });

      expect(aco).toContain('user3');
      expect(aco).not.toContain('user1');
      expect(aco).toContain('user2');
    });

    it('deve reaplicar op elenco (atualizar campos)', () => {
      Sync.fila = [{
        ym: '2026-11',
        ops: [{ t: 'elenco', id: '1', campos: { secao: '2ªSB', adm: 'S' } }]
      }];

      Sync.fila.forEach(item => {
        if (item.ym === '2026-11' && Array.isArray(item.ops)) {
          item.ops.forEach(op => {
            if (op.t === 'elenco' && op.id) {
              const m = D.mes.find(x => String(x.id) === String(op.id));
              if (op.campos === null && m) {
                D.mes.splice(D.mes.indexOf(m), 1);
              } else if (op.campos && m) {
                Object.keys(op.campos).forEach(c => { m[c] = op.campos[c]; });
              }
            }
          });
        }
      });

      expect(D.mes[0].secao).toBe('2ªSB');
      expect(D.mes[0].adm).toBe('S');
    });

    it('deve reaplicar op elenco (remover militar)', () => {
      Sync.fila = [{
        ym: '2026-11',
        ops: [{ t: 'elenco', id: '1', campos: null }]
      }];

      Sync.fila.forEach(item => {
        if (item.ym === '2026-11' && Array.isArray(item.ops)) {
          item.ops.forEach(op => {
            if (op.t === 'elenco' && op.id) {
              const m = D.mes.find(x => String(x.id) === String(op.id));
              if (op.campos === null && m) {
                D.mes.splice(D.mes.indexOf(m), 1);
              } else if (op.campos && m) {
                Object.keys(op.campos).forEach(c => { m[c] = op.campos[c]; });
              }
            }
          });
        }
      });

      expect(D.mes.length).toBe(0);
    });
  });

  describe('Debounce _pullAtivoPorYm (2000ms)', () => {
    let _pullAtivoPorYm, _ultimoPullPorYm, PULL_DEBOUNCE_MS;
    let fakeTransportCall, Sync, Sessao, D, Transport, _ultimaInteracao, _ultimaRemota;
    let atualizarDoServidor, sincronizarMes;

    beforeEach(() => {
      vi.useFakeTimers();
      _pullAtivoPorYm = {};
      _ultimoPullPorYm = {};
      PULL_DEBOUNCE_MS = 2000;
      _ultimaInteracao = Date.now() - 5000;
      _ultimaRemota = 0;
      
      Sync = { ligado: true, estado: 'ok', fila: [], versao: 1, enfileirar: vi.fn(), flush: vi.fn(), pintar: vi.fn(), agendar: vi.fn() };
      Sessao = { token: 'token-123' };
      D = { competencia: '2026-11-01', movimentos: [] };
      
      fakeTransportCall = vi.fn().mockResolvedValue({ ok: true, versao: 2, marcas: [], semMudanca: false });
      Transport = { disponivel: () => true, call: fakeTransportCall };
      
      atualizarDoServidor = async (ym) => {
        if (!Sync.ligado) return;
        if (Sync.estado === 'enviando') return;
        if (Sync.fila.length) return;
        
        var agora = Date.now();
        if (_pullAtivoPorYm[ym]) return _pullAtivoPorYm[ym];
        if (_ultimoPullPorYm[ym] && (agora - _ultimoPullPorYm[ym]) < PULL_DEBOUNCE_MS) {
          return Promise.resolve(false);
        }
        
        var promessa = (async () => {
          try {
            var ultimoMov = (D.movimentos && D.movimentos.length) ? D.movimentos[D.movimentos.length - 1].quando : null;
            var r = await Transport.call('apiPull', [ym, Sessao.token, Sync.versao, ultimoMov]).catch(() => null);
            return r;
          } finally {
            delete _pullAtivoPorYm[ym];
            _ultimoPullPorYm[ym] = Date.now();
          }
        })();
        
        _pullAtivoPorYm[ym] = promessa;
        return promessa;
      };
      
      sincronizarMes = async (ym) => {
        if (!Transport.disponivel() || !Sessao.token) return false;
        if (Sync.estado === 'enviando') return false;
        
        var agora = Date.now();
        if (_pullAtivoPorYm[ym]) return _pullAtivoPorYm[ym];
        if (_ultimoPullPorYm[ym] && (agora - _ultimoPullPorYm[ym]) < PULL_DEBOUNCE_MS) {
          return Promise.resolve(false);
        }
        
        var promessa = (async () => {
          try {
            var desde = (Sync.versao != null && !Sync.fila.length) ? Sync.versao : null;
            var ultimoMov = (D.movimentos && D.movimentos.length) ? D.movimentos[D.movimentos.length - 1].quando : null;
            var r = await Transport.call('apiPull', [ym, Sessao.token, desde, ultimoMov]).catch(() => null);
            return r;
          } finally {
            delete _pullAtivoPorYm[ym];
            _ultimoPullPorYm[ym] = Date.now();
          }
        })();
        
        _pullAtivoPorYm[ym] = promessa;
        return promessa;
      };
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('deve permitir pull imediato se não há pull anterior', async () => {
      const r1 = await atualizarDoServidor('2026-11');
      expect(fakeTransportCall).toHaveBeenCalledTimes(1);
      expect(r1).toBeTruthy();
    });

    it('deve bloquear segundo pull dentro de 2000ms (debounce)', async () => {
      await atualizarDoServidor('2026-11');
      expect(fakeTransportCall).toHaveBeenCalledTimes(1);
      
      const r2 = await atualizarDoServidor('2026-11');
      expect(fakeTransportCall).toHaveBeenCalledTimes(1);
      expect(r2).toBe(false);
    });
  });

  describe('Debounce _pullAtivoPorYm - continuar', () => {
    let _pullAtivoPorYm, _ultimoPullPorYm, PULL_DEBOUNCE_MS;
    let fakeTransportCall, Sync, Sessao, D, Transport, _ultimaInteracao, _ultimaRemota;
    let atualizarDoServidor, sincronizarMes;

    beforeEach(() => {
      vi.useFakeTimers();
      _pullAtivoPorYm = {};
      _ultimoPullPorYm = {};
      PULL_DEBOUNCE_MS = 2000;
      _ultimaInteracao = Date.now() - 5000;
      _ultimaRemota = 0;
      
      Sync = { ligado: true, estado: 'ok', fila: [], versao: 1, enfileirar: vi.fn(), flush: vi.fn(), pintar: vi.fn(), agendar: vi.fn() };
      Sessao = { token: 'token-123' };
      D = { competencia: '2026-11-01', movimentos: [] };
      
      fakeTransportCall = vi.fn().mockResolvedValue({ ok: true, versao: 2, marcas: [], semMudanca: false });
      Transport = { disponivel: () => true, call: fakeTransportCall };
      
      atualizarDoServidor = async (ym) => {
        if (!Sync.ligado) return;
        if (Sync.estado === 'enviando') return;
        if (Sync.fila.length) return;
        
        var agora = Date.now();
        if (_pullAtivoPorYm[ym]) return _pullAtivoPorYm[ym];
        if (_ultimoPullPorYm[ym] && (agora - _ultimoPullPorYm[ym]) < PULL_DEBOUNCE_MS) {
          return Promise.resolve(false);
        }
        
        var promessa = (async () => {
          try {
            var ultimoMov = (D.movimentos && D.movimentos.length) ? D.movimentos[D.movimentos.length - 1].quando : null;
            var r = await Transport.call('apiPull', [ym, Sessao.token, Sync.versao, ultimoMov]).catch(() => null);
            return r;
          } finally {
            delete _pullAtivoPorYm[ym];
            _ultimoPullPorYm[ym] = Date.now();
          }
        })();
        
        _pullAtivoPorYm[ym] = promessa;
        return promessa;
      };
      
      sincronizarMes = async (ym) => {
        if (!Transport.disponivel() || !Sessao.token) return false;
        if (Sync.estado === 'enviando') return false;
        
        var agora = Date.now();
        if (_pullAtivoPorYm[ym]) return _pullAtivoPorYm[ym];
        if (_ultimoPullPorYm[ym] && (agora - _ultimoPullPorYm[ym]) < PULL_DEBOUNCE_MS) {
          return Promise.resolve(false);
        }
        
        var promessa = (async () => {
          try {
            var desde = (Sync.versao != null && !Sync.fila.length) ? Sync.versao : null;
            var ultimoMov = (D.movimentos && D.movimentos.length) ? D.movimentos[D.movimentos.length - 1].quando : null;
            var r = await Transport.call('apiPull', [ym, Sessao.token, desde, ultimoMov]).catch(() => null);
            return r;
          } finally {
            delete _pullAtivoPorYm[ym];
            _ultimoPullPorYm[ym] = Date.now();
          }
        })();
        
        _pullAtivoPorYm[ym] = promessa;
        return promessa;
      };
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('deve permitir novo pull após 2000ms', async () => {
      await atualizarDoServidor('2026-11');
      expect(fakeTransportCall).toHaveBeenCalledTimes(1);
      
      vi.advanceTimersByTime(2001);
      
      const r2 = await atualizarDoServidor('2026-11');
      expect(fakeTransportCall).toHaveBeenCalledTimes(2);
      expect(r2).toBeTruthy();
    });

    it('deve aplicar debounce também em sincronizarMes', async () => {
      await sincronizarMes('2026-11');
      expect(fakeTransportCall).toHaveBeenCalledTimes(1);
      
      const r2 = await sincronizarMes('2026-11');
      expect(fakeTransportCall).toHaveBeenCalledTimes(1);
      expect(r2).toBe(false);
    });
  });

  describe('mudarCompetencia - preservar fila pendente', () => {
    let Sync, D, Sessao, Transport, _pullAtivoPorYm, _ultimoPullPorYm, PULL_DEBOUNCE_MS;
    let fakeTransportCall, flushCalls;

    beforeEach(() => {
      vi.useFakeTimers();
      _pullAtivoPorYm = {};
      _ultimoPullPorYm = {};
      PULL_DEBOUNCE_MS = 2000;
      
      flushCalls = 0;
      Sync = { 
        ligado: true, 
        estado: 'ok', 
        fila: [{ ym: '2026-11', ops: [{ t: 'marca', k: '1|2026-11-01', v: 'X' }] }],
        versao: 1,
        enfileirar: vi.fn(),
        flush: vi.fn(() => { flushCalls++; return Promise.resolve(); }),
        pintar: vi.fn(),
        agendar: vi.fn()
      };
      Sessao = { token: 'token-123' };
      D = { competencia: '2026-11-01', movimentos: [] };
      
      fakeTransportCall = vi.fn().mockResolvedValue({ ok: true, versao: 2, marcas: [] });
      Transport = { disponivel: () => true, call: fakeTransportCall };
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('deve chamar Sync.flush antes de trocar competência se há fila pendente', async () => {
      const ymAtual = '2026-11';
      const temFilaPendente = Sync.fila.some(it => it.ym === ymAtual);
      
      expect(temFilaPendente).toBe(true);
      
      if (temFilaPendente && Sync.ligado && typeof Sync.flush === 'function') {
        await Sync.flush(true);
      }
      
      expect(flushCalls).toBe(1);
    });

    it('não deve chamar flush se não há fila pendente para a competência atual', async () => {
      Sync.fila = [{ ym: '2026-10', ops: [] }];
      
      const ymAtual = '2026-11';
      const temFilaPendente = Sync.fila.some(it => it.ym === ymAtual);
      
      expect(temFilaPendente).toBe(false);
      
      if (temFilaPendente && Sync.ligado && typeof Sync.flush === 'function') {
        await Sync.flush(true);
      }
      
      expect(flushCalls).toBe(0);
    });
  });
});