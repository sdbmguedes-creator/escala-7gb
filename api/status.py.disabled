from http.server import BaseHTTPRequestHandler
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from supabase_client import sb_select
from utils import json_response, read_body


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        try:
            marcas = sb_select("marcas", limit=1) or []
            total = len(marcas)
        except Exception:
            total = 0
        json_response(self, {"ok": True, "servidor": "ok", "marcas": total})

    def do_POST(self):
        self.do_GET()
