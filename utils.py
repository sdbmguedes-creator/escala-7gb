import gzip
import json


def json_response(handler, dados, status=200):
    """Envia resposta JSON com CORS habilitado e GZIP quando suportado."""
    corpo = json.dumps(dados, ensure_ascii=False).encode("utf-8")
    accept_enc = ""
    try:
        accept_enc = str(handler.headers.get("Accept-Encoding") or "").lower()
    except Exception:
        accept_enc = ""

    usou_gzip = False
    if "gzip" in accept_enc and len(corpo) > 1024:
        corpo = gzip.compress(corpo, compresslevel=6)
        usou_gzip = True

    try:
        handler.send_response(status)
        handler.send_header("Content-Type", "application/json; charset=utf-8")
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.send_header("Access-Control-Allow-Headers", "Content-Type")
        handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        if usou_gzip:
            handler.send_header("Content-Encoding", "gzip")
        handler.send_header("Content-Length", str(len(corpo)))
        handler.end_headers()
        handler.wfile.write(corpo)
    except (BrokenPipeError, ConnectionResetError):
        # Cliente fechou a conexão antes de receber a resposta (abort/timeout/refresh)
        pass


def read_body(handler):
    """Lê o corpo JSON da requisição."""
    tamanho = int(handler.headers.get("Content-Length", 0) or 0)
    if tamanho == 0:
        return {}
    bruto = handler.rfile.read(tamanho)
    return json.loads(bruto.decode("utf-8"))
