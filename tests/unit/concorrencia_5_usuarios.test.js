import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const HTML_SRC = fs.readFileSync(path.resolve(__dirname, '../../frontend/index_v14.html'), 'utf8');
const STORAGE_JS = fs.readFileSync(path.resolve(__dirname, '../../frontend/storage.js'), 'utf8');
const REGRAS_JS = fs.readFileSync(path.resolve(__dirname, '../../frontend/regras.js'), 'utf8');
const SYNC_JS = fs.readFileSync(path.resolve(__dirname, '../../frontend/sync.js'), 'utf8');
const SCRIPTS_HTML = [...HTML_SRC.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const TAIL_SEM_BOOT = SCRIPTS_HTML[1].replace(/\(async function boot\(\)\{[\s\S]*?\}\)\(\);\s*$/, '');

const SBS_VALIDAS = ['1ªSB', '2ªSB', '3ªSB', '4ªSB'];

function normSecao(val) {
  return String(val || '').trim().toUpperCase().replace(/\s+/g, '');
}

function podeGravar(perfil, grupo, militarId, elencoMap) {
  if (perfil === 'Admin' || perfil === 'Mestre') return true;
  const g = String(grupo || '').trim();
  const pNorm = normSecao(perfil);
  if (g.toUpperCase() === 'ACO') {
    const m2 = elencoMap[militarId];
    return !!(m2 && normSecao(m2.secao) === pNorm);
  }
  let alvo = g;
  if (g.toUpperCase().startsWith('ADM:')) alvo = g.slice(4);
  else if (g.toLowerCase().startsWith('host:')) alvo = g.slice(5);
  return normSecao(alvo) === pNorm;
}

function criarServidorSimulado() {
  const tokens = new Map();
  const competencias = new Map();

  function getComp(ym) {
    const key = String(ym || '2026-11').slice(0, 7);
    if (!competencias.has(key)) {
      competencias.set(key, {
        versao: 1,
        status: 'ativa',
        marcas: {}, // chave: grupo|militar_id|diaNum -> codigo
        comments: {},
        vis: {},
        visLinhas: {},
        aco: [],
        elenco: {},
        fechada: false,
        fechadaPor: '',
        fechadaEm: ''
      });
    }
    return competencias.get(key);
  }

  function registrarSessao(token, perfil, nome) {
    tokens.set(token, { perfil, nome });
  }

  function snapshot(ym) {
    const c = getComp(ym);
    const marcasIso = {};
    for (const [k, cod] of Object.entries(c.marcas)) {
      const [g, i, d] = k.split('|');
      const diaIso = `${ym}-${String(parseInt(d, 10)).padStart(2, '0')}`;
      marcasIso[`${g}|${i}|${diaIso}`] = cod;
    }
    return {
      versao: c.versao,
      marks: marcasIso,
      vis: JSON.parse(JSON.stringify(c.vis)),
      visLinhas: JSON.parse(JSON.stringify(c.visLinhas)),
      fechada: c.fechada
    };
  }

  const call = vi.fn(async (nomeRota, args = []) => {
    if (nomeRota === 'apiBootstrap') {
      const token = args[1];
      return tokens.has(token) ? { ok: true } : { ok: false, erro: 'token inválido' };
    }

    if (nomeRota === 'apiLogout') {
      const token = args[0];
      tokens.delete(token);
      return { ok: true };
    }

    if (nomeRota === 'apiPull') {
      const [ym, token, desdeVersao] = args;
      if (!tokens.has(token)) return { ok: false, erro: 'token inválido' };
      const c = getComp(ym);
      if (desdeVersao !== null && desdeVersao !== undefined && desdeVersao !== '' && Number(desdeVersao) === c.versao) {
        return { ok: true, semMudanca: true, versao: c.versao };
      }
      return {
        ok: true,
        versao: c.versao,
        marcas: Object.entries(c.marcas).map(([k, cod]) => {
          const [g, i, d] = k.split('|');
          return { g, i, d, c: cod };
        }),
        comments: Object.entries(c.comments).map(([k, v]) => ({ k, v })),
        elenco: Object.values(c.elenco),
        acoOficiais: {},
        movimentos: [],
        meta: {
          competencia: ym,
          versao: c.versao,
          status: c.status,
          vis: JSON.parse(JSON.stringify(c.vis)),
          visLinhas: JSON.parse(JSON.stringify(c.visLinhas)),
          aco: c.aco.slice(),
          fechada: c.fechada,
          fechadaPor: c.fechadaPor,
          fechadaEm: c.fechadaEm
        }
      };
    }

    if (nomeRota === 'apiPush') {
      const [ym, ops = [], token] = args;
      const u = tokens.get(token);
      if (!u) return { ok: false, erro: 'token inválido' };
      const c = getComp(ym);
      const soReabre = u.perfil === 'Admin' && ops.length > 0 && ops.every((o) => o && o.t === 'fechamento' && o.fechada === false);
      if (c.fechada && !soReabre) {
        return { ok: false, fechada: true, erro: 'competência fechada (somente leitura)' };
      }

      const recusadas = [];
      let aplicadas = 0;
      let metaAlterada = false;

      for (const op of ops) {
        if (!op || !op.t) {
          recusadas.push({ motivo: 'op sem tipo' });
          continue;
        }
        if (op.t === 'marca') {
          const partes = String(op.k || '').split('|');
          const rawDia = partes[2] ? String(partes[2]).split('-').pop() : '';
          const diaInt = parseInt(rawDia, 10);
          if (partes.length < 3 || Number.isNaN(diaInt)) {
            recusadas.push({ t: 'marca', motivo: 'chave inválida' });
            continue;
          }
          if (!podeGravar(u.perfil, partes[0], partes[1], c.elenco)) {
            recusadas.push({ t: 'marca', motivo: `perfil ${u.perfil} sem permissão` });
            continue;
          }
          const kk = `${partes[0]}|${partes[1]}|${diaInt}`;
          if (op.v) c.marcas[kk] = op.v;
          else delete c.marcas[kk];
          aplicadas++;
        } else if (op.t === 'vis') {
          if (!SBS_VALIDAS.includes(op.sb)) {
            recusadas.push({ t: 'vis', motivo: 'sb inválida' });
            continue;
          }
          if (u.perfil !== 'Admin' && u.perfil !== 'Mestre' && op.sb !== u.perfil) {
            recusadas.push({ t: 'vis', motivo: 'sem permissão para visitantes' });
            continue;
          }
          c.vis[op.sb] = (op.lista || []).filter(Boolean).map(String);
          if (op.linhas != null) c.visLinhas[op.sb] = Number(op.linhas);
          metaAlterada = true;
          aplicadas++;
        } else if (op.t === 'comment') {
          if (op.v) c.comments[op.k] = op.v;
          else delete c.comments[op.k];
          aplicadas++;
        } else if (op.t === 'fechamento') {
          if (u.perfil !== 'Admin') {
            recusadas.push({ t: 'fechamento', motivo: 'exige Admin' });
            continue;
          }
          c.fechada = !!op.fechada;
          c.fechadaPor = u.nome;
          c.fechadaEm = new Date().toISOString();
          metaAlterada = true;
          aplicadas++;
        }
      }

      if (aplicadas > 0 || metaAlterada) {
        c.versao += 1;
      }
      return { ok: true, versao: c.versao, aplicadas, recusadas };
    }

    return { ok: true };
  });

  return { registrarSessao, getComp, snapshot, call };
}

function criarClienteFrontend(servidor, { label, perfil, nome, token, storeInicial = {} }) {
  const elementsById = new Map();
  function makeEl(tag, id) {
    const el = {
      tagName: String(tag || 'DIV').toUpperCase(),
      id: id || '',
      style: { cssText: '', display: '', setProperty: vi.fn(), removeProperty: vi.fn() },
      value: '',
      textContent: '',
      innerHTML: '',
      disabled: false,
      title: '',
      dataset: {},
      options: [],
      classList: { contains: () => false, add: () => {}, remove: () => {} },
      children: [],
      parentNode: null,
      appendChild(child) {
        this.children.push(child);
        child.parentNode = this;
        if (child.id) elementsById.set(child.id, child);
        return child;
      },
      remove() {
        this.parentNode = null;
        if (this.id) elementsById.delete(this.id);
      },
      querySelector() { return makeEl('div'); },
      querySelectorAll() { return []; },
      addEventListener() {},
      removeEventListener() {},
      setAttribute() {},
      getAttribute() { return null; },
      getBoundingClientRect() { return { height: 50, width: 100, top: 0, left: 0 }; },
      focus() {},
      closest() { return null; }
    };
    if (id) elementsById.set(id, el);
    return el;
  }

  for (const id of [
    'main', 'nav', 'comp', 'mesSel', 'perfilGlobal', 'status',
    'btnSair', 'btnHistoricoComp', 'btnFecharComp', 'bannerFechada',
    'lblNomeUsuario', 'menu', 'toast', 'syncStatus'
  ]) {
    makeEl('div', id);
  }

  const store = { ...storeInicial };
  const localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] || null
  };

  const document = {
    hidden: false,
    documentElement: makeEl('html'),
    body: makeEl('body'),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    createElement: (t) => makeEl(t),
    getElementById: (id) => elementsById.get(id) || null,
    querySelector: () => makeEl('header'),
    querySelectorAll: () => []
  };

  const alerts = [];
  const context = {
    window: null,
    document,
    localStorage,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    navigator: { onLine: true },
    location: { protocol: 'https:', search: '', reload: vi.fn() },
    fetch: vi.fn(),
    alert: (msg) => alerts.push(msg),
    confirm: () => true,
    ResizeObserver: undefined,
    AbortController: globalThis.AbortController,
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
    console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    Date, Math, JSON, Object, Array, String, Number, Boolean, Map, Set, RegExp, Error, Promise
  };
  context.window = context;
  vm.createContext(context);

  vm.runInContext(SCRIPTS_HTML[0], context);
  vm.runInContext(STORAGE_JS, context);
  vm.runInContext(REGRAS_JS, context);
  vm.runInContext(SYNC_JS, context);
  vm.runInContext(TAIL_SEM_BOOT, context);
  vm.runInContext(
    'this.Sync = Sync; this.Transport = Transport; this.Sessao = Sessao; this.D = D;',
    context
  );

  // Conecta ao servidor simulado e autentica o perfil
  servidor.registrarSessao(token, perfil, nome);
  context.Transport.call = servidor.call;
  context.Sessao.guardar({ token, perfil, nome });

  // Limpa marcas/visitantes embutidos para partir do estado compartilhado do servidor
  vm.runInContext(`
    marks = {};
    comments = {};
    vis = { "1ªSB": [], "2ªSB": [], "3ªSB": [], "4ªSB": [] };
    aco = [];
    D.visLinhas = { "1ªSB": 12, "2ªSB": 12, "3ªSB": 12, "4ªSB": 12 };
    D.competencia = "2026-11-01";
    perfilAtual = ${JSON.stringify(perfil)};
    desenhar = function(){};
    Sync.iniciar();
    carregarEstado();
  `, context);

  return {
    label,
    perfil,
    nome,
    token,
    store,
    alerts,
    ctx: context,
    run: (code) => vm.runInContext(code, context),
    async bootSync(ym = '2026-11') {
      const ok = await context.sincronizarMes(ym);
      context.Sync.pullInicialConcluido = true;
      if (ok) context.carregarEstado();
      return ok;
    },
    marcarCelula(grupo, id, dia, cod) {
      return context.marcar(grupo, id, dia, cod);
    },
    definirVisitantes(sb, listaIds) {
      vm.runInContext(`
        vis[${JSON.stringify(sb)}] = ${JSON.stringify(listaIds)};
        salvarLocal();
      `, context);
    },
    async push() {
      return context.Sync.flush(true);
    },
    async pull(ym = '2026-11') {
      return context.atualizarDoServidor(ym, true);
    },
    async pullForcado(ym = '2026-11') {
      return context.sincronizarMes(ym);
    },
    estadoLocal() {
      const marks = JSON.parse(vm.runInContext('JSON.stringify(marks)', context));
      const vis = JSON.parse(vm.runInContext('JSON.stringify(vis)', context));
      const versao = context.Sync.versaoPorYm['2026-11'];
      return { marks, vis, versao };
    }
  };
}

describe('Concorrência real com 5 usuários simultâneos (Admin + 4 SBs)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function instanciarCincoClientes(servidor) {
    return {
      admin: criarClienteFrontend(servidor, {
        label: 'Admin', perfil: 'Admin', nome: 'Cap Admin', token: 'tok-admin'
      }),
      sb1: criarClienteFrontend(servidor, {
        label: '1ª SB Carpina', perfil: '1ªSB', nome: 'Sgt Carpina', token: 'tok-1sb'
      }),
      sb2: criarClienteFrontend(servidor, {
        label: '2ª SB Goiana', perfil: '2ªSB', nome: 'Sgt Goiana', token: 'tok-2sb'
      }),
      sb3: criarClienteFrontend(servidor, {
        label: '3ª SB Macaparana', perfil: '3ªSB', nome: 'Sgt Macaparana', token: 'tok-3sb'
      }),
      sb4: criarClienteFrontend(servidor, {
        label: '4ª SB Surubim', perfil: '4ªSB', nome: 'Sgt Surubim', token: 'tok-4sb'
      })
    };
  }

  it('Cenário 1: Rajada simultânea nas 4 SBs + Admin com push/pull intercalados converge sem perda', async () => {
    const srv = criarServidorSimulado();
    const { admin, sb1, sb2, sb3, sb4 } = instanciarCincoClientes(srv);
    const todos = [admin, sb1, sb2, sb3, sb4];

    await Promise.all(todos.map((c) => c.bootSync('2026-11')));

    // Avança além do PULL_DEBOUNCE_MS inicial para permitir pull intercalado antes do timer de 1,5s do flush
    vi.advanceTimersByTime(2500);

    // Todos os 5 fazem marcações distintas na competência 2026-11
    expect(sb1.marcarCelula('1ªSB', '707305-4', '2026-11-05', 'X')).toBe(true);
    expect(sb2.marcarCelula('2ªSB', '707058-6', '2026-11-06', 'X')).toBe(true);
    expect(sb3.marcarCelula('3ªSB', '707155-8', '2026-11-07', 'PJ')).toBe(true);
    expect(sb4.marcarCelula('4ªSB', '704203-5', '2026-11-08', 'X')).toBe(true);
    expect(admin.marcarCelula('1ªSB', '704178-0', '2026-11-10', 'PJ12')).toBe(true);

    // Todos possuem fila pendente antes do envio intercalado
    todos.forEach((c) => expect(c.ctx.Sync.fila.length).toBe(1));

    // Onda 1: Admin e 2ª SB Goiana fazem push enquanto 1ª SB, 3ª SB e 4ª SB ainda têm fila pendente
    await admin.push();
    await sb2.push();

    // 3ª SB Macaparana recebe um pull (sincronizarMes) enquanto ainda tem marcação local na fila
    await sb3.pullForcado('2026-11');
    expect(sb3.ctx.Sync.fila.length).toBe(1);
    expect(sb3.estadoLocal().marks['3ªSB|707155-8|2026-11-07']).toBe('PJ');
    expect(sb3.estadoLocal().marks['1ªSB|704178-0|2026-11-10']).toBe('PJ12');
    expect(sb3.estadoLocal().marks['2ªSB|707058-6|2026-11-06']).toBe('X');

    // Onda 2: 4ª SB e 1ª SB fazem push; 4ª SB também lança segunda marca + visitante na própria SB
    await sb4.push();
    await sb1.push();
    sb4.definirVisitantes('4ªSB', ['707305-4']);
    expect(sb4.marcarCelula('host:4ªSB', '707305-4', '2026-11-11', 'PJ')).toBe(true);

    // Onda 3: 3ª SB e 4ª SB enviam suas filas restantes
    await sb3.push();
    await sb4.push();

    // Avança além do debounce de pull (PULL_DEBOUNCE_MS = 2000) e sincroniza os 5 clientes
    vi.advanceTimersByTime(2500);
    await Promise.all(todos.map((c) => c.pull('2026-11')));

    const esperadoServidor = srv.snapshot('2026-11');
    expect(Object.keys(esperadoServidor.marks).length).toBe(6);
    expect(esperadoServidor.vis['4ªSB']).toEqual(['707305-4']);

    for (const cli of todos) {
      const st = cli.estadoLocal();
      expect(st.versao).toBe(esperadoServidor.versao);
      expect(st.marks).toEqual(esperadoServidor.marks);
      expect(st.vis['4ªSB']).toEqual(['707305-4']);
      expect(cli.ctx.Sync.fila.length).toBe(0);
    }
  });

  it('Cenário 2: Conflito no mesmo militar em datas diferentes + visitante concorrente + fechamento/reabertura Admin', async () => {
    const srv = criarServidorSimulado();
    const { admin, sb1, sb2, sb3, sb4 } = instanciarCincoClientes(srv);
    const todos = [admin, sb1, sb2, sb3, sb4];

    await Promise.all(todos.map((c) => c.bootSync('2026-11')));

    // Dois escalantes editam o MESMO militar (707305-4 da 1ªSB) em datas diferentes
    expect(sb1.marcarCelula('1ªSB', '707305-4', '2026-11-05', 'X')).toBe(true);
    expect(admin.marcarCelula('1ªSB', '707305-4', '2026-11-09', 'PJ')).toBe(true);

    // Terceiro escalante (2ª SB Goiana) inclui visitante de outra SB (707155-8 da 3ªSB) e marca PJ
    sb2.definirVisitantes('2ªSB', ['707155-8']);
    expect(sb2.marcarCelula('host:2ªSB', '707155-8', '2026-11-12', 'PJ')).toBe(true);

    // Envios concorrentes
    await Promise.all([sb1.push(), admin.push(), sb2.push()]);

    // Admin fecha a competência e consulta estado
    const rFechar = await srv.call('apiPush', ['2026-11', [{ t: 'fechamento', fechada: true }], admin.token]);
    expect(rFechar.ok).toBe(true);

    vi.advanceTimersByTime(2500);
    await sb3.pull('2026-11');
    expect(sb3.ctx.ehFechada()).toBe(true);
    expect(sb3.marcarCelula('3ªSB', '707155-8', '2026-11-14', 'X')).toBe(false);

    // Admin reabre a competência para operação normal
    const rReabrir = await srv.call('apiPush', ['2026-11', [{ t: 'fechamento', fechada: false }], admin.token]);
    expect(rReabrir.ok).toBe(true);

    // Sincronização cruzada entre os 5 clientes
    vi.advanceTimersByTime(2500);
    await Promise.all(todos.map((c) => c.pull('2026-11')));

    const esperado = srv.snapshot('2026-11');
    expect(esperado.fechada).toBe(false);
    expect(esperado.marks).toEqual({
      '1ªSB|707305-4|2026-11-05': 'X',
      '1ªSB|707305-4|2026-11-09': 'PJ',
      'host:2ªSB|707155-8|2026-11-12': 'PJ'
    });
    expect(esperado.vis['2ªSB']).toEqual(['707155-8']);

    for (const cli of todos) {
      const st = cli.estadoLocal();
      expect(cli.ctx.ehFechada()).toBe(false);
      expect(st.versao).toBe(esperado.versao);
      expect(st.marks).toEqual(esperado.marks);
      expect(st.vis['2ªSB']).toEqual(['707155-8']);
    }
  });

  it('Cenário 3: Ciclo Sair -> relogar sob concorrência preserva marcas pré-logoff e recebe deltas da ausência', async () => {
    const srv = criarServidorSimulado();
    const { admin, sb1, sb2, sb3, sb4 } = instanciarCincoClientes(srv);

    await Promise.all([admin, sb1, sb2, sb3, sb4].map((c) => c.bootSync('2026-11')));

    // 1ª SB Carpina marca duas células e NÃO deu flush manual ainda (está no timer de 1,5s)
    expect(sb1.marcarCelula('1ªSB', '707305-4', '2026-11-04', 'X')).toBe(true);
    expect(sb1.marcarCelula('1ªSB', '704178-0', '2026-11-15', 'F')).toBe(true);
    expect(sb1.ctx.Sync.fila.length).toBe(1);

    // Executa sair() real (drena fila -> apiPush -> apiLogout -> Sessao.limpar -> reload)
    sb1.ctx.sair();
    await vi.waitFor(() => expect(sb1.ctx.location.reload).toHaveBeenCalled());
    expect(sb1.ctx.Sessao.token).toBeNull();
    expect(sb1.ctx.Sync.fila.length).toBe(0);

    // Durante a ausência de 1ª SB Carpina, outros 2 usuários (2ª SB Goiana e 3ª SB Macaparana) enviam deltas
    expect(sb2.marcarCelula('2ªSB', '707058-6', '2026-11-18', 'PJ')).toBe(true);
    expect(sb3.marcarCelula('3ªSB', '707155-8', '2026-11-20', 'X')).toBe(true);
    await sb2.push();
    await sb3.push();

    // 1ª SB Carpina reloga em nova instância usando o mesmo localStorage do navegador
    const sb1Relogado = criarClienteFrontend(srv, {
      label: '1ª SB Carpina',
      perfil: '1ªSB',
      nome: 'Sgt Carpina',
      token: 'tok-1sb-relogado',
      storeInicial: sb1.store
    });
    await sb1Relogado.bootSync('2026-11');

    const stRelogado = sb1Relogado.estadoLocal();
    expect(stRelogado.marks).toEqual({
      '1ªSB|707305-4|2026-11-04': 'X',
      '1ªSB|704178-0|2026-11-15': 'F',
      '2ªSB|707058-6|2026-11-18': 'PJ',
      '3ªSB|707155-8|2026-11-20': 'X'
    });
    expect(stRelogado.versao).toBe(srv.snapshot('2026-11').versao);
    expect(sb1Relogado.run("marksIndex.get('707305-4|2026-11-04').length")).toBe(1);
    expect(sb1Relogado.run("marksIndex.get('704178-0|2026-11-15').length")).toBe(1);

    // Demais usuários sincronizam e convergem para o mesmo estado
    vi.advanceTimersByTime(2500);
    await Promise.all([admin, sb2, sb3, sb4].map((c) => c.pull('2026-11')));
    for (const cli of [admin, sb2, sb3, sb4, sb1Relogado]) {
      expect(cli.estadoLocal().marks).toEqual(stRelogado.marks);
      expect(cli.estadoLocal().versao).toBe(stRelogado.versao);
    }
  });
});
