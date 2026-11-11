from http.server import BaseHTTPRequestHandler
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from supabase_client import sb_select
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
        competencia = corpo.get("competencia", "2026-11")[:7]
        token = corpo.get("token", "")

        u = resolver_token(token)
        if not u:
            json_response(self, {"ok": False, "erro": "token inválido"}, 401)
            return

        meta_rows = sb_select("meta", {"competencia": competencia}) or []
        extras = meta_rows[0].get("extras_json") or {} if meta_rows else {}
        params = meta_rows[0].get("params_json") if meta_rows else None

        oficiais = sb_select("oficiais", {"ativo": "true"}) or []
        oficiais_lista = [o["nome"] for o in oficiais]

        meta = {
            "competencia": competencia,
            "versao": meta_rows[0].get("versao", 0) if meta_rows else 0,
            "status": meta_rows[0].get("status", "ativa") if meta_rows else "ativa",
            "params": params,
            "vis": extras.get("vis", {}),
            "aco": extras.get("aco", []),
        }

        json_response(
            self,
            {
                "ok": True,
                "usuario": {"nome": u["nome"], "perfil": u["perfil"]},
                "meta": meta,
                "oficiais": oficiais_lista,
            },
        )
