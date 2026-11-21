import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Testes 100% offline: o handler real e exercitado com Supabase/HTTP mockados.
# Nunca ha requisicao a URL de producao (evita incrementar LOGIN_TENTATIVAS).


def _chamar(monkeypatch, metodo, corpo, usuarios=None, sessoes=None):
    """Executa Handler.<metodo> com I/O mockado. Retorna (resposta, status, escritas)."""
    import app as api_app

    respostas, escritas = [], []

    def fake_select(tabela, *a, **k):
        if tabela == "usuarios":
            return usuarios or []
        if tabela == "sessoes":
            return sessoes or []
        return []

    monkeypatch.setattr(api_app, "read_body", lambda h: corpo)
    monkeypatch.setattr(api_app, "sb_select", fake_select)
    monkeypatch.setattr(api_app, "sb_request", lambda m, t, **kw: escritas.append((m, t, kw)))
    monkeypatch.setattr(api_app, "json_response", lambda h, c, status=200: respostas.append((c, status)))
    h = object.__new__(api_app.Handler)
    getattr(h, metodo)()
    assert len(respostas) == 1
    return respostas[0][0], respostas[0][1], escritas


@pytest.fixture(autouse=True)
def _sem_rede(monkeypatch):
    import socket

    def _bloqueia(*a, **k):
        raise AssertionError("acesso a rede proibido nos testes offline")

    monkeypatch.setattr(socket.socket, "connect", _bloqueia)


def test_login_pin_invalido(monkeypatch):
    """Backend recusa PIN errado e incrementa o contador apenas no mock local."""
    corpo, status, escritas = _chamar(monkeypatch, "_login", {"pin": "000000"})
    assert status in (401, 403), "O backend deveria recusar um PIN errado"
    assert corpo.get("ok") is False
    assert "erro" in corpo or "tentativas" in corpo
    assert any(t == "propriedades" and kw["body"]["chave"] == "LOGIN_TENTATIVAS" for _, t, kw in escritas)


def test_push_sem_token(monkeypatch):
    """Backend recusa push sem token valido (sessao inexistente no mock)."""
    corpo, status, escritas = _chamar(
        monkeypatch, "_push", {"ops": [], "token": "token_falso_123"}, sessoes=[])
    assert status == 401, "O backend deveria bloquear push sem token valido"
    assert corpo.get("ok") is False
    assert escritas == []


def test_acesso_auditoria_sem_permissao(monkeypatch):
    """Usuario sem token nao acessa os logs de auditoria."""
    corpo, status, _ = _chamar(monkeypatch, "_get_logs", {"token": ""})
    assert status in (401, 403)
    assert corpo.get("ok") is False


# ── Testes unitários (sem rede) — deduplicação do lote no /api/push ──────────
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _rodar_push(monkeypatch, ops):
    import app as api_app

    chamadas = []
    respostas = []
    monkeypatch.setattr(api_app, "read_body", lambda h: {"competencia": "2026-11", "ops": ops, "token": "t"})
    monkeypatch.setattr(api_app, "resolver_token", lambda t: {"perfil": "Admin", "nome": "Adm"})
    monkeypatch.setattr(api_app, "sb_select", lambda *a, **k: [])
    monkeypatch.setattr(api_app, "pode_gravar", lambda *a, **k: True)
    monkeypatch.setattr(api_app, "sb_request", lambda metodo, tabela, **kw: chamadas.append((metodo, tabela, kw)))
    monkeypatch.setattr(api_app, "json_response", lambda h, corpo, status=200: respostas.append((corpo, status)))
    h = object.__new__(api_app.Handler)
    h._push()
    return chamadas, respostas


def test_dedup_rows_mantem_ultimo():
    import app as api_app
    rows = [{"a": 1, "b": 1, "v": "x"}, {"a": 1, "b": 2, "v": "y"}, {"a": 1, "b": 1, "v": "z"}]
    out = api_app.dedup_rows(rows, ("a", "b"))
    assert len(out) == 2
    assert {"a": 1, "b": 1, "v": "z"} in out


def test_push_com_itens_duplicados_nao_gera_21000(monkeypatch):
    ops = [
        # mesma marca por chaves diferentes ("2026-11-05" e "5" -> dia 5)
        {"t": "marca", "k": "1ªSB|1|2026-11-05", "v": "X"},
        {"t": "marca", "k": "1ªSB|1|5", "v": "F"},
        {"t": "comment", "k": "c1", "v": "a"},
        {"t": "comment", "k": "c1", "v": "b"},
        {"t": "elenco", "id": "1", "campos": {"secao": "1ªSB"}},
        {"t": "elenco", "id": "1", "campos": {"escala": "A"}},
        {"t": "oficial", "dia": "5", "turno": "t1", "v": "Cap A"},
        {"t": "oficial", "dia": "5", "turno": "t1", "v": "Cap B"},
    ]
    chamadas, respostas = _rodar_push(monkeypatch, ops)
    assert respostas and respostas[0][1] == 200
    chaves = {
        "marcas": ("competencia", "grupo", "militar_id", "dia"),
        "comments": ("competencia", "chave"),
        "elenco": ("competencia", "militar_id"),
        "aco_oficiais": ("competencia", "dia", "turno"),
    }
    vistos_tabelas = set()
    for metodo, tabela, kw in chamadas:
        if tabela in chaves and metodo == "POST":
            vistos_tabelas.add(tabela)
            body = kw["body"]
            ks = [tuple(str(r[c]) for c in chaves[tabela]) for r in body]
            assert len(ks) == len(set(ks)), f"duplicatas em {tabela}: {ks}"
    assert vistos_tabelas == set(chaves)


def test_pull_normaliza_adm_e_trata_excecao(monkeypatch):
    import app as api_app

    respostas = []
    monkeypatch.setattr(api_app, "read_body", lambda h: {"competencia": "2026-11", "token": "t", "desdeVersao": ""})
    monkeypatch.setattr(api_app, "resolver_token", lambda t: {"perfil": "Admin", "nome": "Adm"})

    def fake_select(tabela, *a, **k):
        if tabela == "meta":
            return [{"versao": 5, "status": "ativa", "extras_json": {}}]
        if tabela == "elenco":
            return [
                {"militar_id": "1", "adm": True, "secao": "1ªSB"},
                {"militar_id": "2", "adm": False, "secao": "2ªSB"},
            ]
        return []

    monkeypatch.setattr(api_app, "sb_select", fake_select)
    monkeypatch.setattr(api_app, "json_response", lambda h, corpo, status=200: respostas.append((corpo, status)))

    h = object.__new__(api_app.Handler)
    h._pull()
    assert respostas and respostas[0][1] == 200
    elenco = respostas[0][0]["elenco"]
    assert elenco[0]["adm"] == "S"
    assert elenco[1]["adm"] == ""

    # Erro interno no Supabase retorna JSON estruturado em vez de exceção não tratada
    respostas.clear()
    monkeypatch.setattr(api_app, "sb_select", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("falha rede")))
    h._pull()
    assert respostas and respostas[0][1] == 500
    assert respostas[0][0]["ok"] is False
    assert "falha rede" in respostas[0][0]["erro"]


def _rodar_get(path):
    import io
    import app as api_app

    status_box = []
    headers = {}
    wfile = io.BytesIO()

    h = object.__new__(api_app.Handler)
    h.path = path
    h.wfile = wfile
    h.send_response = lambda code: status_box.append(code)
    h.send_header = lambda k, v: headers.__setitem__(k.lower(), v)
    h.end_headers = lambda: None
    h.do_GET()
    return status_box[0], headers, wfile.getvalue().decode("utf-8")


def test_get_sync_js_retorna_javascript_nao_html():
    status, headers, body = _rodar_get("/sync.js")
    assert status == 200
    assert headers.get("content-type", "").startswith("application/javascript")
    assert not body.lstrip().startswith("<")
    assert "var Transport" in body and "const Sync" in body


def test_get_storage_js_retorna_javascript_nao_html():
    status, headers, body = _rodar_get("/storage.js")
    assert status == 200
    assert headers.get("content-type", "").startswith("application/javascript")
    assert not body.lstrip().startswith("<")
    assert "function gravarMes" in body and "function carregarEstado" in body


def test_get_regras_js_retorna_javascript_nao_html():
    status, headers, body = _rodar_get("/regras.js")
    assert status == 200
    assert headers.get("content-type", "").startswith("application/javascript")
    assert not body.lstrip().startswith("<")
    assert "function contagemSB" in body and "function calcularTotalizadoresDiaSB" in body


def test_get_raiz_retorna_html():
    status, headers, body = _rodar_get("/")
    assert status == 200
    assert headers.get("content-type", "").startswith("text/html")
    tag_storage = '<script src="storage.js"></script>'
    tag_regras = '<script src="regras.js"></script>'
    tag_sync = '<script src="sync.js"></script>'
    assert tag_storage in body
    assert tag_regras in body
    assert tag_sync in body
    assert body.index(tag_storage) < body.index(tag_regras) < body.index(tag_sync)


def _rodar_push_ctx(monkeypatch, ops, perfil="Admin", nome="Adm", meta_rows=None, marcas_rows=None):
    import app as api_app

    chamadas = []
    respostas = []
    monkeypatch.setattr(api_app, "read_body", lambda h: {"competencia": "2026-11", "ops": ops, "token": "t"})
    monkeypatch.setattr(api_app, "resolver_token", lambda t: {"perfil": perfil, "nome": nome})

    def fake_select(tabela, *a, **k):
        if tabela == "meta":
            return meta_rows if meta_rows is not None else []
        if tabela == "marcas":
            return marcas_rows if marcas_rows is not None else []
        return []

    monkeypatch.setattr(api_app, "sb_select", fake_select)
    monkeypatch.setattr(api_app, "pode_gravar", lambda *a, **k: True)
    monkeypatch.setattr(api_app, "sb_request", lambda metodo, tabela, **kw: chamadas.append((metodo, tabela, kw)))
    monkeypatch.setattr(api_app, "json_response", lambda h, corpo, status=200: respostas.append((corpo, status)))
    h = object.__new__(api_app.Handler)
    h._push()
    return chamadas, respostas


def test_push_em_competencia_fechada_retorna_423_sem_escritas(monkeypatch):
    meta = [{"versao": 3, "status": "ativa", "extras_json": {"fechada": True}}]
    chamadas, respostas = _rodar_push_ctx(
        monkeypatch,
        [{"t": "marca", "k": "1ªSB|1|5", "v": "X"}],
        perfil="Mestre",
        meta_rows=meta,
    )
    assert respostas and respostas[0][1] == 423
    assert respostas[0][0]["ok"] is False
    assert respostas[0][0]["fechada"] is True
    assert chamadas == []


def test_push_reabrir_competencia_exige_admin_e_lote_puro(monkeypatch):
    meta = [{"versao": 3, "status": "ativa", "extras_json": {"fechada": True}}]
    c1, r1 = _rodar_push_ctx(
        monkeypatch, [{"t": "fechamento", "fechada": False}], perfil="Mestre", meta_rows=meta
    )
    assert r1[0][1] == 423 and c1 == []

    c2, r2 = _rodar_push_ctx(
        monkeypatch,
        [{"t": "fechamento", "fechada": False}, {"t": "marca", "k": "1ªSB|1|5", "v": "X"}],
        perfil="Admin",
        meta_rows=meta,
    )
    assert r2[0][1] == 423 and c2 == []

    c3, r3 = _rodar_push_ctx(
        monkeypatch, [{"t": "fechamento", "fechada": False}], perfil="Admin", meta_rows=meta
    )
    assert r3[0][1] == 200 and r3[0][0]["ok"] is True
    meta_posts = [kw["body"] for m, t, kw in c3 if m == "POST" and t == "meta"]
    assert meta_posts and meta_posts[0]["extras_json"]["fechada"] is False
    logs_posts = [kw["body"] for m, t, kw in c3 if m == "POST" and t == "logs_acesso"]
    assert any(l["acao"] == "reabrir_competencia" for l in logs_posts)


def test_fechar_competencia_apenas_admin(monkeypatch):
    c_mestre, r_mestre = _rodar_push_ctx(
        monkeypatch, [{"t": "fechamento", "fechada": True}], perfil="Mestre"
    )
    assert r_mestre[0][1] == 200
    assert r_mestre[0][0]["aplicadas"] == 0
    assert r_mestre[0][0]["recusadas"]
    assert not any(t == "meta" for _, t, _ in c_mestre)

    c_adm, r_adm = _rodar_push_ctx(
        monkeypatch, [{"t": "fechamento", "fechada": True}], perfil="Admin"
    )
    assert r_adm[0][1] == 200
    assert r_adm[0][0]["aplicadas"] == 1
    meta_posts = [kw["body"] for m, t, kw in c_adm if m == "POST" and t == "meta"]
    assert meta_posts and meta_posts[0]["extras_json"]["fechada"] is True
    logs_posts = [kw["body"] for m, t, kw in c_adm if m == "POST" and t == "logs_acesso"]
    assert any(l["acao"] == "fechar_competencia" for l in logs_posts)


def test_push_registra_log_edicao_anterior_e_novo(monkeypatch):
    import json
    marcas = [{"competencia": "2026-11", "grupo": "1ªSB", "militar_id": "1", "dia": 5, "codigo": "X"}]
    chamadas, respostas = _rodar_push_ctx(
        monkeypatch,
        [{"t": "marca", "k": "1ªSB|1|5", "v": "F"}],
        perfil="Admin",
        nome="Cap Silva",
        marcas_rows=marcas,
    )
    assert respostas[0][1] == 200
    logs = [kw["body"] for m, t, kw in chamadas if m == "POST" and t == "logs_acesso"]
    edicoes = [l for l in logs if l["acao"] == "edicao"]
    assert len(edicoes) == 1
    det = json.loads(edicoes[0]["detalhes"])
    assert det == {"competencia": "2026-11", "grupo": "1ªSB", "militar_id": "1", "dia": 5, "de": "X", "para": "F"}


def test_get_logs_filtra_por_competencia(monkeypatch):
    import json
    import app as api_app

    respostas = []
    monkeypatch.setattr(api_app, "read_body", lambda h: {"token": "t", "competencia": "2026-11"})
    monkeypatch.setattr(api_app, "resolver_token", lambda t: {"perfil": "Mestre", "nome": "M"})
    monkeypatch.setattr(api_app, "sb_select", lambda *a, **k: [
        {"acao": "edicao", "detalhes": json.dumps({"competencia": "2026-11", "de": "X", "para": "F"})},
        {"acao": "edicao", "detalhes": json.dumps({"competencia": "2026-10", "de": "", "para": "X"})},
        {"acao": "login", "detalhes": ""},
    ])
    monkeypatch.setattr(api_app, "json_response", lambda h, c, status=200: respostas.append((c, status)))
    h = object.__new__(api_app.Handler)
    h._get_logs()
    assert respostas[0][1] == 200
    logs = respostas[0][0]["logs"]
    assert len(logs) == 1
    assert '"2026-11"' in logs[0]["detalhes"]


def test_pull_retorna_flag_fechada_em_meta(monkeypatch):
    import app as api_app

    respostas = []
    monkeypatch.setattr(api_app, "read_body", lambda h: {"competencia": "2026-11", "token": "t", "desdeVersao": ""})
    monkeypatch.setattr(api_app, "resolver_token", lambda t: {"perfil": "Admin", "nome": "Adm"})
    monkeypatch.setattr(
        api_app,
        "sb_select",
        lambda tabela, *a, **k: (
            [{"versao": 2, "status": "ativa", "extras_json": {"fechada": True, "fechada_por": "Adm"}}]
            if tabela == "meta"
            else []
        ),
    )
    monkeypatch.setattr(api_app, "json_response", lambda h, corpo, status=200: respostas.append((corpo, status)))
    h = object.__new__(api_app.Handler)
    h._pull()
    assert respostas[0][1] == 200
    assert respostas[0][0]["meta"]["fechada"] is True
    assert respostas[0][0]["meta"]["fechadaPor"] == "Adm"



def test_pull_devolve_dia_da_marca_como_chave_iso(monkeypatch):
    """Banco guarda só o número do dia; o pull devolve AAAA-MM-DD (chave do frontend)."""
    import app as api_app

    respostas = []
    monkeypatch.setattr(api_app, "read_body", lambda h: {"competencia": "2026-11", "token": "t"})
    monkeypatch.setattr(api_app, "resolver_token", lambda t: {"perfil": "Admin", "nome": "Adm"})

    def fake_select(tabela, *a, **k):
        if tabela == "meta":
            return [{"versao": 3, "status": "ativa", "extras_json": {}}]
        if tabela == "marcas":
            return [
                {"grupo": "1ªSB", "militar_id": "1", "dia": 5, "codigo": "X"},
                {"grupo": "1ªSB", "militar_id": "2", "dia": "7", "codigo": "F"},
                {"grupo": "1ªSB", "militar_id": "3", "dia": "2026-11-09", "codigo": "N"},
            ]
        return []

    monkeypatch.setattr(api_app, "sb_select", fake_select)
    monkeypatch.setattr(api_app, "json_response", lambda h, c, status=200: respostas.append((c, status)))
    object.__new__(api_app.Handler)._pull()
    dias = {m["i"]: m["d"] for m in respostas[0][0]["marcas"]}
    assert dias == {"1": "2026-11-05", "2": "2026-11-07", "3": "2026-11-09"}


def test_push_apaga_marca_pelo_numero_do_dia(monkeypatch):
    chamadas, _ = _rodar_push_ctx(
        monkeypatch,
        [{"t": "marca", "k": "1ªSB|1|2026-11-05", "v": "", "ts": 1}],
        marcas_rows=[{"grupo": "1ªSB", "militar_id": "1", "dia": 5, "codigo": "X"}],
    )
    dels = [kw for m, t, kw in chamadas if m == "DELETE" and t == "marcas"]
    assert dels and dels[0]["params"]["dia"] == "eq.5"


def test_push_concorrente_5_usuarios_preserva_deltas_e_incrementa_versao(monkeypatch):
    """Simula 5 envios na mesma competência com estado persistente em memória."""
    import app as api_app

    db = {
        "meta": [{"competencia": "2026-11", "status": "ativa", "params_json": None, "extras_json": {}, "versao": 1}],
        "marcas": [],
        "comments": [],
        "elenco": [],
        "aco_oficiais": [],
        "logs_acesso": [],
    }
    usuarios_tok = {
        "tok-adm": {"perfil": "Admin", "nome": "Cap Admin"},
        "tok-1sb": {"perfil": "1ªSB", "nome": "Sgt Carpina"},
        "tok-2sb": {"perfil": "2ªSB", "nome": "Sgt Goiana"},
        "tok-3sb": {"perfil": "3ªSB", "nome": "Sgt Macaparana"},
        "tok-4sb": {"perfil": "4ªSB", "nome": "Sgt Surubim"},
    }

    def fake_select(tabela, params=None, *a, **k):
        rows = db.get(tabela, [])
        if isinstance(params, dict) and "competencia" in params:
            comp = params["competencia"]
            return [dict(r) for r in rows if r.get("competencia") == comp]
        return [dict(r) for r in rows]

    def fake_request(metodo, tabela, body=None, params=None, **kw):
        if metodo == "POST":
            itens = body if isinstance(body, list) else [body]
            if tabela == "marcas":
                existentes = {(r["competencia"], r["grupo"], r["militar_id"], int(r["dia"])): r for r in db["marcas"]}
                for item in itens:
                    chave = (item["competencia"], item["grupo"], item["militar_id"], int(item["dia"]))
                    existentes[chave] = dict(item)
                db["marcas"] = list(existentes.values())
            elif tabela == "meta":
                comp = itens[0]["competencia"]
                db["meta"] = [r for r in db["meta"] if r.get("competencia") != comp] + [dict(itens[0])]
            elif tabela == "logs_acesso":
                db["logs_acesso"].extend(dict(x) for x in itens)
        elif metodo == "DELETE" and tabela == "marcas" and isinstance(params, dict):
            comp = str(params.get("competencia", "")).removeprefix("eq.")
            grp = str(params.get("grupo", "")).removeprefix("eq.")
            mid = str(params.get("militar_id", "")).removeprefix("eq.")
            dia = str(params.get("dia", "")).removeprefix("eq.")
            db["marcas"] = [
                r for r in db["marcas"]
                if not (r["competencia"] == comp and r["grupo"] == grp and r["militar_id"] == mid and str(r["dia"]) == dia)
            ]

    monkeypatch.setattr(api_app, "resolver_token", lambda t: usuarios_tok.get(t))
    monkeypatch.setattr(api_app, "sb_select", fake_select)
    monkeypatch.setattr(api_app, "sb_request", fake_request)

    lotes = [
        ("tok-1sb", [{"t": "marca", "k": "1ªSB|707305-4|2026-11-05", "v": "X"}]),
        ("tok-adm", [{"t": "marca", "k": "1ªSB|707305-4|2026-11-09", "v": "PJ"}]),
        ("tok-2sb", [
            {"t": "vis", "sb": "2ªSB", "lista": ["707155-8"], "linhas": 12},
            {"t": "marca", "k": "host:2ªSB|707155-8|2026-11-12", "v": "PJ"},
        ]),
        ("tok-3sb", [{"t": "marca", "k": "3ªSB|707155-8|2026-11-07", "v": "X"}]),
        ("tok-4sb", [{"t": "marca", "k": "4ªSB|704203-5|2026-11-08", "v": "F"}]),
    ]

    versoes = []
    for tok, ops in lotes:
        respostas = []
        monkeypatch.setattr(api_app, "read_body", lambda h, tok=tok, ops=ops: {"competencia": "2026-11", "ops": ops, "token": tok})
        monkeypatch.setattr(api_app, "json_response", lambda h, corpo, status=200, respostas=respostas: respostas.append((corpo, status)))
        object.__new__(api_app.Handler)._push()
        assert len(respostas) == 1
        corpo, status = respostas[0]
        assert status == 200
        assert corpo["ok"] is True
        assert corpo["recusadas"] == []
        versoes.append(corpo["versao"])

    assert versoes == [2, 3, 4, 5, 6]
    assert db["meta"][0]["versao"] == 6
    assert db["meta"][0]["extras_json"]["vis"]["2ªSB"] == ["707155-8"]
    marcas_finais = {(r["grupo"], r["militar_id"], int(r["dia"])): r["codigo"] for r in db["marcas"]}
    assert marcas_finais == {
        ("1ªSB", "707305-4", 5): "X",
        ("1ªSB", "707305-4", 9): "PJ",
        ("host:2ªSB", "707155-8", 12): "PJ",
        ("3ªSB", "707155-8", 7): "X",
        ("4ªSB", "704203-5", 8): "F",
    }
