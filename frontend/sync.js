/* eslint-disable no-unused-vars */
/* global ehMestre, perfilAtual, marks, comments, vis, aco, statusMes, autoX,
   reconstruirIndiceMarcas, estadoSalvavel, gravarMes, esc, location,
   AbortController, alert, navigator, carregarEstado */
/* Motor de Sincronização (extraído de frontend/index_v14.html) */

/* @@sync-helpers-begin */
/* Ops a enfileirar numa gravação local. Sem baseline => [] (nada a enviar). */
function opsDeGravacao(baseline, atual, diffFn){
  if (!baseline) return [];
  return diffFn(baseline, atual) || [];
}
/* Coalescência: mantém só a ÚLTIMA op por chave lógica (evita duplicatas no lote
   → PostgreSQL 21000). Ops sem chave (mov, aco) são preservadas em ordem. */
function coalescerOps(ops){
  var saida = [], idx = {};
  (ops || []).forEach(function(op){
    if (!op) return;
    var chave = null;
    if (op.t === "marca" || op.t === "comment") chave = op.t + "|" + op.k;
    else if (op.t === "elenco") chave = "elenco|" + op.id;
    else if (op.t === "vis") chave = "vis|" + op.sb;
    else if (op.t === "oficial") chave = "oficial|" + op.dia + "|" + op.turno;
    else if (op.t === "meta") chave = "meta";
    if (chave === null){ saida.push(op); return; }
    if (chave in idx){
      var ant = saida[idx[chave]];
      if (op.t === "elenco" && ant && ant.campos && op.campos){
        op = Object.assign({}, op, { campos: Object.assign({}, ant.campos, op.campos) });
      }
      saida[idx[chave]] = null;
    }
    idx[chave] = saida.length;
    saida.push(op);
  });
  return saida.filter(Boolean);
}
/* @@sync-helpers-end */
/* ============================================================================
   F5.3 — ETAPA 5: PUSH
   Fila de operações pendentes + envio em lote. Enquanto ligado=false (file://),
   nada disso roda e o app é 100% local.
   ========================================================================== */
const Sync = {
  ligado: false,
  fila: [],
  timer: null,
  estado: "offline",     // offline | ok | enviando
  versaoPorYm: {},       // versao por competência (ym)
  _ultimoPushPorYm: {},  // timestamp do último push concluído por competência
  _flushEmAndamento: null,
  suprimir: 0,           // >0 durante carga/pull/migração: enfileirar é no-op
  recusadas: null,

  iniciar: function(){
    Sync.ligado = Transport.disponivel() && !!Sessao.token;
    Sync.carregarFila();
    var estaOffline = (typeof navigator !== "undefined" && navigator.onLine === false);
    if (estaOffline){
      Sync.estado = "offline";
    } else if (Sync.ligado){
      Sync.estado = "ok";
    }
    Sync.pintar();
    if (Sync.ligado){
      if (typeof window !== "undefined" && window.addEventListener){
        if (Sync._onlineHandler) window.removeEventListener("online", Sync._onlineHandler);
        if (Sync._offlineHandler) window.removeEventListener("offline", Sync._offlineHandler);

        Sync._onlineHandler = function(){ Sync.aoVoltarOnline(); };
        Sync._offlineHandler = function(){
          if (Sync.estado !== "erro-fatal") Sync.estado = "offline";
          Sync.pintar();
        };

        window.addEventListener("online", Sync._onlineHandler);
        window.addEventListener("offline", Sync._offlineHandler);
      }
      // Flush periódico: apenas a cada 5 minutos (reduzido de 60s)
      setInterval(function(){ if (Sync.fila.length) Sync.flush(); }, 300000);
    }
  },

  aoVoltarOnline: async function(){
    if (!Sync.ligado) return;
    if (Sync.estado === "offline") Sync.estado = "ok";
    Sync.pintar();

    var ym = (typeof D !== "undefined" && D.competencia) ? String(D.competencia).slice(0, 7) : null;
    if (!ym) return;

    // Se houve boot offline (pullInicialConcluido ainda false), completa o ciclo inicial
    if (!Sync.pullInicialConcluido && typeof sincronizarMes === "function"){
      try{
        var ok = await sincronizarMes(ym);
        Sync.pullInicialConcluido = true;
        if (ok){
          if (typeof carregarEstado === "function") carregarEstado();
          if (typeof desenhar === "function") desenhar();
        }
        if (typeof agendarPoll === "function") agendarPoll(ym);
      }catch(e){
        console.warn("[sync] pull inicial pos-online falhou:", e);
      }
    }

    if (Sync.fila.length){
      try{ await Sync.flush(); }catch(e){}
    }

    if (!Sync.fila.length && Sync.estado !== "enviando" && Sync.estado !== "erro-fatal"){
      if (typeof atualizarDoServidor === "function"){
        atualizarDoServidor(ym, true).catch(function(){});
      }
    }
  },

  carregarFila: function(){
    try{ Sync.fila = JSON.parse(localStorage.getItem("escala7gb-fila") || "[]") || []; }
    catch(e){ Sync.fila = []; }
  },

  guardarFila: function(){
    try{ localStorage.setItem("escala7gb-fila", JSON.stringify(Sync.fila)); }catch(e){}
    Sync.pintar();
  },

  pendentes: function(){
    var n = 0;
    (Sync.fila || []).forEach(function(it){ n += (it.ops || []).length; });
    return n;
  },

  enfileirar: function(ym, ops){
    if (!Sync.ligado || !ops || !ops.length) return;
    if (Sync.suprimir > 0) return;   // carga/migração/pull automático: nunca enfileira
    var existente = null;
    for (var i = 0; i < Sync.fila.length; i++){ if (Sync.fila[i].ym === ym){ existente = Sync.fila[i]; break; } }
    if (existente) existente.ops = coalescerOps(existente.ops.concat(ops));
    else Sync.fila.push({ ym: ym, ops: coalescerOps(ops) });
    Sync.guardarFila();
    Sync.agendar();
  },

  agendar: function(){
    if (Sync.timer) clearTimeout(Sync.timer);
    Sync.timer = setTimeout(function(){ Sync.flush(); }, 1500);
  },

  flush: async function(forcar){
    if (!Sync.pullInicialConcluido && !forcar) return;
    if (Sync.estado === "enviando" && Sync._flushEmAndamento) return Sync._flushEmAndamento;
    if (!Sync.ligado || !Sync.fila.length) return;
    if (Sync.estado === "erro-fatal") return;   // só destrava via descartarFila()/manual

    Sync.estado = "enviando"; Sync.pintar();

    var lote = Sync.fila.slice();
    Sync.fila = [];                     // otimista: esvazia e devolve se falhar

    var p = (async function(){
    try{
      var porMes = {};
      lote.forEach(function(it){ porMes[it.ym] = (porMes[it.ym] || []).concat(it.ops); });
      for (var ymC in porMes) porMes[ymC] = coalescerOps(porMes[ymC]);

      for (var ym in porMes){
        var r = await Transport.call("apiPush", [ym, porMes[ym], Sessao.token]);

        // ─────────── DEPOIS ───────────
        // FIX: lote recusado por REGRA (limite de deletes). NÃO descartar —
        // descartar fazia o usuário perder a deleção silenciosamente
        // (ele achava que apagou, o banco continuava com as marcas).
        // Restaura o lote à fila e bloqueia retry automático até ação manual.
        if (r && r.fatal){
          console.error("[sync] lote RECUSADO (", ym, "):", r.erro);
          // Devolve só o lote deste mês (outros meses podem ter ido bem).
          var loteMes = lote.filter(function(it){ return it.ym === ym; });
          Sync.fila = loteMes.concat(Sync.fila);
          Sync.guardarFila();
          Sync.recusadas = [{ motivo: r.erro }];
          Sync.estado = "erro-fatal";
          Sync.ultimoErro = r.erro;
          mostrarRecusas();
          try {
            alert("⚠️ Servidor recusou o lote:\n\n" + r.erro +
                  "\n\nSuas operações pendentes NÃO foram aplicadas.\n\n" +
                  "Para recuperar, abra o console (F12) e execute:\n" +
                  "  Sync.descartarFila()   // descarta e continua\n" +
                  "  Sync.estado='ok'; Sync.flush()  // tenta de novo após o adm aumentar o limite");
          } catch(e){}
          return;   // aborta este flush (não processa próximos meses)
        }

        if (!r || !r.ok) throw new Error((r && r.erro) || "push falhou");
        if (r.recusadas && r.recusadas.length){
          Sync.recusadas = r.recusadas;
          console.warn("[sync] recusadas:", r.recusadas);
          mostrarRecusas();
        }
        Sync._ultimoPushPorYm[ym] = Date.now();
        // Atualiza a versão da competência quando o incremento veio só do nosso push
        // (evita que o próximo pull ache que "outro usuário gravou" e re-aplique).
        if (r.versao != null) {
          var vAnt = Sync.versaoPorYm[ym];
          if (vAnt == null || Number(r.versao) === Number(vAnt) + 1) {
            Sync.versaoPorYm[ym] = r.versao;
          }
        }
      }
      Sync.estado = "ok";
      console.log("[sync] push ok — versao", r.versao);
    }catch(e){
      Sync.fila = lote.concat(Sync.fila);   // devolve tudo
      Sync.estado = "offline";
      console.error("[sync] push falhou:", e && e.message || e);
    } finally {
      Sync._flushEmAndamento = null;
    }

    Sync.guardarFila();
    if (Sync.fila.length && Sync.estado === "ok") Sync.agendar();
    })();
    Sync._flushEmAndamento = p;
    return p;
  },

  /** Descarta a fila local. Use quando um lote inválido ficar preso. */
 descartarFila: function(){
    var n = Sync.pendentes();
    Sync.fila = [];
    Sync.estado = "ok";
    Sync.ultimoErro = null;
    Sync.guardarFila();
    console.warn("[sync] fila descartada (" + n + " operação(ões))");
    return n;
  },

  pintar: function(){
    var el = document.getElementById("syncStatus");
    if (!el) return;
    if (!Sync.ligado){
      el.textContent = "";
      el.title = "";
      return;
    }
    var n = Sync.pendentes();
    if (!n && Sync.fila && Sync.fila.length) n = Sync.fila.length;
    var offlineNav = (typeof navigator !== "undefined" && navigator.onLine === false);

    if (Sync.estado === "enviando"){
      el.textContent = "enviando…";
      el.style.color = "#ffe08a";
      el.title = n ? (n + " operação(ões) sendo enviada(s)") : "Enviando lote...";
    } else if (Sync.estado === "erro-fatal"){
      el.textContent = "erro de envio" + (n ? " · " + n + " pendente(s)" : "");
      el.style.color = "#ffb3b3";
      el.title = Sync.ultimoErro || "Operação recusada pelo servidor";
    } else if (Sync.estado === "erro"){
      el.textContent = "erro de envio — ver console";
      el.style.color = "#ffb3b3";
      el.title = "Falha de envio — veja os detalhes no console";
    } else if (Sync.estado === "offline" || offlineNav){
      el.textContent = "Offline" + (n ? " · " + n + " pendente(s)" : "");
      el.style.color = "#ffb3b3";
      el.title = n ? (n + " operação(ões) aguardando conexão") : "Modo offline (sem pendências)";
    } else if (n > 0){
      el.textContent = "Pendente (" + n + ")…";
      el.style.color = "#ffe08a";
      el.title = n + " operação(ões) pendente(s) aguardando envio";
    } else {
      el.textContent = "sincronizado";
      el.style.color = "#b7f0c1";
      el.title = "Todas as alterações estão salvas no servidor";
    }
  }
};

/* fotografia do último estado sincronizado (ou do último aplicado do servidor) */
let _ultimoSync = {};
let _tsLocal = null;

function indexarPorId(lista){
  const out = {};
  (lista || []).forEach(function(m){ if (m && m.id) out[m.id] = m; });
  return out;
}

function diffEstado(antes, depois){
  const ops = [];
  const ts = Date.now();

  const _ehGlobal = (typeof ehMestre === "function" && ehMestre()) ||
                  (typeof perfilAtual === "string" && (perfilAtual === "Admin" || perfilAtual === "Mestre"));
  const _normSec = function(s){
    return String(s || "").replace(/\s+/g, "").toUpperCase();
  };
  const _meuNorm = _normSec(typeof perfilAtual !== "undefined" ? perfilAtual : "");

  const _chavePertenceAoMeuPerfil = function(chave){
    if (_ehGlobal) return true;
    const partes = String(chave || "").split("|");
    const grupo = String(partes[0] || "").trim();
    const milId = partes[1];

    if (grupo.toUpperCase() === "ACO") {
      const listaElenco = (depois && depois.mes) || (antes && antes.mes) || [];
      const encontrado = listaElenco.find(function(m){ return String(m.id) === String(milId); });
      return !!(encontrado && _normSec(encontrado.secao) === _meuNorm);
    }

    let alvo = grupo;
    if (grupo.toUpperCase().startsWith("ADM:")) alvo = grupo.slice(4);
    else if (grupo.toLowerCase().startsWith("host:")) alvo = grupo.slice(5);
    return _normSec(alvo) === _meuNorm;
  };

  // 1) marcas — por chave
  const A = (antes && antes.marks) || {}, B = (depois && depois.marks) || {};
  const chaves = new Set(Object.keys(A).concat(Object.keys(B)));
  chaves.forEach(function(k){
    if (!_chavePertenceAoMeuPerfil(k)) return;
    const va = A[k] || "", vb = B[k] || "";
    if (va !== vb) ops.push({t:"marca", k:k, v:vb, ts:ts});
  });

  // 1b) comentários — por chave (mesmo padrão das marcas)
  const cA = (antes && antes.comments) || {}, cB = (depois && depois.comments) || {};
  new Set(Object.keys(cA).concat(Object.keys(cB))).forEach(function(k){
    if (!_chavePertenceAoMeuPerfil(k)) return;
    const va = cA[k] || "", vb = cB[k] || "";
    if (va !== vb) ops.push({t:"comment", k:k, v:vb, ts:ts});
  });

  if (!_ehGlobal) {
    // 5a) VISITANTES — apenas da própria SB
    const visA = (antes && antes.vis) || {}, visB = (depois && depois.vis) || {};
    const vlA = (antes && antes.visLinhas) || {}, vlB = (depois && depois.visLinhas) || {};
    new Set(Object.keys(visA).concat(Object.keys(visB), Object.keys(vlA), Object.keys(vlB))).forEach(function(sb){
      if (_normSec(sb) !== _meuNorm) return;
      const la = (visA[sb] || []).join(",");
      const lb = (visB[sb] || []).join(",");
      const qa = vlA[sb], qb = vlB[sb];
      if (la !== lb || qa !== qb){
        ops.push({ t: "vis", sb: sb, lista: visB[sb] || [], linhas: qb, ts: ts });
      }
    });

    // 5c) ACO — apenas militares da própria seção
    const listaEl = (depois && depois.mes) || (antes && antes.mes) || [];
    const ehDaMinhaSec = function(id){
      const m = listaEl.find(function(x){ return String(x.id) === String(id); });
      return !!(m && _normSec(m.secao) === _meuNorm);
    };
    const acoA = ((antes && antes.aco) || []).filter(function(x){ return !!x && ehDaMinhaSec(x); });
    const acoB = ((depois && depois.aco) || []).filter(function(x){ return !!x && ehDaMinhaSec(x); });
    const acoAdd = acoB.filter(function(id){ return acoA.indexOf(id) < 0; });
    const acoDel = acoA.filter(function(id){ return acoB.indexOf(id) < 0; });
    if (acoAdd.length || acoDel.length){
      ops.push({ t: "aco", add: acoAdd, del: acoDel, ts: ts });
    }

    return ops;
  }

  // 2) elenco — por militar, campo a campo
  const mA = indexarPorId((antes && antes.mes) || []);
  const mB = indexarPorId((depois && depois.mes) || []);
  new Set(Object.keys(mA).concat(Object.keys(mB))).forEach(function(id){
    const a = mA[id], b = mB[id];
    if (!a){ ops.push({t:"elenco", id:id, campos:b, ts:ts}); return; }
    if (!b){ ops.push({t:"elenco", id:id, campos:null, ts:ts}); return; }
    const campos = {};
    ["secao","escala","motorista","adm","restricao","cotasAdm",
     "afast","escalaOrigem","escalaOrigemAdm","motoristaEra","motoristaVolta"]
      .forEach(function(campo){
        if (JSON.stringify(a[campo]) !== JSON.stringify(b[campo])) campos[campo] = b[campo];
      });
    if (Object.keys(campos).length) ops.push({t:"elenco", id:id, campos:campos, ts:ts});
  });

  // 3) oficiais do ACO — por dia/turno
  const oA = (antes && antes.acoOficiais) || {}, oB = (depois && depois.acoOficiais) || {};
  new Set(Object.keys(oA).concat(Object.keys(oB))).forEach(function(dia){
    ["t1","t2"].forEach(function(turno){
      const va = (oA[dia]||{})[turno] || "", vb = (oB[dia]||{})[turno] || "";
      if (va !== vb) ops.push({t:"oficial", dia:dia, turno:turno, v:vb, ts:ts});
    });
  });

  // 4) movimentos — append-only, identifica por assinatura
  const idMov = function(m){ return [m.quando,m.tipo,m.origem,m.destino,m.qtd].join("|"); };
  const movA = new Set(((antes && antes.movimentos) || []).map(idMov));
  ((depois && depois.movimentos) || []).forEach(function(m){
    if (!movA.has(idMov(m))) ops.push({t:"mov", id:idMov(m), dados:m, ts:ts});
  });

  // 5a) VISITANTES — por SB, para o escalante da própria SB poder gravar.
  // visLinhas (altura do bloco) vai junto: é dado da mesma SB e não pode
  // depender de "meta", que só Admin/Mestre gravam.
  const visA = (antes && antes.vis) || {}, visB = (depois && depois.vis) || {};
  const vlA = (antes && antes.visLinhas) || {}, vlB = (depois && depois.visLinhas) || {};
  new Set(Object.keys(visA).concat(Object.keys(visB), Object.keys(vlA), Object.keys(vlB))).forEach(function(sb){
    const la = (visA[sb] || []).join(",");
    const lb = (visB[sb] || []).join(",");
    const qa = vlA[sb], qb = vlB[sb];
    if (la !== lb || qa !== qb){
      ops.push({ t: "vis", sb: sb, lista: visB[sb] || [], linhas: qb, ts: ts });
    }
  });

  // 5c) ACO — lista de militares em 12/24. Operação própria: o escalante
  // inclui/remove os militares da sua seção; o servidor confere pelo elenco.
  // linhas vazias da ACO (id null/"") nao viram operacao
  const acoA = ((antes && antes.aco) || []).filter(function(x){ return !!x; });
  const acoB = ((depois && depois.aco) || []).filter(function(x){ return !!x; });
  const acoAdd = acoB.filter(function(id){ return acoA.indexOf(id) < 0; });
  const acoDel = acoA.filter(function(id){ return acoB.indexOf(id) < 0; });
  if (acoAdd.length || acoDel.length){
    ops.push({ t: "aco", add: acoAdd, del: acoDel, ts: ts });
  }

  // 5d) ELENCO — o servidor precisa do cadastro para autorizar ACO por SB.
  // Cada perfil envia só as seções que pode gravar (a sua, ou todas se global).
  const elA = {}, elB = {};
  ((antes && antes.mes) || []).forEach(function(m){ elA[m.id] = m; });
  ((depois && depois.mes) || []).forEach(function(m){ elB[m.id] = m; });
  const CAMPOS_EL = ["secao","escala","adm","motorista","restricao","cotasAdm","escalaOrigem","escalaOrigemAdm","afast"];
  const _global = ehMestre();
  const _meu = String(perfilAtual || "");
  Object.keys(elB).forEach(function(id){
    const a = elA[id], b = elB[id];
    if (!_global && String(b.secao) !== _meu) return;   // não é minha seção
    const campos = {};
    let mudou = false;
    CAMPOS_EL.forEach(function(c){
      const va = JSON.stringify(a ? (a[c] === undefined ? null : a[c]) : null);
      const vb = JSON.stringify(b[c] === undefined ? null : b[c]);
      if (va !== vb){ campos[c] = b[c] === undefined ? null : b[c]; mudou = true; }
    });
    if (mudou) ops.push({ t: "elenco", id: id, campos: campos, ts: ts });
  });

  // 5d) metadados (vis e visLinhas NÃO entram aqui: têm operação própria)
  const metaCampos = ["statusMes","autoX","snapshot","params","afastMesclado",
                      "confFixos","removidos","ordemPessoas"];
  const camposMeta = {};
  metaCampos.forEach(function(c){
    if (JSON.stringify(antes ? antes[c] : undefined) !== JSON.stringify(depois[c])) camposMeta[c] = depois[c];
  });
  if (Object.keys(camposMeta).length) ops.push({t:"meta", campos:camposMeta, ts:ts});

  return ops;
}

function aplicarOps(ops){
  if (!ops || !ops.length) return 0;
  let n = 0;
  (_tsLocal = _tsLocal || {});
  ops.forEach(function(op){
    const marcaTs = op.k ? (op.t + ":" + op.k)
                 : op.t === "oficial" ? ("oficial:" + op.dia + ":" + op.turno)
                 : (op.t + ":" + (op.id || op.dia || "meta"));
    if (_tsLocal[marcaTs] && _tsLocal[marcaTs] >= op.ts) return;
    if (op.t === "marca"){
      if (op.v) marks[op.k] = op.v; else delete marks[op.k];
    } else if (op.t === "elenco"){
      const m = D.mes.find(function(x){ return x.id === op.id; });
      if (op.campos === null){ D.mes = D.mes.filter(function(x){ return x.id !== op.id; }); }
      else if (m) Object.assign(m, op.campos);
      else D.mes.push(Object.assign({id:op.id}, op.campos));
    } else if (op.t === "comment"){
      if (op.v) comments[op.k] = op.v; else delete comments[op.k];
    } else if (op.t === "oficial"){
      D.acoOficiais[op.dia] = D.acoOficiais[op.dia] || {t1:"",t2:""};
      D.acoOficiais[op.dia][op.turno] = op.v;
    } else if (op.t === "mov"){
      D.movimentos = D.movimentos || [];
      const idMov = function(m){ return [m.quando,m.tipo,m.origem,m.destino,m.qtd].join("|"); };
      if (!D.movimentos.some(function(m){ return idMov(m) === op.id; })) D.movimentos.push(op.dados);
    } else if (op.t === "meta"){
      Object.keys(op.campos).forEach(function(c){ D[c] = op.campos[c]; });
    } else if (op.t === "aco"){
      let lista = (aco || []).slice();
      (op.add || []).forEach(function(id){ if (lista.indexOf(id) < 0) lista.push(id); });
      (op.del || []).forEach(function(id){ lista = lista.filter(function(x){ return x !== id; }); });
      aco = lista;
    } else if (op.t === "vis"){
      vis = vis || {};
      vis[op.sb] = op.lista || [];
      if (op.linhas != null){
        D.visLinhas = D.visLinhas || {};
        D.visLinhas[op.sb] = op.linhas;
      }
    }
    _tsLocal[marcaTs] = op.ts;
    n++;
  });
  reconstruirIndiceMarcas();
  return n;
}

/* ============================================================================
   F5.3 — TRANSPORTE, SESSÃO E TELA DE PIN
   Único ponto de contato com o servidor.
   - http(s):// → usa fetch() para /api/<rota>
   - file://   → modo local puro (retorna {ok:false, offline:true})
   ========================================================================== */
var ROTAS_API = {
  apiLogin:            { path: "/api/login",            args: ["pin"] },
  apiLogout:           { path: "/api/logout",           args: ["token"] },
  apiBootstrap:        { path: "/api/bootstrap",        args: ["competencia", "token"] },
  apiPull:             { path: "/api/pull",             args: ["competencia", "token", "desdeVersao", "desdeQuando", "limiteMovimentos"] },
  apiPush:             { path: "/api/push",             args: ["competencia", "ops", "token"] },
  apiCriarUsuario:     { path: "/api/criar_usuario",    args: ["token", "nome", "perfil", "pin"] },
  apiListarUsuarios:   { path: "/api/listar_usuarios",  args: ["token"] },
  apiRevogarUsuario:   { path: "/api/revogar_usuario",  args: ["token", "nome"] },
  apiEncerrarSessoes:  { path: "/api/encerrar_sessoes", args: ["token", "nome"] },
  apiRedefinirPin:     { path: "/api/redefinir_pin",    args: ["token", "nome", "pin"] }
};

var Transport = {
  disponivel: function(){
    try { return location.protocol === "http:" || location.protocol === "https:"; }
    catch(e){ return false; }
  },
  call: function(nome, args){
    return new Promise(function(resolve, reject){
      if (!Transport.disponivel()) return resolve({ ok: false, offline: true });
      var rota = ROTAS_API[nome];
      if (!rota){
        console.error("[transport] rota nao mapeada:", nome);
        return resolve({ ok: false, erro: "rota nao mapeada: " + nome });
      }
      var body = {};
      var a = args || [];
      rota.args.forEach(function(k, i){ body[k] = (i < a.length ? a[i] : null); });
      var controller = (typeof AbortController !== "undefined") ? new AbortController() : null;
      var timer = controller ? setTimeout(function(){ controller.abort(); }, 25000) : null;
      fetch(rota.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined
      }).then(function(r){
        if (timer) clearTimeout(timer);
        return r.text().then(function(txt){
          var j = {};
          try { j = JSON.parse(txt); } catch(e){ j = {}; }
          if (!r.ok && !j.erro) j.erro = "HTTP " + r.status;
          resolve(j);
        });
      }).catch(function(e){
        if (timer) clearTimeout(timer);
        reject(e);
      });
    });
  }
};

var Sessao = {
  token: null, perfil: null, nome: null,
  carregar: function(){
    try{
      var j = JSON.parse(localStorage.getItem("escala7gb-sessao") || "null");
      if (j && j.token){ Sessao.token = j.token; Sessao.perfil = j.perfil; Sessao.nome = j.nome; }
    }catch(e){}
    return !!Sessao.token;
  },
  guardar: function(r){
    Sessao.token = r.token; Sessao.perfil = r.perfil; Sessao.nome = r.nome;
    try{ localStorage.setItem("escala7gb-sessao", JSON.stringify({token:r.token, perfil:r.perfil, nome:r.nome})); }catch(e){}
  },
  limpar: function(){
    Sessao.token = null; Sessao.perfil = null; Sessao.nome = null;
    try{ localStorage.removeItem("escala7gb-sessao"); }catch(e){}
  }
};

/* ============================================================================
   F5.3 — ETAPA 4: PULL
   Traz o estado do servidor para o cliente. O servidor passa a ser a fonte
   das marcas; o cadastro (elenco) continua local por enquanto.
   ========================================================================== */
function estadoDoServidor(p){
  var mk = {}, cm = {};
  (p.marcas || []).forEach(function(m){ mk[m.g + "|" + m.i + "|" + m.d] = m.c; });
  (p.comments || []).forEach(function(c){ cm[c.k] = c.v; });
  return {
    marks: mk,
    comments: cm,
    acoOficiais: p.acoOficiais || {},
    movimentos: p.movimentos || [],
    elenco: p.elenco || [], // <--- ADICIONE ESTA LINHA
    statusMes: (p.meta && p.meta.status) || "ativa",
    // ...
    vis: (p.meta && p.meta.vis) || {},
    visLinhas: (p.meta && p.meta.visLinhas) || {},
    aco: (p.meta && p.meta.aco) || []
  };
}

function reaplicarFilaPendenteLocal(ym){
  try{
    if (!Sync || !Array.isArray(Sync.fila) || !Sync.fila.length) return;
    Sync.fila.forEach(function(item){
      if (!item || item.ym !== ym || !Array.isArray(item.ops)) return;
      item.ops.forEach(function(op){
        if (!op) return;
        if (op.t === "marca" && op.k){
          if (op.v === "" || op.v == null){
            delete marks[op.k];
          } else {
            marks[op.k] = op.v;
          }
        } else if (op.t === "comment" && op.k){
          if (op.v === "" || op.v == null){
            delete comments[op.k];
          } else {
            comments[op.k] = op.v;
          }
        } else if (op.t === "vis" && op.sb){
          if (op.lista && op.lista.length){
            vis[op.sb] = op.lista;
          } else {
            delete vis[op.sb];
          }
          if (op.linhas){
            D.visLinhas[op.sb] = op.linhas;
          } else {
            delete D.visLinhas[op.sb];
          }
        } else if (op.t === "aco"){
          if (op.add && op.add.length){
            op.add.forEach(function(id){
              if (aco.indexOf(id) < 0) aco.push(id);
            });
          }
          if (op.del && op.del.length){
            op.del.forEach(function(id){
              var idx = aco.indexOf(id);
              if (idx >= 0) aco.splice(idx, 1);
            });
          }
        } else if (op.t === "elenco" && op.id){
          var m = D.mes.find(function(x){ return String(x.id) === String(op.id); });
          if (op.campos === null){
            if (m) D.mes.splice(D.mes.indexOf(m), 1);
          } else if (op.campos && m){
            Object.keys(op.campos).forEach(function(c){ m[c] = op.campos[c]; });
          }
        }
      });
    });
  }catch(e){
    console.warn("[sync] reaplicar fila pendente:", e);
  }
}


/* Aplica um estado vindo do servidor e persiste.
   Usado no pull inicial e na consulta periódica. */
function aplicarRemoto(remoto, ym){
  Sync.suprimir++;
  try { return _aplicarRemoto(remoto, ym); }
  finally { Sync.suprimir--; }
}
function _aplicarRemoto(remoto, ym){
  var local = null;
  try{ local = JSON.parse(localStorage.getItem("escala7gb-" + ym) || "null"); }catch(e){}

  marks = remoto.marks;
  if (Object.keys(remoto.comments).length) comments = remoto.comments;
  if (Object.keys(remoto.acoOficiais).length) D.acoOficiais = remoto.acoOficiais;
  if (remoto.movimentos && remoto.movimentos.length) {
    var idMov = function(m){ return [m.quando, m.tipo, m.origem, m.destino, m.qtd].join("|"); };
    var mapa = {};
    (D.movimentos || []).forEach(function(m){ mapa[idMov(m)] = m; });
    remoto.movimentos.forEach(function(m){ mapa[idMov(m)] = m; });
    D.movimentos = Object.values(mapa).sort(function(a, b){
      return String(a.quando || "").localeCompare(String(b.quando || ""));
    });
  }
  if (remoto.vis && Object.keys(remoto.vis).length) vis = remoto.vis;
  if (remoto.visLinhas && Object.keys(remoto.visLinhas).length) D.visLinhas = remoto.visLinhas;
  if (remoto.aco && remoto.aco.length) aco = remoto.aco;
  if (remoto.statusMes) statusMes = remoto.statusMes;
  
  // NOVO: Sincroniza o cadastro (D.mes) com os dados do servidor
  if (remoto.elenco && remoto.elenco.length) {
    if (!D.mes) D.mes = [];
    remoto.elenco.forEach(function(rem) {
      var admNorm = (rem.adm === true || String(rem.adm || "").trim().toUpperCase() === "S") ? "S" : "";
      var loc = D.mes.find(function(x) { return x.id === rem.id; });
      if (loc) {
        loc.secao = rem.secao;
        loc.escala = rem.escala;
        loc.motorista = rem.motorista;
        loc.adm = admNorm;
        loc.restricao = rem.restricao;
        loc.cotasAdm = rem.cotasAdm;
        loc.afast = rem.afast;
        loc.escalaOrigem = rem.escalaOrigem;
        loc.escalaOrigemAdm = rem.escalaOrigemAdm;
      } else {
        D.mes.push(Object.assign({}, rem, { adm: admNorm }));
      }
    });
  } else {
    if (local && local.mes) D.mes = local.mes;
  }

  reaplicarFilaPendenteLocal(ym);
  autoX = true;
  reconstruirIndiceMarcas();
  try{ _ultimoSync[ym] = JSON.parse(JSON.stringify(estadoSalvavel())); }catch(e){}
  try{ gravarMes(ym, estadoSalvavel()); }catch(e){ console.error("[sync] gravar pos-pull", e); }
  try{ _tsLocal = {}; }catch(e){}
}

/* ===== consulta periódica: mudanças feitas por outros usuários =====
   5 s com atividade recente · 30 s ocioso · nada com a aba oculta.
   Cada consulta é uma execução no Apps Script: 5 s fixo estouraria a cota. */
var _ultimaInteracao = 0, _ultimaRemotaPorYm = {}, _pollTimer = null, _pollTick = 0;
// Polling otimizado: 30s ativo, 5min ocioso, janela 10min. Evita egress excessivo.
var PULL_ATIVO_MS = 15000, PULL_OCIOSO_TICKS = 12, JANELA_ATIVO_MS = 300000;
function _marcarInteracao(){ _ultimaInteracao = Date.now(); }
document.addEventListener("pointerdown", _marcarInteracao, true);
document.addEventListener("keydown", _marcarInteracao, true);
// FASE 4: Atualização instantânea ao desminimizar ou trocar de aba
document.addEventListener("visibilitychange", function() {
  if (!document.hidden && typeof Sync !== 'undefined' && Sync.ligado) {
    var ym = String(D.competencia).slice(0, 7);
    atualizarDoServidor(ym).catch(function(){});
  }
});


var _pullAtivoPorYm = {};
var _ultimoPullPorYm = {};
const PULL_DEBOUNCE_MS = 2000;

async function atualizarDoServidor(ym, ignorarInteracaoRecente){
  if (!Sync.ligado || document.hidden) return;
  if (Sync.estado === "enviando") return;
  if (Sync.fila.length) return;
  if (!ignorarInteracaoRecente && (Date.now() - _ultimaInteracao < 1000)) return; // Reduzido de 3s para 1s

  // Debounce: se pull recente (< 2s) para mesma competência, retorna promise existente
  var agora = Date.now();
  if (_pullAtivoPorYm[ym]) return _pullAtivoPorYm[ym];
  if (_ultimoPullPorYm[ym] && (agora - _ultimoPullPorYm[ym]) < PULL_DEBOUNCE_MS) {
    return Promise.resolve(false);
  }

  var tsInicioPull = Date.now();
  var versaoAtual = Sync.versaoPorYm[ym] || null;

  var promessa = (async function(){
    try {
      var ultimoMov = (D.movimentos && D.movimentos.length) ? D.movimentos[D.movimentos.length - 1].quando : null;
      var r = await Transport.call("apiPull", [ym, Sessao.token, versaoAtual, ultimoMov]).catch(function(){ return null; });
      if (!r || !r.ok) return;
      if (String(D.competencia).slice(0, 7) !== ym) return;
      if (r.semMudanca){
        var vNow = Sync.versaoPorYm[ym] || null;
        if (r.versao != null && (vNow == null || r.versao > vNow)) Sync.versaoPorYm[ym] = r.versao;
        return;
      }
      if (Sync.estado === "enviando" || Sync.fila.length) return;
      if (_ultimaInteracao > tsInicioPull || (Sync._ultimoPushPorYm && Sync._ultimoPushPorYm[ym] > tsInicioPull)) return;
      if (!r.marcas) return;
      // FIX RACE: comparar com Sync.versaoPorYm[ym] ATUAL, não com cópia capturada antes
      // do await. Se um push local rodou durante o pull, aplicar esse payload
      // regride o estado → tela pisca, marcas "voltam". Regra: só aceita
      // payload ESTRITAMENTE mais novo. Respostas atrasadas são descartadas.
      var versaoAgora = Sync.versaoPorYm[ym] || null;
      var ultimaRemota = _ultimaRemotaPorYm[ym] || 0;
      if (versaoAgora !== null && r.versao < versaoAgora) return;
      if (ultimaRemota > 0 && r.versao === versaoAgora) return;
      aplicarRemoto(estadoDoServidor(r), ym);
      Sync.versaoPorYm[ym] = r.versao;
      _ultimaRemotaPorYm[ym] = Date.now();
      
      // Se o usuário estiver vendo a Auditoria, NÃO redesenha a escala por baixo
      var btnAud = document.getElementById('btnAuditoria');
      if (!btnAud || !btnAud.classList.contains('active')) {
        desenhar();
      }
      
      try{ status("atualizado — outro usuário gravou"); }catch(e){}
      console.log("[sync] atualizado por outro usuário · versao", r.versao);
    } finally {
      delete _pullAtivoPorYm[ym];
      _ultimoPullPorYm[ym] = Date.now();
    }
  })();

  _pullAtivoPorYm[ym] = promessa;
  return promessa;
}

function agendarPoll(ym){
  if (_pollTimer) clearInterval(_pollTimer);
  _pollTick = 0;
  if (!Sync.ligado) return;
  _pollTimer = setInterval(function(){
    _pollTick++;
    if (Sync.estado === "enviando") return;
    // Evita pull concorrente enquanto o usuário acabou de mexer (debounce de push é 1500ms)
    if (_ultimaInteracao && (Date.now() - _ultimaInteracao) < 2000) return;
    var ultimaRemotaYm = _ultimaRemotaPorYm[ym] || 0;
    var recente = (Date.now() - Math.max(_ultimaInteracao, ultimaRemotaYm)) < JANELA_ATIVO_MS;
    if (!recente && (_pollTick % PULL_OCIOSO_TICKS) !== 0) return;
    atualizarDoServidor(ym);
  }, PULL_ATIVO_MS);
}

async function sincronizarMes(ym){
  if (!Transport.disponivel() || !Sessao.token) return false;
  if (Sync.estado === "enviando") return false;

  // Debounce: se pull recente (< 2s) para mesma competência, retorna promise existente
  var agora = Date.now();
  if (_pullAtivoPorYm[ym]) return _pullAtivoPorYm[ym];
  if (_ultimoPullPorYm[ym] && (agora - _ultimoPullPorYm[ym]) < PULL_DEBOUNCE_MS) {
    return Promise.resolve(false);
  }

  var tsInicioPull = Date.now();
  var promessa = (async function(){
    try {
      var versaoAtual = Sync.versaoPorYm[ym] || null;
      var desde = (versaoAtual != null && !Sync.fila.length) ? versaoAtual : null;
      var ultimoMov = (D.movimentos && D.movimentos.length) ? D.movimentos[D.movimentos.length - 1].quando : null;
      var r = await Transport.call("apiPull", [ym, Sessao.token, desde, ultimoMov]).catch(function(){ return null; });
      if (!r || !r.ok){
        window.__sync = { ok: false, motivo: (r && (r.erro || "sem resposta")) || "offline" };
        return false;
      }
      if (String(D.competencia).slice(0, 7) !== ym) return false;

      if (r.semMudanca){
        var vNow = Sync.versaoPorYm[ym] || null;
        if (r.versao != null && (vNow == null || r.versao > vNow)) Sync.versaoPorYm[ym] = r.versao;
        window.__sync = { ok: true, versao: Sync.versaoPorYm[ym], semMudanca: true, quando: new Date().toISOString() };
        return true;
      }

      var versaoAgora = Sync.versaoPorYm[ym] || null;
      if (versaoAgora !== null && r.versao < versaoAgora){
        console.warn("[sync] ignorando pull atrasado — versao", r.versao, "< atual", versaoAgora);
        return true;
      }
      if (_ultimaInteracao > tsInicioPull || (Sync._ultimoPushPorYm && Sync._ultimoPushPorYm[ym] > tsInicioPull)) {
        return false;
      }

      Sync.versaoPorYm[ym] = r.versao;
      aplicarRemoto(estadoDoServidor(r), ym);

      // Servidor sem cadastro: envia o elenco uma vez. Sem ele a ACO por SB é
      // recusada (podeGravarGrupo consulta elencoMap). Só as seções que este
      // perfil pode gravar entram — o diff já filtra.
      // Só envia elenco inicial se o mês tem dados reais (marcas); mês vazio
      // (ex.: outubro) NÃO gera push/versão fantasma.
      if (Sync.ligado && !(r.elenco && r.elenco.length) && Object.keys(marks || {}).length){
        try{
          const atual = estadoSalvavel();
          const semMes = Object.assign({}, atual, { mes: [] });
          const opsEl = diffEstado(semMes, atual).filter(function(o){ return o.t === "elenco"; });
          if (opsEl.length){
            Sync.enfileirar(ym, opsEl);
            console.log("[sync] enviando elenco inicial:", opsEl.length, "militar(es)");
          }
        }catch(e){ console.error("[sync] elenco inicial", e); }
      }

      window.__sync = { ok: true, versao: r.versao, marcas: (r.marcas || []).length, quando: new Date().toISOString() };
      console.log("[sync] pull ok — versao", r.versao, "·", (r.marcas || []).length, "marcas");
      return true;
    } finally {
      delete _pullAtivoPorYm[ym];
      _ultimoPullPorYm[ym] = Date.now();
    }
  })();

  _pullAtivoPorYm[ym] = promessa;
  return promessa;
}

/* Mostra na tela as operações que o servidor recusou. Sem isto, a marca
   desaparece em silêncio e o usuário acha que gravou. */
function mostrarRecusas(){
  var lista = Sync.recusadas || [];
  if (!lista.length) return;
  var velha = document.getElementById("faixaRecusa");
  if (velha) velha.remove();

  var motivos = {};
  lista.forEach(function(x){
    var m = (x && (x.motivo || x.erro)) || "recusado";
    motivos[m] = (motivos[m] || 0) + 1;
  });
  var txt = Object.keys(motivos).map(function(m){ return motivos[m] + "× " + m; }).join(" · ");

  var d = document.createElement("div");
  d.id = "faixaRecusa";
  d.style.cssText = "position:fixed;bottom:0;left:0;right:0;z-index:9998;background:#f8d7da;color:#842029;"
    + "padding:8px 12px;font:600 12.5px system-ui;border-top:3px solid #842029;"
    + "display:flex;gap:10px;align-items:center";
  d.innerHTML = "<span style='flex:1'>" + esc(lista.length) + " operação(ões) recusada(s): " + esc(txt)
    + ". Nada foi gravado — recarregue para ver o estado real.</span>"
    + "<button id='fecharRecusa' style='padding:2px 10px;font-size:12px'>fechar</button>";
  document.body.appendChild(d);
  d.querySelector("#fecharRecusa").onclick = function(){ d.remove(); Sync.recusadas = null; };
  setTimeout(function(){ if (d.parentNode) d.remove(); }, 25000);
}
