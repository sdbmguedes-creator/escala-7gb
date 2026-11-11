from http.server import BaseHTTPRequestHandler
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from supabase_client import sb_request, sb_select
from utils import json_response, read_body
import hashlib
import uuid


def hash_pin(pin, salt):
    return hashlib.sha256((salt + str(pin)).encode("utf-8")).hexdigest()


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_POST(self):
        corpo = read_body(self)
        pin = corpo.get("pin", "")
        if not (str(pin).isdigit() and len(str(pin)) == 6):
            json_response(self, {"ok": False, "erro": "PIN deve ter 6 dígitos"}, 400)
            return

        # Verificar se já inicializado
        try:
            existente = sb_select("propriedades", {"chave": "ADMIN_PIN_HASH"})
        except Exception:
            existente = []

        if existente:
            json_response(
                self,
                {"ok": False, "erro": "Servidor já inicializado. Use redefinir_pin para trocar o PIN do Admin."},
                400,
            )
            return

        salt = uuid.uuid4().hex
        ph = hash_pin(pin, salt)

        sb_request("POST", "propriedades", body={"chave": "ADMIN_PIN_HASH", "valor": ph})
        sb_request("POST", "propriedades", body={"chave": "ADMIN_SALT", "valor": salt})
        sb_request("POST", "propriedades", body={"chave": "SCHEMA_VER", "valor": "1"})
        sb_request("POST", "usuarios", body={
            "nome": "Admin",
            "perfil": "Admin",
            "pin_hash": ph,
            "salt": salt,
            "ativo": True,
            "tentativas": 0,
            "bloqueado_ate": None,
        })

        json_response(self, {"ok": True, "perfil": "Admin"})
