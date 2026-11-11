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
    params = {}
    if filters:
        for k, v in filters.items():
            params[k] = f"eq.{v}"
    if order:
        params["order"] = order
    if limit:
        params["limit"] = str(limit)
    return sb_request("GET", path, params=params)


def sb_upsert(path, rows):
    if not rows:
        return None
    return sb_request("POST", path, body=rows)


def sb_delete(path, filters):
    params = {}
    for k, v in filters.items():
        params[k] = f"eq.{v}"
    return sb_request("DELETE", path, params=params)
