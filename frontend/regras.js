/* eslint-disable no-unused-vars */
/* global D, marks, vis, aco, ORDEM_ESC, MAPA_X, PJ_ANTES_ORD_DIAS,
   fmt, diasDoMes, indiceEquipe, somarDiaISO, intervaloISO,
   temAfastamentoNoMes, pessoasDaSecao, pessoasAdm, getMarkExato,
   markMaeDoDia, marcaDoMilitarNoDia,
   _cacheContagemSB, _cacheMotoristasSB */
/* Regras de Cálculo e Totalizadores Diários (extraído de frontend/index_v14.html) */

function cotasMovimentoSB(sb){
  let n = 0;
  (D.movimentos||[]).forEach(function(mv){
    const q = Number(mv.qtd)||0;
    if (mv.tipo === "remessa"){
      if (mv.destino === sb) n += q;
    } else if (mv.tipo === "transferencia"){
      if (mv.origem === sb) n -= q;
      if (mv.destino === sb) n += q;
    }
  });
  return n;
}
function cotaAtualSB(sb){
  const base = Number(((D.params||{}).cotas||{})[sb]||0);
  return base + cotasMovimentoSB(sb);
}

function acoNecessario(dISO){
  const o = D.acoOficiais[dISO] || {};
  let n = 0;
  if (o.t1) n += 1;
  if (o.t2) n += 1;
  return n;
}
function acoLancado(dISO){
  let n = 0;
  (aco||[]).forEach(id=>{
    if (!id) return;
    const v = marks["ACO|"+id+"|"+dISO];
    if (v==="12") n += 1;
    else if (v==="24") n += 2;
  });
  return n;
}
function situacaoAco(dISO){
  const nec = acoNecessario(dISO), lan = acoLancado(dISO);
  if (nec===0 && lan===0) return {texto:"", classe:""};
  if (nec===0 && lan>0) return {texto:"SEM OFICIAL", classe:"aviso"};
  if (lan===nec) return {texto:"OK", classe:"ok"};
  if (lan<nec) return {texto:"FALTA "+(nec-lan), classe:"falta"};
  return {texto:"EXCEDE "+(lan-nec), classe:"aviso"};
}
function acoMilitaresDia(d){
  let n = 0;
  const dd = fmt(d);
  (aco||[]).forEach(id=>{
    if (!id) return;
    const v = marks["ACO|"+id+"|"+dd];
    if (v==="24") n += 1;
    else if (v==="12") n += 0.5;
  });
  return n;
}
function cotasAcoMilitar(id){
  let n = 0;
  diasDoMes().forEach(d=>{
    const v = marks["ACO|"+id+"|"+fmt(d)];
    if (v==="12") n += 1;
    else if (v==="24") n += 2;
  });
  return n;
}
function cotasAcoMes(){
  let n = 0;
  (aco||[]).forEach(id=>{ if (id) n += cotasAcoMilitar(id); });
  return n;
}

function pjesAntesOrd(id, dia, cod){
  const pjes = ["PJ","PJ12","SPJ"];
  if (pjes.indexOf(cod) >= 0){
    const prox = somarDiaISO(dia, PJ_ANTES_ORD_DIAS);
    const m = marcaDoMilitarNoDia(id, prox);
    if (m && m.cod === "X") return {pjes:dia, x:prox};
  }
  if (cod === "X"){
    const ant = somarDiaISO(dia, -PJ_ANTES_ORD_DIAS);
    const m = marcaDoMilitarNoDia(id, ant);
    if (m && pjes.indexOf(m.cod) >= 0) return {pjes:ant, x:dia};
  }
  return null;
}

function pesoMeta(v){
  if (v==="X"||v==="PJ"||v==="SPJ") return 1;
  if (v==="PJ12"||v==="PJ12H"||v==="S1") return 0.5;
  return 0;
}

function contagemSB(sb,d){
  const dd = fmt(d);
  if (typeof _cacheContagemSB !== "undefined" && _cacheContagemSB && _cacheContagemSB[sb] && _cacheContagemSB[sb][dd] !== undefined){
    return _cacheContagemSB[sb][dd];
  }
  let n=0;
  pessoasDaSecao(sb).forEach(m=>{ n+=pesoMeta(getMarkExato(sb,m.id,dd)); });
  pessoasAdm(sb).forEach(m=>{ n+=pesoMeta(getMarkExato("ADM:"+sb,m.id,dd)); });
  [...new Set(vis[sb]||[])].forEach(id=>{
    if(!id) return;
    if (markMaeDoDia(id,dd)) return;
    const v = getMarkExato("host:"+sb, id, dd);
    if (v==="PJ") n += 1;
    else if (v==="PJ12") n += 0.5;
    else if (v==="X") n += 1;
  });
  if (typeof _cacheContagemSB !== "undefined"){
    if (!_cacheContagemSB) _cacheContagemSB = {};
    if (!_cacheContagemSB[sb]) _cacheContagemSB[sb] = {};
    _cacheContagemSB[sb][dd] = n;
  }
  return n;
}

function motoristasSB(sb,d){
  const dd = fmt(d);
  if (typeof _cacheMotoristasSB !== "undefined" && _cacheMotoristasSB && _cacheMotoristasSB[sb] && _cacheMotoristasSB[sb][dd] !== undefined){
    return _cacheMotoristasSB[sb][dd];
  }
  let n=0;
  pessoasDaSecao(sb).forEach(m=>{ if(m.motorista==="M") n+=pesoMeta(getMarkExato(sb,m.id,dd)); });
  pessoasAdm(sb).forEach(m=>{ if(m.motorista==="M") n+=pesoMeta(getMarkExato("ADM:"+sb,m.id,dd)); });
  [...new Set(vis[sb]||[])].forEach(id=>{
    if(!id) return;
    if (markMaeDoDia(id,dd)) return;
    const mm = D.mes.find(x=>x.id===id);
    if (!mm || String(mm.motorista||"").trim().toUpperCase()!=="M") return;
    const v = getMarkExato("host:"+sb, id, dd);
    if (v==="PJ") n += 1;
    else if (v==="PJ12") n += 0.5;
    else if (v==="X") n += 1;
  });
  if (typeof _cacheMotoristasSB !== "undefined"){
    if (!_cacheMotoristasSB) _cacheMotoristasSB = {};
    if (!_cacheMotoristasSB[sb]) _cacheMotoristasSB[sb] = {};
    _cacheMotoristasSB[sb][dd] = n;
  }
  return n;
}

const COD_PRESENCA_FEM = {"X":1,"PJ":1,"PJ12":1,"PJ12H":1,"SPJ":1,"S1":1};
function efetivoFemininoSB(sb, d){
  const fem = (D && D.fem) || {};
  let n = 0;
  const dd = fmt(d);
  const conta = function(grupo, id){
    if (!fem[id]) return;
    const v = marks[grupo+"|"+id+"|"+dd];
    if (v && COD_PRESENCA_FEM[v]) n++;
  };
  pessoasDaSecao(sb).forEach(function(m){ conta(sb, m.id); });
  pessoasAdm(sb).forEach(function(m){ conta("ADM:"+sb, m.id); });
  [...new Set(vis[sb]||[])].forEach(function(id){ if (id) conta("host:"+sb, id); });
  return n;
}

function avaliarSituacaoDia(valor, meta){
  if (!meta) return {texto:""};
  if (valor < meta) return {texto:(meta - valor), classe:"falta"};
  return {texto:"OK", classe:"ok"};
}

function situacaoMilitaresDia(sb, d){
  const meta = (D && D.params && D.params.metaBM && D.params.metaBM[sb]) || 0;
  return avaliarSituacaoDia(contagemSB(sb, d), meta);
}

function situacaoMotoristasDia(sb, d){
  const metaMot = (D && D.params && D.params.metaMot && D.params.metaMot[sb]) || 0;
  return avaliarSituacaoDia(motoristasSB(sb, d), metaMot);
}

function calcularTotalizadoresDiaSB(sb, d){
  const meta = (D && D.params && D.params.metaBM && D.params.metaBM[sb]) || 0;
  const metaMot = (D && D.params && D.params.metaMot && D.params.metaMot[sb]) || 0;
  const mil = contagemSB(sb, d);
  const mot = motoristasSB(sb, d);
  const fem = efetivoFemininoSB(sb, d);
  return {
    militaresPorDia: mil || "",
    necessidadeDiaria: meta || "",
    situacao: avaliarSituacaoDia(mil, meta),
    motoristas: mot || "",
    situacaoMot: avaliarSituacaoDia(mot, metaMot),
    efetivoFeminino: fem || ""
  };
}

function cotasDoCodigo(v){
  if (v==="PJ") return 2;
  if (v==="PJ12"||v==="PJ12H"||v==="SPJ") return 1;
  return 0;
}
function somarCotas(prefixos){
  let s=0;
  for (const k in marks){
    const p=k.split("|");
    if (!prefixos.some(pre=> p[0]===pre)) continue;
    if (markMaeDoDia(p[1], p[2]) && p[0].indexOf("host:")===0) continue;
    s += cotasDoCodigo(marks[k]);
  }
  return s;
}

function estaAfastado(m, dia){
  const alvo = fmt(dia);
  const lista = (m && m.afast) ? m.afast : [];
  for (let i=0;i<lista.length;i++){
    const {ini, fim} = intervaloISO(lista[i]);
    if (!ini || !fim) continue;
    if (alvo >= ini && alvo <= fim) return true;
  }
  return false;
}
function diasAfastados(m){
  const dias = diasDoMes();
  const esc = String((m && m.escala) || "").toUpperCase().replace(/\s+/g,"");
  // X-* guarda a equipe base em escalaOrigem (ou em MAPA_X): sem isso, o
  // afastamento de um militar X-* conta todos os dias, não só os da equipe.
  const isX = esc.indexOf("X-") === 0;
  const escalaBase = isX ? (m.escalaOrigem || MAPA_X[esc] || esc) : esc;
  const gi = ORDEM_ESC[String(escalaBase||"").trim().toUpperCase().replace(/\s+/g,"")];
  const ehEquipe = (gi!=null && gi<4);
  const ehDiaServico = (d)=> ehEquipe ? (indiceEquipe(d)===gi) : true;
  let n=0;
  dias.forEach(d=>{ if (ehDiaServico(d) && estaAfastado(m,d)) n++; });
  // X-* sem afastamento no mês corrente = afastado o mês inteiro (semântica
  // histórica). Só dispara o fallback se NÃO houver afast — nunca quando o
  // afast existe mas não cobre dias de serviço da equipe base.
  if (n===0 && isX && !temAfastamentoNoMes(m)) n = dias.filter(ehDiaServico).length;
  return n;
}
function saldosDevidos(m){
  if (m && m.restricao) return 0;
  let a = 0;
  diasDoMes().forEach(d=>{ if (estaAfastado(m, d)) a++; });
  const esc = String((m && m.escala) || "").toUpperCase().replace(/\s+/g,"");
  if (a === 0 && esc.indexOf("X-") === 0 && (!m.afast || !m.afast.length)) a = 30;
  if (a > 30) a = 30;
  return Math.floor((4 * (30 - a) + 29) / 30);
}
