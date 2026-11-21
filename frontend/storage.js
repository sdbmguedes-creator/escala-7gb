/* eslint-disable no-unused-vars */
/* global D, COD, SBS, ORDEM_ESC, MES_BASE, marks, comments, vis, aco,
   afastMesclado, autoX, statusMes, competenciaFechada, fechadaPor, fechadaEm,
   invalidarCachePessoas,
   reconstruirIndiceMarcas, expurgarHostDuplicados, limparOrfas,
   migrarAdmSemEscala, normalizarAfastamentos, construirElencoNovo,
   avisosLegado, ehMestre, status, desenhar, dataBR, mesAnoBR,
   ordenarOficiais, intervaloISO, fimDeAfast, sobrepoeMes,
   Sync, _ultimoSync, opsDeGravacao, diffEstado,
   alert, Blob, URL, FileReader */
/* Camada de Persistência Local e Backup JSON (extraída de frontend/index_v14.html) */

// ===== 5. PERSISTÊNCIA (salvar/carregar/importar/exportar) =====
function chaveLocal(){ return "escala7gb-"+String(D.competencia).slice(0,7); }
function ordemPessoasAtual(){ const o = {}; D.pessoas.forEach(function(p){ o[p.id] = p.ordem; }); return o; }
function estadoSalvavel(){
  const movsLeves = Array.isArray(D.movimentos) ? D.movimentos.slice(-50) : [];
  return {
    _v:3,
    marks,
    comments,
    vis,
    visLinhas:D.visLinhas,
    aco,
    params:D.params,
    mes:D.mes,
    afastMesclado:afastMesclado,
    removidos:D.removidos,
    acoOficiais:D.acoOficiais,
    confFixos:D.confFixos||[],
    ordemPessoas:ordemPessoasAtual(),
    autoX:autoX,
    statusMes:statusMes,
    competenciaFechada:!!competenciaFechada,
    fechadaPor:fechadaPor||"",
    fechadaEm:fechadaEm||"",
    snapshot:D.snapshot,
    movimentos:movsLeves
  };
}
// Aplica um estado salvo/importado de forma única (substitui, não mescla): usado por init, carregarEstado e importar.
function aplicarEstado(j){
  invalidarCachePessoas();
  marks = (j.marks && typeof j.marks === "object") ? j.marks : {};
  comments = (j.comments && typeof j.comments === "object") ? j.comments : {};
  vis = j.vis || {}; aco = j.aco || [];
  D.visLinhas = j.visLinhas || {};
  if (j.mes) D.mes = j.mes;
  D.acoOficiais = j.acoOficiais || {};
  D.removidos = j.removidos || {};
  D.confFixos = Array.isArray(j.confFixos) ? j.confFixos : [];
  if (j.ordemPessoas && typeof j.ordemPessoas === "object"){
    D.pessoas.forEach(function(p){ if (typeof j.ordemPessoas[p.id] === "number") p.ordem = j.ordemPessoas[p.id]; });
  }
  afastMesclado = !!j.afastMesclado;
  if (j.autoX !== undefined) autoX = !!j.autoX;
  statusMes = j.statusMes || "ativa";
  competenciaFechada = !!j.competenciaFechada;
  fechadaPor = j.fechadaPor || "";
  fechadaEm = j.fechadaEm || "";
  D.snapshot = j.snapshot || null;
  D.movimentos = j.movimentos || [];
  if (j.params){
    D.params = {...D.params, ...j.params};
    ["metaBM","metaMot","cotas"].forEach(function(k){ if (j.params[k]) D.params[k] = {...D.params[k], ...j.params[k]}; });
  }
}
function salvarLocal(silencioso){
  reconstruirIndiceMarcas();
  const ym = String(D.competencia).slice(0,7);
  if (!gravarMes(ym, estadoSalvavel())){
    status("ERRO ao salvar — ver console");
    return;
  }
  if (!silencioso) status("salvo localmente");
}
function salvar(){ salvarLocal(true); status("salvo"); }

function exportar(){
  const dados = JSON.parse(JSON.stringify({...D,...estadoSalvavel(),oficiais:D.oficiais}));
  function brAfast(lista){
    (lista||[]).forEach(function(a){
      if (!a) return;
      if (a.ini) a.ini = dataBR(a.ini);
      if (a.fim) a.fim = dataBR(a.fim);
    });
  }
  (dados.mes||[]).forEach(function(m){ brAfast(m.afast); });
  Object.keys(dados.removidos||{}).forEach(function(id){ brAfast((dados.removidos[id]||{}).afast); });
  const blob=new Blob([JSON.stringify(dados,null,1)],{type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  a.download="escala-"+D.competencia.slice(0,7)+".json"; a.click();
}

// Validação do arquivo a importar: formas esperadas de marks/mes/vis/aco.
function validarEstado(j){
  const erros = [];
  const CODS_VALIDOS = {};
  COD.concat(["12","24","SB","PJ12H","Nm"]).forEach(function(c){ CODS_VALIDOS[c] = 1; });
  if (j.marks !== undefined){
    if (typeof j.marks !== "object" || j.marks === null || Array.isArray(j.marks)) erros.push("marks: esperado objeto");
    else Object.keys(j.marks).forEach(function(k){
      const v = j.marks[k];
      if (typeof v !== "string") erros.push("marks["+k+"]: valor não é string");
      else if (!CODS_VALIDOS[v]) erros.push("marks["+k+"]: código desconhecido '"+v+"'");
    });
  }
  if (j.comments !== undefined){
    if (typeof j.comments !== "object" || j.comments === null || Array.isArray(j.comments)) erros.push("comments: esperado objeto");
    else Object.keys(j.comments).forEach(function(k){
      if (typeof j.comments[k] !== "string") erros.push("comments["+k+"]: esperado string");
      else if (j.comments[k].length > 2000) erros.push("comments["+k+"]: texto muito longo (max 2000)");
    });
  }
  if (j.mes !== undefined){
    if (!Array.isArray(j.mes)) erros.push("mes: esperado array");
    else j.mes.forEach(function(m, i){
      if (!m || typeof m !== "object" || Array.isArray(m)){ erros.push("mes["+i+"]: registro inválido"); return; }
      if (typeof m.id !== "string" || !m.id) erros.push("mes["+i+"]: sem id");
      if (typeof m.secao !== "string" || SBS.indexOf(m.secao) < 0) erros.push("mes["+i+"]."+(m.id||"?")+": seção inválida");
      if (typeof m.escala !== "string" || ["ALFA","BRAVO","CHARLIE","DELTA","X - A","X - B","X - C","X - D","ADM","X - ADM"].indexOf(m.escala) < 0) erros.push("mes["+i+"]."+(m.id||"?")+": escala inválida");
      var _escValidas = ["ALFA","BRAVO","CHARLIE","DELTA","X - A","X - B","X - C","X - D"];
      if (m.escalaOrigem !== undefined && m.escalaOrigem !== null && (typeof m.escalaOrigem !== "string" || _escValidas.indexOf(m.escalaOrigem) < 0)) erros.push("mes["+i+"]."+(m.id||"?")+": escalaOrigem inválida");
      if (m.escalaOrigemAdm !== undefined && m.escalaOrigemAdm !== null && (typeof m.escalaOrigemAdm !== "string" || _escValidas.indexOf(m.escalaOrigemAdm) < 0)) erros.push("mes["+i+"]."+(m.id||"?")+": escalaOrigemAdm inválida");
    });
  }
  if (j.vis !== undefined){
    if (typeof j.vis !== "object" || j.vis === null || Array.isArray(j.vis)) erros.push("vis: esperado objeto sb → array");
    else Object.keys(j.vis).forEach(function(sb){
      if (!Array.isArray(j.vis[sb])) erros.push("vis["+sb+"]: esperado array de ids");
      else j.vis[sb].forEach(function(id, i){ if (id !== null && typeof id !== "string") erros.push("vis["+sb+"]["+i+"]: id inválido"); });
    });
  }
  if (j.aco !== undefined){
    if (!Array.isArray(j.aco)) erros.push("aco: esperado array de ids/null");
    else j.aco.forEach(function(v, i){ if (v !== null && typeof v !== "string") erros.push("aco["+i+"]: id inválido"); });
  }
  const ehObj = function(o){ return o !== null && typeof o === "object" && !Array.isArray(o); };
  if (j.mes !== undefined && Array.isArray(j.mes)) j.mes.forEach(function(m, i){
    if (m && m.afast !== undefined && !Array.isArray(m.afast)) erros.push("mes["+i+"].afast: esperado array");
    else if (m && Array.isArray(m.afast)) m.afast.forEach(function(a, n){ if (!ehObj(a)) erros.push("mes["+i+"].afast["+n+"]: registro inválido"); });
  });
  if (j.params !== undefined && !ehObj(j.params)) erros.push("params: esperado objeto");
  else if (j.params){
    var P = j.params;
    ["metaBM","metaMot","cotas"].forEach(function(k){
      if (P[k] === undefined) return;
      if (!ehObj(P[k])){ erros.push("params."+k+": esperado objeto"); return; }
      Object.keys(P[k]).forEach(function(sb){
        var v = P[k][sb];
        if (v === null || v === undefined) return;
        if (typeof v !== "number" || !isFinite(v)) erros.push("params."+k+"."+sb+": esperado número");
      });
    });
    if (P.sei !== undefined && P.sei !== null){
      if (typeof P.sei !== "number" || !isFinite(P.sei) || P.sei < 0) erros.push("params.sei: esperado número >= 0");
    }
  }
  if (j.acoOficiais !== undefined && !ehObj(j.acoOficiais)) erros.push("acoOficiais: esperado objeto");
  else if (j.acoOficiais){
    Object.keys(j.acoOficiais).forEach(function(data){
      var t = j.acoOficiais[data];
      if (!ehObj(t)){ erros.push("acoOficiais["+data+"]: esperado objeto"); return; }
      ["t1","t2"].forEach(function(k){
        if (t[k] !== undefined && t[k] !== null && typeof t[k] !== "string") erros.push("acoOficiais["+data+"]."+k+": esperado string ou null");
      });
    });
  }
  if (j.removidos !== undefined && !ehObj(j.removidos)) erros.push("removidos: esperado objeto");
  else if (j.removidos){
    var _escR = ["ALFA","BRAVO","CHARLIE","DELTA","X - A","X - B","X - C","X - D"];
    Object.keys(j.removidos).forEach(function(id){
      var r = j.removidos[id];
      if (!ehObj(r)){ erros.push("removidos["+id+"]: registro inválido"); return; }
      ["escalaOrigem","escalaOrigemAdm"].forEach(function(k){
        if (r[k] !== undefined && r[k] !== null && (typeof r[k] !== "string" || _escR.indexOf(r[k]) < 0)) erros.push("removidos["+id+"]."+k+": escala inválida");
      });
    });
  }
  if (j.movimentos !== undefined){
    if (!Array.isArray(j.movimentos)) erros.push("movimentos: esperado array");
    else j.movimentos.forEach(function(x, i){
      if (!ehObj(x)){ erros.push("movimentos["+i+"]: registro inválido"); return; }
      if (typeof x.tipo !== "string" || ["remessa","transferencia","mudanca_sb","ajuste_escala"].indexOf(x.tipo) < 0) erros.push("movimentos["+i+"].tipo: inválido");
      if (typeof x.qtd !== "number" || !isFinite(x.qtd)) erros.push("movimentos["+i+"].qtd: esperado número");
      if (x.origem !== undefined && x.origem !== null && typeof x.origem !== "string") erros.push("movimentos["+i+"].origem: esperado string");
      if (x.destino !== undefined && x.destino !== null && typeof x.destino !== "string") erros.push("movimentos["+i+"].destino: esperado string");
    });
  }
  if (j.snapshot !== undefined && j.snapshot !== null && !ehObj(j.snapshot)) erros.push("snapshot: esperado objeto ou null");
  return { ok: erros.length === 0, erros: erros };
}
function importar(inp){
  if (!ehMestre()){ alert("Somente o perfil Mestre pode importar dados."); inp.value = ""; return; }
  const f=inp.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=()=>{ try{
    const j=JSON.parse(r.result);
    const val = validarEstado(j);
    if (!val.ok){
      alert("Arquivo rejeitado — problemas encontrados:\n- " + val.erros.slice(0,10).join("\n- ")
        + (val.erros.length > 10 ? ("\n- ... e mais " + (val.erros.length - 10)) : ""));
      inp.value = ""; return;
    }
    if (j.competencia && j.competencia!==D.competencia){
      alert("Arquivo de outro mês ("+mesAnoBR(j.competencia)+"). Troque a competência para esse mês e importe novamente — importar aqui sobrescreveria o mês atual ("+mesAnoBR(D.competencia)+").");
      inp.value = ""; return;
    }
    if (j.autoX === undefined) j.autoX = true;
    if (!j.removidos) j.removidos = {};
    aplicarEstado(j);
    if (j.oficiais) { D.oficiais = ordenarOficiais((j.oficiais || []).concat(D.oficiais)); salvarOficiais(); }
    // Afastamentos são sempre normalizados (exportar grava datas em BR); migração de legado só em _v < 3.
    if (!(j._v >= 3)) migrarAdmSemEscala();
    normalizarAfastamentos();
    D._v = 3;
    reconstruirIndiceMarcas();
    expurgarHostDuplicados();
    limparOrfas();
    reconstruirIndiceMarcas();
    salvarLocal(true);
    desenhar();
    status("importado");
  }catch(e){ console.error("[escala7gb] importar", e); alert("arquivo invalido"); } };
  r.readAsText(f);
}

function carregarEstado(){
  if (typeof Sync !== "undefined") Sync.suprimir++;
  try { return _carregarEstado(); }
  finally { if (typeof Sync !== "undefined") Sync.suprimir--; }
}
function _carregarEstado(){
  D.params = {
    metaBM: Object.assign({}, D.params.metaBM),
    metaMot: Object.assign({}, D.params.metaMot),
    cotas: {},
    sei: null
  };
  let bruto = localStorage.getItem(chaveLocal());
  if (!bruto && String(D.competencia).slice(0,7)==="2026-11" && !localStorage.getItem("escala7gb-migrado")){
    const antigo = localStorage.getItem("escala7gb");
    if (antigo){
      try{
        if (!gravarMes(String(D.competencia).slice(0,7), JSON.parse(antigo))){
          throw new Error("falha ao gravar migração");
        }
        localStorage.setItem("escala7gb-migrado","1");
        bruto = antigo;
      }catch(e){ console.error("[escala7gb] migração chave antiga", e); }
    }
  }
  let msgNovoMes = "";
  if (bruto){
    try{
      const j = JSON.parse(bruto);
      autoX = false;
      aplicarEstado(j);
      if (!afastMesclado){ mesclarAfastamentosDoAnterior(); afastMesclado = true; salvarLocal(true); }
    }catch(e){ console.error("[escala7gb] estado local corrompido", e); }
  } else if (String(D.competencia).slice(0,7) === "2026-11"){
    try{ salvarLocal(true); }catch(e){ console.error("[escala7gb] salvar inicial embutido", e); }
  } else {
    marks={}; vis={}; aco=[]; afastMesclado = true; autoX = false;
    D.removidos = {}; D.visLinhas = {}; D.confFixos = []; D.acoOficiais = {};
    statusMes = "preparacao";
    D.snapshot = null; D.movimentos = [];
    const r = construirElencoNovo(ultimoElencoAnterior());
    D.mes = r.elenco;
    mesclarAfastamentosDoAnterior();
    salvarLocal(true);
    if (r.voltaram.length || r.ficaram.length){
      let msg = "";
      if (r.voltaram.length){
        const nomes = r.voltaram.map(id=>{ const p=D.pessoas.find(x=>x.id===id); return (p?p.nome:id)+" ("+id+")"; }).join(", ");
        msg += r.voltaram.length+" militar(es) X-* voltaram à escala-base: "+nomes+". ";
      }
      if (r.ficaram.length){
        msg += r.ficaram.length+" continuam X-* por afastamento. ";
      }
      msg += "Mês em PREPARAÇÃO: lance os afastamentos e ative a escala na aba OPERACIONAL.";
      msgNovoMes = msg;
    }
  }
  let _migrou = migrarAdmSemEscala();
  // PURGA DE HOST DESATIVADA.
  // Ela não altera contagem: contagemSB() já ignora visitante que tem marca na
  // própria SB (markMaeDoDia). Mas a purga fazia o estado local divergir do
  // servidor (968 x 1211) e tentava enviar 243 exclusões — recusadas para
  // perfil de SB e bloqueadas pela trava de 60 para Admin. Laço sem saída.
  // A planilha é a fonte: o que está lá permanece.
  // if (expurgarHostDuplicados()) _migrou = true;
  if (normalizarAfastamentos()) _migrou = true;
  reconstruirIndiceMarcas();
  if (limparOrfas()) _migrou = true;
  if (_migrou) { try{ salvarLocal(true); }catch(e){ console.error("[escala7gb] salvar pós-migração", e); } }
  if (msgNovoMes) alert(msgNovoMes);
  avisosLegado();
}

function salvarOficiais(){
  try{
    localStorage.setItem("escala7gb-oficiais", JSON.stringify(D.oficiais));
    localStorage.setItem("escala7gb-oficiais-v25", "1");
  }catch(e){ console.error("[escala7gb] oficiais", e); }
}

function mesesSalvos(){
  var out = [];
  for (var i=0;i<localStorage.length;i++){
    var k = localStorage.key(i);
    if (k && k.indexOf("escala7gb-")===0) out.push(k.slice("escala7gb-".length));
  }
  out.sort(); return out;
}
function elencoDoMesSalvo(ym){
  var bruto = localStorage.getItem("escala7gb-"+ym);
  if (!bruto) return null;
  try{ var j = JSON.parse(bruto); return j.mes ? JSON.parse(JSON.stringify(j.mes)) : null; }catch(e){ return null; }
}
function ultimoElencoAnterior(){
  var atual = String(D.competencia).slice(0,7);
  var meses = mesesSalvos().filter(function(m){ return m < atual; });
  for (var i=meses.length-1;i>=0;i--){
    var el = elencoDoMesSalvo(meses[i]);
    if (el) return el;
  }
  return JSON.parse(JSON.stringify(MES_BASE));
}
function mesclarAfastamentosDoAnterior(){
  var atual = String(D.competencia).slice(0,7);
  var meses = mesesSalvos().filter(function(m){ return m < atual; });
  if (!meses.length) return;
  var ant = elencoDoMesSalvo(meses[meses.length-1]);
  if (!ant) return;
  var alvo = new Date(D.competencia+"T12:00:00");
  var primeiro = new Date(alvo.getFullYear(), alvo.getMonth(), 1);
  var ultimo = new Date(alvo.getFullYear(), alvo.getMonth()+1, 0);
  ant.forEach(function(am){
    (am.afast||[]).forEach(function(a){
      if (!sobrepoeMes(a, primeiro, ultimo)) return;
      var mm = D.mes.find(function(x){ return x.id===am.id; });
      if (!mm) return;
      mm.afast = mm.afast || [];
      var jaTem = mm.afast.some(function(b){ return b.ini===a.ini && fimDeAfast(b)===fimDeAfast(a); });
      if (!jaTem) mm.afast.push(JSON.parse(JSON.stringify(a)));
    });
  });
}

/* ==========================================================================
   FUNIL DE GRAVAÇÃO POR COMPETÊNCIA — ponto ÚNICO.
   Toda escrita de um mês passa por aqui. É o único lugar que o backend precisa
   interceptar. Nenhum outro trecho pode chamar localStorage.setItem com uma
   chave "escala7gb-AAAA-MM".
   ========================================================================== */
function chaveDeMes(ym){ return "escala7gb-" + ym; }

function lerMes(ym){
  try{
    const bruto = localStorage.getItem(chaveDeMes(ym));
    return bruto ? JSON.parse(bruto) : null;
  }catch(e){ console.error("[escala7gb] lerMes", ym, e); return null; }
}

function gravarMes(ym, j){
  if (!ym || !j) return false;
  const payload = JSON.stringify(j);
  try{
    localStorage.setItem(chaveDeMes(ym), payload);
  }catch(e){
    if (e && e.name === "QuotaExceededError") {
      try {
        Object.keys(localStorage).forEach(function(k){
          if (k.startsWith("escala7gb-20") && k !== chaveDeMes(ym)) {
            localStorage.removeItem(k);
          }
        });
        localStorage.setItem(chaveDeMes(ym), payload);
      } catch(e2) {
        try {
          const enxuto = Object.assign({}, j, { snapshot: null, movimentos: [] });
          localStorage.setItem(chaveDeMes(ym), JSON.stringify(enxuto));
        } catch(e3) {
          console.warn("[escala7gb] localStorage cheio em", ym, "— seguindo apenas em memória/sync");
        }
      }
    } else {
      console.error("[escala7gb] gravarMes", ym, e);
      return false;
    }
  }

  // GANCHO DO BACKEND: enfileira só a diferença desde o último sync.
  if (typeof Sync !== "undefined" && Sync && Sync.ligado && typeof Sync.enfileirar === "function"){
    // Sem baseline (login, 1ª visita à competência, troca de mês) NÃO há ação do
    // usuário a enviar: apenas adota o estado atual como baseline (antes o diff
    // contra null enfileirava TODAS as marcas/elenco como "novos").
    const ops = opsDeGravacao(_ultimoSync[ym], j, diffEstado);
    const deletes = ops.filter(function(op){
      return op && op.t === "marca" && (op.v === "" || op.v === null || op.v === undefined);
    });

    if (deletes.length > 500) {
      console.warn("[escala7gb] diff bloqueado: tentaria apagar", deletes.length, "marcas em", ym);
      _ultimoSync[ym] = JSON.parse(JSON.stringify(j));
      return true;
    }

    if (ops.length) Sync.enfileirar(ym, ops);
    _ultimoSync[ym] = JSON.parse(JSON.stringify(j));
  }
  return true;
}

function propagarRemocaoAfastamento(id, ini, fim){
  if (!id || !ini || !fim) return 0;
  var atual = String(D.competencia).slice(0,7);
  var mesesFuturos = mesesSalvos().filter(function(ym){
    return ym > atual && /^\d{4}-\d{2}$/.test(ym);
  });
  var n = 0;
  mesesFuturos.forEach(function(ym){
    var j = lerMes(ym);
    if (!j) return;
    try{
      if (!j.mes) return;
      var m = j.mes.find(function(x){ return x.id === id; });
      if (!m || !m.afast) return;
      var antes = m.afast.length;
      m.afast = m.afast.filter(function(a){
        var iv = intervaloISO(a);
        return !(iv.ini === ini && iv.fim === fim);
      });
      if (m.afast.length === antes) return;
      if (!m.afast.length && m.escalaOrigem && String(m.escala).toUpperCase().replace(/\s+/g,"").indexOf("X-") === 0 && !m.restricao){
        m.escala = m.escalaOrigem;
        m.escalaOrigem = null;
      }
      gravarMes(ym, j);
      n++;
    }catch(e){ console.error("[escala7gb] propagarRemocaoAfastamento", ym, e); }
  });
  return n;
}
function propagarAfastamentoParaFuturos(id, afast){
  if (!id || !afast) return;
  var atual = String(D.competencia).slice(0,7);
  var mesesFuturos = mesesSalvos().filter(function(ym){
    return ym > atual && /^\d{4}-\d{2}$/.test(ym);
  });
  mesesFuturos.forEach(function(ym){
    var j = lerMes(ym);
    if (!j) return;
    try{
      if (!j.mes) return;
      var alvo = new Date(ym+"-01T12:00:00");
      var primeiro = new Date(alvo.getFullYear(), alvo.getMonth(), 1);
      var ultimo = new Date(alvo.getFullYear(), alvo.getMonth()+1, 0);
      if (!sobrepoeMes(afast, primeiro, ultimo)) return;
      var m = j.mes.find(function(x){ return x.id === id; });
      if (!m) return;
      m.afast = m.afast || [];
      var jaTem = m.afast.some(function(b){ return b.ini === afast.ini && fimDeAfast(b) === fimDeAfast(afast); });
      if (jaTem) return;
      m.afast.push(JSON.parse(JSON.stringify(afast)));
      var esc = String(m.escala||"").toUpperCase().replace(/\s+/g,"");
      if (m.adm !== "S" && ORDEM_ESC[esc] != null && ORDEM_ESC[esc] < 4 && !m.restricao){
        m.escalaOrigem = m.escalaOrigem || m.escala;
        m.escala = "X - " + ["A","B","C","D"][ORDEM_ESC[esc]];
      }
      gravarMes(ym, j);
    }catch(e){ console.error("[escala7gb] propagarAfastamentoParaFuturos", ym, e); }
  });
}
