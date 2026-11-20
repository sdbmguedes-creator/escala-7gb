import io
import gzip
import json
import pytest
from utils import json_response


class FakeHandler:
    def __init__(self, headers=None, broken_pipe=False, connection_reset=False):
        self.headers = headers or {}
        self.status = None
        self.response_headers = {}
        self.wfile = io.BytesIO()
        self.broken_pipe = broken_pipe
        self.connection_reset = connection_reset

        if broken_pipe or connection_reset:
            def raise_write(data):
                if self.broken_pipe:
                    raise BrokenPipeError("[Errno 32] Broken pipe")
                raise ConnectionResetError("[Errno 104] Connection reset by peer")
            self.wfile.write = raise_write

    def send_response(self, status):
        self.status = status

    def send_header(self, key, value):
        self.response_headers[key] = value

    def end_headers(self):
        pass


def test_json_response_normal():
    handler = FakeHandler()
    data = {"ok": True, "msg": "teste"}
    json_response(handler, data, 200)

    assert handler.status == 200
    assert handler.response_headers.get("Content-Type") == "application/json; charset=utf-8"
    assert json.loads(handler.wfile.getvalue().decode("utf-8")) == data


def test_json_response_gzip():
    handler = FakeHandler(headers={"Accept-Encoding": "gzip, deflate"})
    data = {"itens": ["a" * 100 for _ in range(50)]}
    json_response(handler, data, 200)

    assert handler.response_headers.get("Content-Encoding") == "gzip"
    decompressed = gzip.decompress(handler.wfile.getvalue()).decode("utf-8")
    assert json.loads(decompressed) == data


def test_json_response_broken_pipe():
    handler = FakeHandler(broken_pipe=True)
    # Não deve lançar BrokenPipeError
    json_response(handler, {"teste": 123}, 200)


def test_json_response_connection_reset():
    handler = FakeHandler(connection_reset=True)
    # Não deve lançar ConnectionResetError
    json_response(handler, {"teste": 123}, 200)
