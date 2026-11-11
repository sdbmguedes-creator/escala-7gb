from http.server import BaseHTTPRequestHandler
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from supabase_client import sb_select, sb_request
from utils import json_response, read_body


def resolver_token(token):
    if not token:
        return None
    try:
        sessoes = sb_select("sessoes", {"token": token, "ativo": "true"})
    except Exception:
        return None
    if not sessoes:
        return None
    return {"perfil": sessoes[0].get("perfil"), "nome": sessoes[0].get("nome")}


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_POST(self):
        corpo = read_body(self)
        u = resolver_token(corpo.get("token", ""))
        if not u or u["perfil"] != "Admin":
            json_response(self, {"ok": False, "erro": "não autorizado (apenas Admin)"}, 403)
            return

        nome = corpo.get("nome")
        if not nome:
            json_response(self, {"ok": False, "erro": "Informe o nome do usuário."}, 400)
            return

        # Verificar se é Admin e se é o último Admin
        alvo = sb_select("usuarios", {"nome": nome})
        if not alvo:
            json_response(self, {"ok": False, "erro": "usuário não encontrado"}, 404)
            return
        alvo = alvo[0]

        if alvo.get("perfil") == "Admin":
            admins = sb_select("usuarios", {"perfil": "Admin", "ativo": "true"}) or []
            if len(admins) <= 1:
                json_response(self, {"ok": False, "erro": "não é possível revogar o último Admin ativo"}, 400)
                return

        sb_request("POST", "usuarios", body={"nome": nome, "ativo": False}, extra_headers={"Prefer": "resolution=merge-duplicates"})
        sb_request("DELETE", "sessoes", {"nome": nome})

        json_response(self, {"ok": True})
