import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

function carregarFrontendEmVm() {
  const elementsById = new Map();
  function makeEl(tag, id) {
    const el = {
      tagName: String(tag || 'DIV').toUpperCase(), id: id || '',
      style: { cssText: '', display: '', setProperty: vi.fn(), removeProperty: vi.fn() },
      value: '', textContent: '', innerHTML: '', disabled: false, title: '', dataset: {}, options: [],
      classList: { contains: () => false, add: () => {}, remove: () => {} },
      children: [], parentNode: null,
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      remove() {}, querySelector() { return makeEl('div'); }, querySelectorAll() { return []; },
      addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
      getBoundingClientRect() { return { height: 50, width: 100, top: 0, left: 0 }; }, focus() {}, closest() { return null; }
    };
    if (id) elementsById.set(id, el);
    return el;
  }
  ['main', 'status', 'btnSair', 'syncStatus'].forEach((id) => makeEl('div', id));
  const store = {};
  const document = {
    hidden: false, documentElement: makeEl('html'), body: makeEl('body'),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    createElement: (t) => makeEl(t), getElementById: (id) => elementsById.get(id) || null,
    querySelector: () => makeEl('header'), querySelectorAll: () => []
  };
  const localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; }
  };
  const context = {
    window: null, document, localStorage,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    navigator: { onLine: true }, location: { protocol: 'https:', reload: vi.fn() },
    fetch: vi.fn(), alert: vi.fn(), confirm: () => true,
    AbortController: globalThis.AbortController, setTimeout, clearTimeout,
    setInterval: () => 1, clearInterval: () => {},
    console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    Date, Math, JSON, Object, Array, String, Number, Boolean, Map, Set, RegExp, Error, Promise
  };
  context.window = context;
  vm.createContext(context);
  const html = fs.readFileSync(path.resolve('frontend/index_v14.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  vm.runInContext(scripts[0], context);
  for (const f of ['storage.js', 'regras.js', 'sync.js']) {
    vm.runInContext(fs.readFileSync(path.resolve('frontend', f), 'utf8'), context);
  }
  const tailSemBoot = scripts[1].replace(/\(async function boot\(\)\{[\s\S]*?\}\)\(\);\s*$/, '');
  vm.runInContext(tailSemBoot, context);
  vm.runInContext('this.Sync = Sync; this.Transport = Transport; this.Sessao = Sessao;', context);
  return { ctx: context, run: (code) => vm.runInContext(code, context) };
}

// Servidor falso que replica o banco: guarda só o NÚMERO do dia (como api/app.py)
// e o devolve assim no pull.
function criarServidorFalso() {
  const db = { marcas: {}, vis: {} };
  return {
    db,
    call: vi.fn(async (nome, args) => {
      if (nome === 'apiPush') {
        for (const op of args[1]) {
          if (op.t === 'marca') {
            const [g, i, dia] = op.k.split('|');
            const dn = String(parseInt(dia.split('-').pop(), 10));
            const kk = `${g}|${i}|${dn}`;
            if (op.v) db.marcas[kk] = op.v; else delete db.marcas[kk];
          } else if (op.t === 'vis') {
            db.vis[op.sb] = op.lista;
          }
        }
        return { ok: true, versao: 2 };
      }
      if (nome === 'apiPull') {
        return {
          ok: true, versao: 2, comments: [], elenco: [], acoOficiais: {}, movimentos: [],
          marcas: Object.entries(db.marcas).map(([k, c]) => {
            const [g, i, d] = k.split('|');
            return { g, i, d, c };
          }),
          meta: { competencia: '2026-11', status: 'ativa', vis: db.vis, visLinhas: {} }
        };
      }
      return { ok: true };
    })
  };
}

describe('Persistência de marcas: marcar + visitante -> sair -> relogar', () => {
  it('estadoDoServidor converte dia numérico do banco para a chave ISO local', () => {
    const { ctx } = carregarFrontendEmVm();
    const e = ctx.estadoDoServidor({
      marcas: [{ g: '1ªSB', i: '1', d: '5', c: 'X' }, { g: '1ªSB', i: '2', d: 7, c: 'F' },
        { g: '1ªSB', i: '3', d: '2026-11-09', c: 'N' }],
      meta: { competencia: '2026-11' }
    });
    expect(e.marks).toEqual({
      '1ªSB|1|2026-11-05': 'X', '1ªSB|2|2026-11-07': 'F', '1ªSB|3|2026-11-09': 'N'
    });
  });

  it('marca e visitante enviados antes do logoff voltam iguais após login + pull', async () => {
    const { ctx, run } = carregarFrontendEmVm();
    const srv = criarServidorFalso();
    ctx.Transport.call = srv.call;
    ctx.Sessao.token = 'tok';
    ctx.Sync.ligado = true;
    ctx.Sync.pullInicialConcluido = true;

    run("marks['1ªSB|1|2026-11-05'] = 'X'; vis['1ªSB'] = ['99'];");
    ctx.Sync.fila = [{ ym: '2026-11', ops: [
      { t: 'marca', k: '1ªSB|1|2026-11-05', v: 'X', ts: 1 },
      { t: 'vis', sb: '1ªSB', lista: ['99'], ts: 1 }
    ] }];

    // Sair(): drena a fila ANTES do logout
    await ctx.Sync.flush(true);
    expect(ctx.Sync.fila.length).toBe(0);
    expect(Object.keys(srv.db.marcas).length).toBe(1);

    // relogin: estado limpo + pull aplicado
    run("marks = {}; vis = {};");
    const r = await srv.call('apiPull', ['2026-11']);
    ctx.aplicarRemoto(ctx.estadoDoServidor(r), '2026-11');

    expect(run("marks['1ªSB|1|2026-11-05']")).toBe('X');
    expect(run("JSON.stringify(vis['1ªSB'])")).toBe('[\"99\"]');
    expect(run("marksIndex.get('1|2026-11-05').length")).toBe(1);
  });

  it('sair() envia a fila pendente antes de chamar apiLogout', async () => {
    const { ctx } = carregarFrontendEmVm();
    const ordem = [];
    ctx.Sessao.token = 'tok';
    ctx.Sync.ligado = true;
    ctx.Sync.pullInicialConcluido = true;
    ctx.Sync.fila = [{ ym: '2026-11', ops: [{ t: 'marca', k: '1ªSB|1|2026-11-05', v: 'X', ts: 1 }] }];
    ctx.Transport.call = vi.fn(async (nome) => { ordem.push(nome); return { ok: true, versao: 2 }; });

    ctx.sair();
    await vi.waitFor(() => expect(ctx.location.reload).toHaveBeenCalled());

    expect(ordem).toEqual(['apiPush', 'apiLogout']);
  });
});
