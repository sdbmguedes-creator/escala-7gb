import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const regrasCode = fs.readFileSync(path.resolve(__dirname, '../../frontend/regras.js'), 'utf8');

function criarContextoRegras({
  mes = [],
  marks = {},
  vis = {},
  aco = [],
  fem = {},
  metaBM = {},
  metaMot = {},
  cotas = {},
  movimentos = [],
  acoOficiais = {},
  competencia = '2026-11-01'
} = {}) {
  const ORDEM_ESC = { ALFA: 0, BRAVO: 1, CHARLIE: 2, DELTA: 3 };
  const MAPA_X = { 'X-A': 'ALFA', 'X-B': 'BRAVO', 'X-C': 'CHARLIE', 'X-D': 'DELTA', 'X-ADM': 'ALFA' };
  const ANCORA_EQUIPE = Date.UTC(2026, 10, 1);

  const fmt = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  const D = {
    competencia,
    mes,
    fem,
    params: { metaBM, metaMot, cotas },
    movimentos,
    acoOficiais
  };

  const sandbox = {
    D,
    marks,
    vis,
    aco,
    ORDEM_ESC,
    MAPA_X,
    PJ_ANTES_ORD_DIAS: 1,
    _cacheContagemSB: null,
    _cacheMotoristasSB: null,
    fmt,
    diasDoMes: () => {
      const base = new Date(D.competencia + 'T12:00:00');
      const y = base.getFullYear();
      const m = base.getMonth();
      const ultimo = new Date(y, m + 1, 0).getDate();
      const out = [];
      for (let i = 1; i <= ultimo; i++) out.push(new Date(y, m, i));
      return out;
    },
    indiceEquipe: (date) => {
      const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
      const dias = Math.round((utc - ANCORA_EQUIPE) / 86400000);
      return (((1 + dias) % 4) + 4) % 4;
    },
    somarDiaISO: (dia, n) => {
      const d = new Date(String(dia).slice(0, 10) + 'T12:00:00');
      d.setDate(d.getDate() + Number(n || 0));
      return fmt(d);
    },
    intervaloISO: (a) => {
      const ini = String((a && a.ini) || '').slice(0, 10);
      let fim = a && a.fim ? String(a.fim).slice(0, 10) : ini;
      if (a && a.dias != null && a.ini && !a.fim) {
        const d = new Date(ini + 'T12:00:00');
        d.setDate(d.getDate() + (Number(a.dias) || 0) - 1);
        fim = fmt(d);
      }
      return { ini, fim };
    },
    temAfastamentoNoMes: (m) => !!(m && m.afast && m.afast.length),
    pessoasDaSecao: (sb) => D.mes.filter((m) => m.secao === sb && m.adm !== 'S'),
    pessoasAdm: (sb) => D.mes.filter((m) => m.secao === sb && m.adm === 'S'),
    getMarkExato: (grupo, id, dia) => marks[`${grupo}|${id}|${dia}`] || '',
    markMaeDoDia: (id, dia) => {
      const mm = D.mes.find((x) => x.id === id);
      if (!mm) return null;
      const op = marks[`${mm.secao}|${id}|${dia}`];
      if (op) return { grupo: mm.secao, cod: op };
      const adm = marks[`ADM:${mm.secao}|${id}|${dia}`];
      if (adm) return { grupo: `ADM:${mm.secao}`, cod: adm };
      return null;
    },
    marcaDoMilitarNoDia: (id, dia) => {
      for (const k of Object.keys(marks)) {
        const p = k.split('|');
        if (p[1] === id && p[2] === dia && marks[k]) return { grupo: p[0], cod: marks[k] };
      }
      return null;
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(regrasCode, ctx, { filename: 'regras.js' });
  return ctx;
}

describe('Regras e totalizadores operacionais (frontend/regras.js)', () => {
  const dia = new Date('2026-11-05T12:00:00');

  it('calcula MILITARES POR DIA (contagemSB) somando pesos operacional, ADM e visitantes sem conflito na SB mãe', () => {
    const ctx = criarContextoRegras({
      mes: [
        { id: 'P1', secao: '1ªSB', escala: 'ALFA', adm: '', motorista: 'M' },
        { id: 'P2', secao: '1ªSB', escala: 'BRAVO', adm: '', motorista: 'B' },
        { id: 'P3', secao: '1ªSB', escala: 'ALFA', adm: 'S', motorista: '' },
        { id: 'V1', secao: '2ªSB', escala: 'ALFA', adm: '', motorista: 'M' },
        { id: 'V2', secao: '3ªSB', escala: 'ALFA', adm: '', motorista: 'M' }
      ],
      vis: { '1ªSB': ['V1', 'V1', 'V2'] },
      marks: {
        '1ªSB|P1|2026-11-05': 'X',        // +1
        '1ªSB|P2|2026-11-05': 'PJ12',     // +0.5
        'ADM:1ªSB|P3|2026-11-05': 'S1',   // +0.5
        'host:1ªSB|V1|2026-11-05': 'PJ',  // +1 (visitante deduplicado, sem marca na 2ªSB)
        '2ªSB|V2|2026-11-05': '',
        '3ªSB|V2|2026-11-05': 'X',        // marca na SB mãe prevalece -> host:1ªSB ignorado
        'host:1ªSB|V2|2026-11-05': 'X'
      }
    });

    expect(ctx.contagemSB('1ªSB', dia)).toBe(3);
  });

  it('calcula MOTORISTAS (motoristasSB) considerando apenas motorista === "M"', () => {
    const ctx = criarContextoRegras({
      mes: [
        { id: 'P1', secao: '1ªSB', escala: 'ALFA', adm: '', motorista: 'M' },
        { id: 'P2', secao: '1ªSB', escala: 'BRAVO', adm: '', motorista: 'B' },
        { id: 'P3', secao: '1ªSB', escala: 'ALFA', adm: 'S', motorista: 'M' },
        { id: 'V1', secao: '2ªSB', escala: 'ALFA', adm: '', motorista: 'M' }
      ],
      vis: { '1ªSB': ['V1'] },
      marks: {
        '1ªSB|P1|2026-11-05': 'X',        // +1 (M)
        '1ªSB|P2|2026-11-05': 'X',        // ignora (B)
        'ADM:1ªSB|P3|2026-11-05': 'S1',   // +0.5 (M)
        'host:1ªSB|V1|2026-11-05': 'PJ12' // +0.5 (M)
      }
    });

    expect(ctx.motoristasSB('1ªSB', dia)).toBe(2);
  });

  it('calcula EFETIVO FEMININO (efetivoFemininoSB) com códigos de presença e sem contar afastamento (N/Nm)', () => {
    const ctx = criarContextoRegras({
      mes: [
        { id: 'F1', secao: '1ªSB', escala: 'ALFA', adm: '', motorista: '' },
        { id: 'F2', secao: '1ªSB', escala: 'BRAVO', adm: '', motorista: '' },
        { id: 'F3', secao: '1ªSB', escala: 'ALFA', adm: 'S', motorista: '' },
        { id: 'F4', secao: '2ªSB', escala: 'ALFA', adm: '', motorista: '' },
        { id: 'M1', secao: '1ªSB', escala: 'ALFA', adm: '', motorista: '' }
      ],
      fem: { F1: 1, F2: 1, F3: 1, F4: 1 },
      vis: { '1ªSB': ['F4', 'F4'] },
      marks: {
        '1ªSB|F1|2026-11-05': 'X',
        '1ªSB|F2|2026-11-05': 'N',        // afastamento não conta
        'ADM:1ªSB|F3|2026-11-05': 'SPJ',
        'host:1ªSB|F4|2026-11-05': 'PJ12',
        '1ªSB|M1|2026-11-05': 'X'         // masculino não conta
      }
    });

    expect(ctx.efetivoFemininoSB('1ªSB', dia)).toBe(3);
  });

  it('calcula NECESSIDADE DIÁRIA, SITUAÇÃO, SITUAÇÃO MOT. e o pacote completo calcularTotalizadoresDiaSB', () => {
    const ctx = criarContextoRegras({
      mes: [
        { id: 'P1', secao: '1ªSB', escala: 'ALFA', adm: '', motorista: 'M' },
        { id: 'P2', secao: '1ªSB', escala: 'BRAVO', adm: '', motorista: '' },
        { id: 'F1', secao: '1ªSB', escala: 'ALFA', adm: 'S', motorista: 'M' }
      ],
      fem: { F1: 1 },
      metaBM: { '1ªSB': 5, '2ªSB': 0 },
      metaMot: { '1ªSB': 1, '2ªSB': 0 },
      marks: {
        '1ªSB|P1|2026-11-05': 'X',
        '1ªSB|P2|2026-11-05': 'PJ',
        'ADM:1ªSB|F1|2026-11-05': 'S1'
      }
    });

    const tot1 = ctx.calcularTotalizadoresDiaSB('1ªSB', dia);
    expect(tot1.militaresPorDia).toBe(2.5);
    expect(tot1.necessidadeDiaria).toBe(5);
    expect(tot1.situacao).toEqual({ texto: 2.5, classe: 'falta' });
    expect(tot1.motoristas).toBe(1.5);
    expect(tot1.situacaoMot).toEqual({ texto: 'OK', classe: 'ok' });
    expect(tot1.efetivoFeminino).toBe(1);

    const tot2 = ctx.calcularTotalizadoresDiaSB('2ªSB', dia);
    expect(tot2).toEqual({
      militaresPorDia: '',
      necessidadeDiaria: '',
      situacao: { texto: '' },
      motoristas: '',
      situacaoMot: { texto: '' },
      efetivoFeminino: ''
    });
  });

  it('calcula cotas, ACO e saldosDevidos de forma consistente', () => {
    const ctx = criarContextoRegras({
      mes: [{ id: 'P1', secao: '1ªSB', escala: 'ALFA', adm: '', motorista: 'M', afast: [{ ini: '2026-11-04', fim: '2026-11-18' }] }],
      aco: ['P1'],
      cotas: { '1ªSB': 10, '2ªSB': 5 },
      movimentos: [
        { tipo: 'remessa', origem: 'POOL', destino: '1ªSB', qtd: 4 },
        { tipo: 'transferencia', origem: '2ªSB', destino: '1ªSB', qtd: 2 }
      ],
      acoOficiais: { '2026-11-05': { t1: 'Ten A', t2: 'Ten B' } },
      marks: { 'ACO|P1|2026-11-05': '12' }
    });

    expect(ctx.cotaAtualSB('1ªSB')).toBe(16);
    expect(ctx.cotaAtualSB('2ªSB')).toBe(3);
    expect(ctx.situacaoAco('2026-11-05')).toEqual({ texto: 'FALTA 1', classe: 'falta' });
    expect(ctx.saldosDevidos(ctx.D.mes[0])).toBe(2);
  });
});
