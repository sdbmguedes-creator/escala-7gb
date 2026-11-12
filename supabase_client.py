import os
import json
import urllib.request
import urllib.error
import urllib.parse


SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_ANON_KEY", "")


def sb_request(method, path, params=None, body=None, extra_headers=None):
    """Faz requisição REST para o Supabase."""
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    if params:
        qs = urllib.parse.urlencode(params)
        url += "?" + qs

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    if extra_headers:
        headers.update(extra_headers)

    data = json.dumps(body).encode("utf-8") if body is not None else None

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            if r.status == 204:
                return None
            txt = r.read().decode("utf-8")
            return json.loads(txt) if txt else None
    except urllib.error.HTTPError as e:
        corpo = e.read().decode("utf-8")
        raise Exception(f"Supabase {e.code}: {corpo}")
    except Exception as e:
        raise Exception(f"Erro ao contatar Supabase: {e}")


def sb_select(path, filters=None, order=None, limit=None):
    """Busca linhas via PostgREST.

    PostgREST tem limite default de 1000 linhas por requisição (max-rows).
    Se `limit` for None (sem limite) ou > 1000, pagina automaticamente
    com offset para buscar TODAS as linhas.

    - limit=None       → pagina até esgotar (retorna tudo)
    - limit <= 1000    → single request (comportamento antigo)
    - limit > 1000     → pagina em lotes de 1000 até atingir `limit`
    """
    base_params = {}
    if filters:
        for k, v in filters.items():
            base_params[k] = f"eq.{v}"
    if order:
        base_params["order"] = order

    # Limite pequeno explícito — single request
    if limit is not None and limit <= 1000:
        base_params["limit"] = str(limit)
        return sb_request("GET", path, params=base_params)

    # Sem limite OU limite grande — pagina
    page_size = 1000
    offset = 0
    todas = []
    while True:
        params = dict(base_params)
        params["limit"] = str(page_size)
        params["offset"] = str(offset)
        lote = sb_request("GET", path, params=params) or []
        todas.extend(lote)
        if len(lote) < page_size:
            break
        offset += page_size
        if limit is not None and len(todas) >= limit:
            todas = todas[:limit]
            break
    return todas


def sb_upsert(path, rows):
    if not rows:
        return None
    return sb_request("POST", path, body=rows)


def sb_delete(path, filters):
    params = {}
    for k, v in filters.items():
        params[k] = f"eq.{v}"
    return sb_request("DELETE", path, params=params)
