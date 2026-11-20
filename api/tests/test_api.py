import requests
import pytest

# URL de produção. (Se quiser testar antes de subir, pode usar 'http://localhost:3000')
BASE_URL = "https://escala-7gb.vercel.app/api"

def test_login_pin_invalido():
    """Testa se o backend bloqueia tentativas de login com PIN errado."""
    res = requests.post(f"{BASE_URL}/login", json={"pin": "000000"})
    assert res.status_code in (401, 403), "O backend deveria recusar um PIN errado"
    json_data = res.json()
    assert json_data.get("ok") is False
    assert "erro" in json_data or "tentativas" in json_data

def test_push_sem_token():
    """Testa se o backend recusa um envio de dados (push) sem token válido."""
    res = requests.post(f"{BASE_URL}/push", json={"ops": [], "token": "token_falso_123"})
    assert res.status_code == 401, "O backend deveria bloquear push sem token válido"
    assert res.json().get("ok") is False

def test_acesso_auditoria_sem_permissao():
    """Testa se um usuário não logado consegue ver os logs de auditoria."""
    # Tenta acessar a rota de logs sem enviar token
    res = requests.post(f"{BASE_URL}/logs", json={"token": ""})
    assert res.status_code == 401 or res.status_code == 403
    assert res.json().get("ok") is False

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
