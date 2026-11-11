from http.server import BaseHTTPRequestHandler
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from supabase_client import sb_select, sb_request
from utils import json_response, read_body
import hashlib
import uuid


def hash_pin(pin, salt):
    return hashlib.sha256((salt + str(pin)).encode("utf-8")).hexdigest()


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
        pin = corpo.get("pin", "")
        if not (str(pin).isdigit() and len(str(pin)) == 6):
            json_response(self, {"ok": False, "erro": "PIN deve ter 6 dígitos."}, 400)
            return

        alvo = sb_select("usuarios", {"nome": nome})
        if not alvo:
            json_response(self, {"ok": False, "erro": "usuário não encontrado"}, 404)
            return

        salt = uuid.uuid4().hex
        sb_request(
            "POST",
            "usuarios",
            body={
                "pin_hash": hash_pin(pin, salt),
                "salt": salt,
                "ativo": True,
                "tentativas": 0,
                "bloqueado_ate": None,
            },
            extra_headers={"Prefer": f"resolution=merge-duplicates, update={nome}"},
        )

        json_response(self, {"ok": True})
