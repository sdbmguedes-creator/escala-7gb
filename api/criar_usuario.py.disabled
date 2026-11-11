from http.server import BaseHTTPRequestHandler
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from supabase_client import sb_select, sb_request
from utils import json_response, read_body
import hashlib
import uuid


PERFIS_VALIDOS = ["Admin", "Mestre", "1ªSB", "2ªSB", "3ªSB", "4ªSB"]


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

        nome = str(corpo.get("nome", "")).strip()
        perfil = corpo.get("perfil")
        pin = corpo.get("pin", "")

        if not nome:
            json_response(self, {"ok": False, "erro": "Informe o nome."}, 400)
            return
        if perfil not in PERFIS_VALIDOS:
            json_response(self, {"ok": False, "erro": f"Perfil inválido. Use: {', '.join(PERFIS_VALIDOS)}"}, 400)
            return
        if not (str(pin).isdigit() and len(str(pin)) == 6):
            json_response(self, {"ok": False, "erro": "PIN deve ter 6 dígitos."}, 400)
            return

        # Apagar se já existir e recriar (upsert simples)
        try:
            sb_request("DELETE", "usuarios", {"nome": nome})
        except Exception:
            pass

        salt = uuid.uuid4().hex
        sb_request("POST", "usuarios", body={
            "nome": nome,
            "perfil": perfil,
            "pin_hash": hash_pin(pin, salt),
            "salt": salt,
            "ativo": True,
            "tentativas": 0,
            "bloqueado_ate": None,
        })

        json_response(self, {"ok": True, "nome": nome, "perfil": perfil, "pin": pin})
