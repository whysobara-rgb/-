"""Read-only, loopback-only server for the compiled Flutter review bundle."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import webbrowser

ROOT = Path(__file__).resolve().parent / "web"
CSP = "; ".join([
    "default-src 'self' data: blob:", "script-src 'self' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'", "connect-src 'self'",
    "img-src 'self' data: blob:", "font-src 'self' data:",
    "worker-src 'self' blob:", "frame-ancestors 'none'", "form-action 'none'",
])


class ReviewHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def list_directory(self, path):
        self.send_error(403)

    def end_headers(self):
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8765), ReviewHandler)
    print("GachiGacha review: http://127.0.0.1:8765 (this PC only; Ctrl+C to stop)", flush=True)
    webbrowser.open("http://127.0.0.1:8765")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
