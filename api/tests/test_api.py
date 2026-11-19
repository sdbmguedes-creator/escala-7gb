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