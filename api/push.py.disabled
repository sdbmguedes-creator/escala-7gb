from http.server import BaseHTTPRequestHandler
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from supabase_client import sb_select, sb_request, sb_upsert, sb_delete
from utils import json_response, read_body
from datetime import datetime, timezone

LIMITE_DELETES = 60


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


def pode_gravar(perfil, grupo, militar_id, elenco_map):
    if perfil in ("Admin", "Mestre"):
        return True
    g = str(grupo)
    if g == "ACO":
        m2 = elenco_map.get(militar_id)
        return bool(m2 and str(m2.get("secao")) == str(perfil))
    alvo = g[4:] if g.startswith("ADM:") else (g[5:] if g.startswith("host:") else g)
    return alvo == perfil


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
        ops = corpo.get("ops", [])
        token = corpo.get("token", "")

        u = resolver_token(token)
        if not u:
            json_response(self, {"ok": False, "erro": "token inválido"}, 401)
            return

        perfil = u["perfil"]

        # Carregar estado atual da competencia
        elenco_rows = sb_select("elenco", {"competencia": competencia}) or []
        elenco_map = {e["militar_id"]: e for e in elenco_rows}

        marcas_rows = sb_select("marcas", {"competencia": competencia}) or []
        marcas_map = {}
        for m in marcas_rows:
            marcas_map[f"{m['grupo']}|{m['militar_id']}|{m['dia']}"] = m

        comentarios_rows = sb_select("comments", {"competencia": competencia}) or []
        comentarios_map = {}
        for c in comentarios_rows:
            comentarios_map[c["chave"]] = c

        aco_rows = sb_select("aco_oficiais", {"competencia": competencia}) or []
        aco_map = {}
        for r in aco_rows:
            aco_map.setdefault(r["dia"], {"t1": "", "t2": ""})[r["turno"]] = r.get("oficial", "")

        recusadas = []
        aplicadas = 0
        deletadas = 0

        agora = datetime.now(timezone.utc).isoformat()

        # Elenco primeiro (autoriza ACO)
        lista = sorted(ops, key=lambda op: 0 if (op and op.get("t") == "elenco") else 1)

        for op in lista:
            motivo = ""
            if not op or not op.get("t"):
                motivo = "op sem tipo"
            elif op["t"] == "marca":
                k = op.get("k", "")
                p = str(k).split("|")
                if len(p) < 3:
                    motivo = "chave de marca inválida"
                elif not pode_gravar(perfil, p[0], p[1], elenco_map):
                    motivo = f"perfil {perfil} não pode gravar em {p[0]}"
                else:
                    if op.get("v") not in (None, ""):
                        marcas_map[k] = {
                            "competencia": competencia,
                            "grupo": p[0],
                            "militar_id": p[1],
                            "dia": p[2],
                            "codigo": op["v"],
                            "ts": agora,
                            "autor": u["nome"],
                        }
                    else:
                        if k in marcas_map:
                            del marcas_map[k]
                            deletadas += 1
                    aplicadas += 1
            elif op["t"] == "comment":
                k = op.get("k", "")
                if not k:
                    motivo = "comment sem chave"
                else:
                    if op.get("v") not in (None, ""):
                        comentarios_map[k] = {
                            "competencia": competencia,
                            "chave": k,
                            "texto": op["v"],
                            "ts": agora,
                            "autor": u["nome"],
                        }
                    else:
                        comentarios_map.pop(k, None)
                    aplicadas += 1
            elif op["t"] == "aco":
                aco_add = [x for x in (op.get("add") or []) if x]
                aco_del = [x for x in (op.get("del") or []) if x]
                fora = []
                for id_ in aco_add + aco_del:
                    mm = elenco_map.get(id_)
                    if perfil not in ("Admin", "Mestre") and not (
                        mm and str(mm.get("secao")) == str(perfil)
                    ):
                        fora.append(id_)
                if aco_add or aco_del:
                    if fora:
                        motivo = "sem permissão para ACO de: " + ", ".join(fora[:3])
                    else:
                        # atualiza aco_oficiais simples: aqui só registramos tentativa
                        # (aco_oficiais é salvo via endpoint separado ou mesmo push com tipo oficial)
                        aplicadas += 1
                else:
                    aplicadas += 1
            elif op["t"] == "elenco":
                mid = op.get("id")
                if not mid:
                    motivo = "elenco sem id"
                else:
                    campos = op.get("campos") or {}
                    base = dict(elenco_map.get(mid, {"competencia": competencia, "militar_id": mid}))
                    secao_alvo = campos.get("secao") or base.get("secao") or ""
                    if perfil not in ("Admin", "Mestre") and str(secao_alvo) != str(perfil):
                        motivo = f"perfil {perfil} não pode definir elenco de {secao_alvo}"
                    else:
                        for k2, v in campos.items():
                            if k2 == "afast":
                                base["afast_json"] = v if v is not None else []
                            else:
                                base[k2] = v
                        base["competencia"] = competencia
                        base["militar_id"] = mid
                        elenco_map[mid] = base
                        aplicadas += 1
            elif op["t"] == "mov":
                d = op.get("dados") or {}
                sb_request("POST", "movimentos", body={
                    "competencia": competencia,
                    "quando": d.get("quando", ""),
                    "tipo": d.get("tipo", ""),
                    "origem": d.get("origem", ""),
                    "destino": d.get("destino", ""),
                    "qtd": d.get("qtd", 0),
                    "motivo": d.get("motivo", ""),
                    "autor": d.get("autor") or u["nome"],
                })
                aplicadas += 1
            elif op["t"] == "oficial":
                dia = op.get("dia", "")
                turno = op.get("turno", "")
                oficial = op.get("v", "") or ""
                if not dia or not turno:
                    motivo = "oficial sem dia/turno"
                else:
                    aco_map.setdefault(dia, {"t1": "", "t2": ""})[turno] = oficial
                    aplicadas += 1
            elif op["t"] == "meta":
                campos_meta = op.get("campos") or {}
                if perfil not in ("Admin", "Mestre"):
                    motivo = "meta exige Mestre ou Admin"
                else:
                    aplicadas += 1
            else:
                motivo = f"tipo desconhecido: {op.get('t')}"

            if motivo:
                recusadas.append({"t": op.get("t"), "motivo": motivo})

        if deletadas > LIMITE_DELETES:
            json_response(
                self,
                {
                    "ok": False,
                    "fatal": True,
                    "aplicadas": 0,
                    "recusadas": recusadas,
                    "erro": f"Lote recusado: apagaria {deletadas} marcas (limite {LIMITE_DELETES})",
                },
                400,
            )
            return

        # Regrava marcas (delete + insert)
        try:
            sb_delete("marcas", {"competencia": competencia})
        except Exception:
            pass
        if marcas_map:
            sb_request("POST", "marcas", body=list(marcas_map.values()))

        # Regrava comentarios
        try:
            sb_delete("comments", {"competencia": competencia})
        except Exception:
            pass
        if comentarios_map:
            sb_request("POST", "comments", body=list(comentarios_map.values()))

        # Regrava elenco
        try:
            sb_delete("elenco", {"competencia": competencia})
        except Exception:
            pass
        if elenco_map:
            sb_request("POST", "elenco", body=list(elenco_map.values()))

        # Regrava aco_oficiais
        try:
            sb_delete("aco_oficiais", {"competencia": competencia})
        except Exception:
            pass
        if aco_map:
            aco_rows_out = []
            for dia, turnos in aco_map.items():
                for turno in ("t1", "t2"):
                    aco_rows_out.append({
                        "competencia": competencia,
                        "dia": dia,
                        "turno": turno,
                        "oficial": turnos.get(turno, ""),
                    })
            if aco_rows_out:
                sb_request("POST", "aco_oficiais", body=aco_rows_out)

        json_response(self, {"ok": True, "versao": 1, "aplicadas": aplicadas, "recusadas": recusadas})
