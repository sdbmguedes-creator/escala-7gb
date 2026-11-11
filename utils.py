import json


def json_response(handler, dados, status=200):
    """Envia resposta JSON com CORS habilitado."""
    corpo = json.dumps(dados, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Content-Length", str(len(corpo)))
    handler.end_headers()
    handler.wfile.write(corpo)


def read_body(handler):
    """Lê o corpo JSON da requisição."""
    tamanho = int(handler.headers.get("Content-Length", 0) or 0)
    if tamanho == 0:
        return {}
    bruto = handler.rfile.read(tamanho)
    return json.loads(bruto.decode("utf-8"))
