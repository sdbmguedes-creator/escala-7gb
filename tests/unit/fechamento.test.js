import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

function carregarFrontendEmVm({ protocol = 'https:', fetchImpl = null, confirmVal = true } = {}) {
  const appendedToBody = [];
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
      querySelector(sel) {
        if (sel && sel.startsWith('#')) {
          const targetId = sel.slice(1);
          return elementsById.get(targetId) || makeEl('div', targetId);
        }
        return makeEl('div');
      },
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

  const body = makeEl('body');
  body.appendChild = function (child) {
    appendedToBody.push(child);
    child.parentNode = body;
    if (child.id) elementsById.set(child.id, child);
    return child;
  };

  for (const id of [
    'main', 'nav', 'comp', 'mesSel', 'perfilGlobal', 'status',
    'btnSair', 'btnHistoricoComp', 'btnFecharComp', 'bannerFechada',
    'lblNomeUsuario', 'menu', 'toast'
  ]) {
    makeEl('div', id);
  }

  const store = {};
  const document = {
    hidden: false,
    documentElement: makeEl('html'),
    body,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    createElement: (tag) => makeEl(tag),
    getElementById: (id) => elementsById.get(id) || null,
    querySelector: () => makeEl('header'),
    querySelectorAll: () => []
  };

  const localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; }
  };

  const alerts = [];
  const context = {
    window: null,
    document,
    localStorage,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    navigator: { onLine: true },
    location: { protocol, reload: vi.fn() },
    fetch: fetchImpl || vi.fn().mockResolvedValue({ ok: true, text: async () => '{"ok":true}' }),
    alert: (m) => alerts.push(m),
    confirm: () => confirmVal,
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

  const html = fs.readFileSync(path.resolve('frontend/index_v14.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  vm.runInContext(scripts[0], context);
  vm.runInContext(fs.readFileSync(path.resolve('frontend/storage.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.resolve('frontend/regras.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.resolve('frontend/sync.js'), 'utf8'), context);
  // Carrega funções finais (sair, alternarFechamentoCompetencia, renderizarModalHistorico, etc.) sem rodar boot automático
  const tailSemBoot = scripts[1].replace(/\(async function boot\(\)\{[\s\S]*?\}\)\(\);\s*$/, '');
  vm.runInContext(tailSemBoot, context);
  vm.runInContext('this.Sync = Sync; this.Transport = Transport; this.Sessao = Sessao;', context);

  return { ctx: context, alerts, appendedToBody, elementsById };
}

describe('Trava de Competência Fechada e Auditoria no Frontend', () => {
  it('bloqueia edições na grade e comentários quando ehFechada() é true', () => {
    const { ctx, alerts } = carregarFrontendEmVm();
    ctx.perfilAtual = 'Admin';
    ctx.competenciaFechada = false;
    expect(ctx.ehFechada()).toBe(false);
    expect(ctx.podeEditarSB('1ªSB')).toBe(true);

    ctx.aplicarRemoto(ctx.estadoDoServidor({
      marcas: [],
      comments: [],
      elenco: [],
      acoOficiais: {},
      movimentos: [],
      meta: { status: 'ativa', fechada: true, fechadaPor: 'Cap Silva' }
    }), '2026-11');

    expect(ctx.ehFechada()).toBe(true);
    expect(ctx.podeEditarSB('1ªSB')).toBe(false);
    expect(ctx.podeEditarAco('any')).toBe(false);
    expect(ctx.podeEditarConfMilitar('any')).toBe(false);
    expect(ctx.podeComentarGrupo('1ªSB')).toBe(false);

    const ok = ctx.marcar('1ªSB', '798041-8', '2026-11-05', 'X');
    expect(ok).toBe(false);
    expect(alerts.some((a) => String(a).toLowerCase().includes('fechada'))).toBe(true);
  });

  it('Sync.flush trata HTTP 423 (fechada:true) descartando a fila do mês sem entrar em erro-fatal', async () => {
    const { ctx } = carregarFrontendEmVm();
    ctx.Sessao.token = 'tok-123';
    ctx.Sync.ligado = true;
    ctx.Sync.pullInicialConcluido = true;
    ctx.Sync.fila = [{ ym: '2026-11', ops: [{ t: 'marca', k: '1ªSB|1|5', v: 'X' }] }];
    ctx.Transport.call = vi.fn().mockResolvedValue({
      ok: false,
      fechada: true,
      erro: 'competência fechada (somente leitura)'
    });
    ctx.sincronizarMes = vi.fn().mockResolvedValue(false);

    await ctx.Sync.flush(true);

    expect(ctx.Sync.estado).toBe('ok');
    expect(ctx.Sync.fila.length).toBe(0);
    expect(ctx.ehFechada()).toBe(true);
  });

  it('renderizarModalHistorico exibe data/hora, usuário, militar/dia e valor anterior -> novo', () => {
    const { ctx, elementsById } = carregarFrontendEmVm();
    ctx.renderizarModalHistorico([
      {
        ts: '2026-11-21T01:00:00Z',
        nome: 'Cap Silva',
        perfil: 'Admin',
        acao: 'edicao',
        detalhes: JSON.stringify({
          competencia: '2026-11',
          grupo: '1ªSB',
          militar_id: '798041-8',
          dia: 5,
          de: 'X',
          para: 'F'
        })
      },
      {
        ts: '2026-11-21T01:05:00Z',
        nome: 'Cap Silva',
        perfil: 'Admin',
        acao: 'fechar_competencia',
        detalhes: JSON.stringify({ competencia: '2026-11', fechada: true })
      }
    ], '2026-11');

    const overlay = elementsById.get('histOverlay');
    expect(overlay).toBeTruthy();
    const html = overlay.children[0].children[1].innerHTML;
    expect(html).toContain('Cap Silva');
    expect(html).toContain('ALCY');
    expect(html).toContain('Dia 05');
    expect(html).toContain('X → F');
    expect(html).toContain('Competência fechada');
  });
});
