import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

function criarDomMinimo({ protocol = 'https:', savedSession = null } = {}) {
  const appendedToBody = [];
  const elementsById = new Map();

  function makeEl(tag, id) {
    const listeners = {};
    const el = {
      tagName: String(tag || 'DIV').toUpperCase(),
      id: id || '',
      style: { cssText: '', setProperty: vi.fn(), removeProperty: vi.fn() },
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
      addEventListener(ev, fn) { listeners[ev] = fn; },
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

  for (const id of ['main', 'nav', 'comp', 'mesSel', 'perfilGlobal', 'status', 'btnSair', 'lblNomeUsuario', 'menu', 'toast']) {
    makeEl('div', id);
  }

  const store = {};
  if (savedSession) {
    store['escala7gb-sessao'] = JSON.stringify(savedSession);
  }

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

  const sandbox = {
    window: null,
    document,
    localStorage,
    location: { protocol, search: '', reload: vi.fn() },
    navigator: { serviceWorker: null },
    fetch: vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{"ok":true}', json: async () => ({ ok: true }) }),
    alert: vi.fn(),
    confirm: vi.fn(() => true),
    scrollTo: vi.fn(),
    scroll: vi.fn(),
    scrollBy: vi.fn(),
    scrollX: 0,
    scrollY: 0,
    getComputedStyle: vi.fn(() => ({ position: 'static', top: '0px', getPropertyValue: () => '' })),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    AbortController: globalThis.AbortController,
    ResizeObserver: undefined,
    URL: { createObjectURL: vi.fn(() => 'blob:mock') }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  return { sandbox, appendedToBody, elementsById };
}

function extrairBlocosScript(html) {
  const regex = /<script(?:\s+src="([^"]+)")?\s*>([\s\S]*?)<\/script>/gi;
  const blocos = [];
  let m;
  while ((m = regex.exec(html)) !== null) {
    blocos.push({ src: m[1] || null, code: m[2] || '' });
  }
  return blocos;
}

describe('Boot do frontend (index_v14.html + sync.js)', () => {
  const htmlPath = path.resolve(__dirname, '../../frontend/index_v14.html');
  const syncPath = path.resolve(__dirname, '../../frontend/sync.js');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const syncCode = fs.readFileSync(syncPath, 'utf8');
  const blocos = extrairBlocosScript(html);

  it('carrega index_v14.html + sync.js em HTTP sem erros e exibe o modal de login (#telaPin)', () => {
    const { sandbox, appendedToBody, elementsById } = criarDomMinimo({ protocol: 'https:' });
    const ctx = vm.createContext(sandbox);

    for (const bloco of blocos) {
      const codigo = bloco.src === 'sync.js' ? syncCode : bloco.code;
      const filename = bloco.src || 'index_v14.html';
      vm.runInContext(codigo, ctx, { filename });
    }

    expect(typeof ctx.Transport).toBe('object');
    expect(typeof ctx.Sessao).toBe('object');
    expect(vm.runInContext('typeof Sync', ctx)).toBe('object');
    expect(typeof ctx.pedirPin).toBe('function');
    expect(typeof ctx.iniciarApp).toBe('function');

    const modalPin = elementsById.get('telaPin') || appendedToBody.find((el) => el.id === 'telaPin');
    expect(modalPin).toBeTruthy();
    expect(modalPin.innerHTML).toContain('pinInput');
  });

  it('inicializa em modo offline (file://) sem erros de escopo e popula comp/mesSel', () => {
    const { sandbox, elementsById } = criarDomMinimo({ protocol: 'file:' });
    const ctx = vm.createContext(sandbox);

    for (const bloco of blocos) {
      const codigo = bloco.src === 'sync.js' ? syncCode : bloco.code;
      const filename = bloco.src || 'index_v14.html';
      vm.runInContext(codigo, ctx, { filename });
    }

    expect(elementsById.get('telaPin')).toBeUndefined();
    expect(elementsById.get('mesSel').value).toMatch(/^\d{4}-\d{2}$/);
    expect(elementsById.get('comp').textContent).toContain('de');
  });
});
