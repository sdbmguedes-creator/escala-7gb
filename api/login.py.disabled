from http.server import BaseHTTPRequestHandler
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from supabase_client import sb_select, sb_request
from utils import json_response, read_body
import hashlib
import uuid
from datetime import datetime, timedelta, timezone


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

        # throttle simples via propriedades
        try:
            tent_rows = sb_select("propriedades", {"chave": "LOGIN_TENTATIVAS"})
            n = int(tent_rows[0]["valor"]) if tent_rows else 0
        except Exception:
            n = 0

        if n >= 10:
            json_response(
                self, {"ok": False, "erro": "bloqueado por muitas tentativas (tente daqui a alguns minutos)"}, 403
            )
            return

        # Buscar todos usuários ativos e comparar hash (Supabase não faz hash server-side)
        usuarios = sb_select("usuarios", {"ativo": "true"}) or []
        alvo = None
        for u in usuarios:
            if hash_pin(pin, u.get("salt", "")) == u.get("pin_hash", ""):
                alvo = u
                break

        if not alvo:
            novo_n = n + 1
            try:
                sb_request(
                    "POST",
                    "propriedades",
                    body={"chave": "LOGIN_TENTATIVAS", "valor": str(novo_n)},
                    extra_headers={"Prefer": "resolution=merge-duplicates"},
                )
            except Exception:
                pass
            json_response(
                self,
                {"ok": False, "erro": "PIN inválido", "tentativas": novo_n},
                401,
            )
            return

        # limpar tentativas
        try:
            sb_request(
                "POST",
                "propriedades",
                body={"chave": "LOGIN_TENTATIVAS", "valor": "0"},
                extra_headers={"Prefer": "resolution=merge-duplicates"},
            )
        except Exception:
            pass

        # criar sessão de 30 dias
        token = uuid.uuid4().hex + uuid.uuid4().hex
        expira = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        sb_request("POST", "sessoes", body={
            "token": token,
            "perfil": alvo["perfil"],
            "nome": alvo["nome"],
            "expira_em": expira,
            "ativo": True,
        })

        json_response(
            self, {"ok": True, "token": token, "perfil": alvo["perfil"], "nome": alvo["nome"]}
        )
