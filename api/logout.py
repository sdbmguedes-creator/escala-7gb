from http.server import BaseHTTPRequestHandler
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from supabase_client import sb_select, sb_request
from utils import json_response, read_body


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_POST(self):
        corpo = read_body(self)
        token = corpo.get("token", "")

        if token:
            try:
                sb_request(
                    "POST",
                    "sessoes",
                    body={"ativo": False},
                    extra_headers={"Prefer": f'resolution=merge-duplicates, return=minimal'},
                )
                # Supabase não suporta update filtrado por token direto via POST simples.
                # Fazemos delete do token específico:
                sb_request("DELETE", "sessoes", {"token": token})
            except Exception:
                pass

        json_response(self, {"ok": True})
