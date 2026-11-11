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
    s = sessoes[0]
    return {"perfil": s.get("perfil"), "nome": s.get("nome")}


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
        desde = corpo.get("desdeVersao")

        u = resolver_token(token)
        if not u:
            json_response(self, {"ok": False, "erro": "token inválido"}, 401)
            return

        # meta
        meta_rows = sb_select("meta", {"competencia": competencia}) or []
        versao = meta_rows[0].get("versao", 0) if meta_rows else 0
        extras = meta_rows[0].get("extras_json") or {} if meta_rows else {}

        if desde is not None and str(desde) == str(versao):
            json_response(self, {"ok": True, "versao": versao, "semMudanca": True})
            return

        marcas = sb_select("marcas", {"competencia": competencia}) or []
        marcas_out = [
            {"g": m["grupo"], "i": m["militar_id"], "d": m["dia"], "c": m["codigo"]}
            for m in marcas
        ]

        comentarios = sb_select("comments", {"competencia": competencia}) or []
        comentarios_out = [{"k": c["chave"], "v": c["texto"]} for c in comentarios]

        elenco = sb_select("elenco", {"competencia": competencia}) or []
        elenco_out = []
        for e in elenco:
            elenco_out.append({
                "id": e["militar_id"],
                "secao": e.get("secao", ""),
                "escala": e.get("escala", ""),
                "motorista": e.get("motorista", ""),
                "adm": e.get("adm", ""),
                "restricao": bool(e.get("restricao")),
                "cotasAdm": int(e.get("cotas_adm") or 0),
                "afast": e.get("afast_json") or [],
                "escalaOrigem": e.get("escala_origem", ""),
                "escalaOrigemAdm": e.get("escala_origem_adm", ""),
            })

        aco_rows = sb_select("aco_oficiais", {"competencia": competencia}) or []
        aco_oficiais = {}
        for r in aco_rows:
            aco_oficiais.setdefault(r["dia"], {"t1": "", "t2": ""})[r["turno"]] = r.get("oficial", "")

        mov = sb_select("movimentos", {"competencia": competencia}) or []
        movimentos = [
            {
                "quando": m["quando"],
                "tipo": m["tipo"],
                "origem": m["origem"],
                "destino": m["destino"],
                "qtd": m["qtd"],
                "motivo": m["motivo"],
                "autor": m["autor"],
            }
            for m in mov
        ]

        meta = {
            "competencia": competencia,
            "versao": versao,
            "status": meta_rows[0].get("status", "ativa") if meta_rows else "ativa",
            "params": meta_rows[0].get("params_json") if meta_rows else None,
            "vis": extras.get("vis", {}),
            "aco": extras.get("aco", []),
        }

        json_response(
            self,
            {
                "ok": True,
                "versao": versao,
                "marcas": marcas_out,
                "comments": comentarios_out,
                "elenco": elenco_out,
                "acoOficiais": aco_oficiais,
                "movimentos": movimentos,
                "meta": meta,
            },
        )
