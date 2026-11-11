from http.server import BaseHTTPRequestHandler
import os, sys, json, hashlib, uuid, datetime
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from supabase_client import sb_select, sb_request, sb_upsert, sb_delete
from utils import json_response, read_body


# ============================================================
# Helpers compartilhados
# ============================================================

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


def pode_gravar(perfil, grupo, militar_id, elenco_map):
    if perfil in ("Admin", "Mestre"):
        return True
    g = str(grupo)
    if g == "ACO":
        m2 = elenco_map.get(militar_id)
        return bool(m2 and str(m2.get("secao")) == str(perfil))
    alvo = g[4:] if g.startswith("ADM:") else (g[5:] if g.startswith("host:") else g)
    return alvo == perfil


PERFIS_VALIDOS = ["Admin", "Mestre", "1ªSB", "2ªSB", "3ªSB", "4ªSB"]
LIMITE_DELETES = 60


# ============================================================
# Handler único com roteamento por path
# ============================================================

class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/" or path == "" or path == "index_v14.html":
            self._serve_index()
            return
        # Qualquer outro GET serve o SPA (favicon, etc. caem aqui)
        self._serve_index()

    # ---------- index ----------
    def _serve_index(self):
        html_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "index_v14.html",
        )
        try:
            with open(html_path, "r", encoding="utf-8") as f:
                conteudo = f.read()
        except FileNotFoundError:
            json_response(self, {"ok": False, "erro": "index_v14.html nao encontrado"}, 404)
            return
        corpo = conteudo.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    # ---------- dispatch POST ----------
    def do_POST(self):
        path = self.path.split("?")[0]
        if path.startswith("/api/"):
            path = path[len("/api/"):]
        elif path == "/api":
            path = ""

        rotas = {
            "/setup_inicial": self._setup_inicial,
            "/login": self._login,
            "/logout": self._logout,
            "/criar_usuario": self._criar_usuario,
            "/listar_usuarios": self._listar_usuarios,
            "/revogar_usuario": self._revogar_usuario,
            "/encerrar_sessoes": self._encerrar_sessoes,
            "/pull": self._pull,
            "/push": self._push,
            "/redefinir_pin": self._redefinir_pin,
        }

        handler = rotas.get(path)
        if handler:
            handler()
        else:
            json_response(self, {"ok": False, "erro": "rota nao encontrada"}, 404)

    # ---------- endpoints ----------

    def _setup_inicial(self):
        corpo = read_body(self)
        pin = corpo.get("pin", "")
        if not (str(pin).isdigit() and len(str(pin)) == 6):
            json_response(self, {"ok": False, "erro": "PIN deve ter 6 dígitos"}, 400)
            return

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

    def _login(self):
        corpo = read_body(self)
        pin = corpo.get("pin", "")

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

        try:
            sb_request(
                "POST",
                "propriedades",
                body={"chave": "LOGIN_TENTATIVAS", "valor": "0"},
                extra_headers={"Prefer": "resolution=merge-duplicates"},
            )
        except Exception:
            pass

        token = uuid.uuid4().hex + uuid.uuid4().hex
        expira = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=30)).isoformat()
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

    def _logout(self):
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
                sb_request("DELETE", "sessoes", {"token": token})
            except Exception:
                pass
        json_response(self, {"ok": True})

    def _criar_usuario(self):
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

    def _listar_usuarios(self):
        corpo = read_body(self)
        u = resolver_token(corpo.get("token", ""))
        if not u or u["perfil"] != "Admin":
            json_response(self, {"ok": False, "erro": "não autorizado (apenas Admin)"}, 403)
            return

        usuarios = sb_select("usuarios") or []
        out = []
        for x in usuarios:
            out.append({
                "nome": x.get("nome"),
                "perfil": x.get("perfil"),
                "ativo": bool(x.get("ativo")),
                "temPin": bool(x.get("pin_hash")),
                "sessoes": 0,
                "ultimo": "",
            })

        json_response(self, {"ok": True, "usuarios": out, "totalSessoes": 0})

    def _revogar_usuario(self):
        corpo = read_body(self)
        u = resolver_token(corpo.get("token", ""))
        if not u or u["perfil"] != "Admin":
            json_response(self, {"ok": False, "erro": "não autorizado (apenas Admin)"}, 403)
            return

        nome = corpo.get("nome")
        if not nome:
            json_response(self, {"ok": False, "erro": "Informe o nome do usuário."}, 400)
            return

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

    def _encerrar_sessoes(self):
        corpo = read_body(self)
        u = resolver_token(corpo.get("token", ""))
        if not u or u["perfil"] != "Admin":
            json_response(self, {"ok": False, "erro": "não autorizado (apenas Admin)"}, 403)
            return

        nome = corpo.get("nome")
        if nome:
            sb_request("DELETE", "sessoes", {"nome": nome})
        else:
            sb_request("DELETE", "sessoes", {})

        json_response(self, {"ok": True})

    def _pull(self):
        corpo = read_body(self)
        competencia = corpo.get("competencia", "2026-11")[:7]
        token = corpo.get("token", "")
        desde = corpo.get("desdeVersao")

        u = resolver_token(token)
        if not u:
            json_response(self, {"ok": False, "erro": "token inválido"}, 401)
            return

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

    def _push(self):
        corpo = read_body(self)
        competencia = corpo.get("competencia", "2026-11")[:7]
        ops = corpo.get("ops", [])
        token = corpo.get("token", "")

        u = resolver_token(token)
        if not u:
            json_response(self, {"ok": False, "erro": "token inválido"}, 401)
            return

        perfil = u["perfil"]

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
        agora = datetime.datetime.now(datetime.timezone.utc).isoformat()

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

        try:
            sb_delete("marcas", {"competencia": competencia})
        except Exception:
            pass
        if marcas_map:
            sb_request("POST", "marcas", body=list(marcas_map.values()))

        try:
            sb_delete("comments", {"competencia": competencia})
        except Exception:
            pass
        if comentarios_map:
            sb_request("POST", "comments", body=list(comentarios_map.values()))

        try:
            sb_delete("elenco", {"competencia": competencia})
        except Exception:
            pass
        if elenco_map:
            sb_request("POST", "elenco", body=list(elenco_map.values()))

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

    def _redefinir_pin(self):
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
