"""Local browser UI for TTJCore. Run with Python 3.10 or newer."""
import argparse
import hashlib
import hmac
import html
import json
import os
import secrets
import shlex
import shutil
import struct
import subprocess
import sys
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

READ = {
    "project.list",
    "project.snapshot",
    "ticket.snapshot",
    "worker.list",
    "session.list",
    "knowledge.get",
    "knowledge.list",
    "events.wait",
}
MANAGE = {
    "project.create",
    "project.update",
    "project.delete",
    "task.create",
    "task.update",
    "task.delete",
    "task.purge",
    "ticket.create",
    "ticket.update",
    "ticket.delete",
    "worker.create",
    "worker.update",
    "worker.delete",
    "session.create",
    "session.update",
    "session.delete",
    "knowledge.create",
    "knowledge.update",
    "knowledge.delete",
    "status.set",
}
EXECUTE = {"run.start", "run.finish", "run.progress"}
WRITE = MANAGE | EXECUTE
HTML_ROUTES = {"/", "/tree", "/kanban", "/list", "/timeline", "/settings"}
PUBLIC_AUTH_ASSETS = {
    "/style.css",
    "/favicon.ico",
    "/assets/app-icon.png",
    "/assets/app-icon-light.png",
    "/assets/app-icon-white.png",
    "/assets/app-icon-black.png",
}
SESSION_COOKIE_NAME = "ttjweb_session"

STATIC = {
    "/": ("index.html", "text/html"),
    "/tree": ("index.html", "text/html"),
    "/kanban": ("index.html", "text/html"),
    "/list": ("index.html", "text/html"),
    "/timeline": ("index.html", "text/html"),
    "/settings": ("index.html", "text/html"),
    "/app.js": ("app.js", "text/javascript"),
    "/view-model.mjs": ("view-model.mjs", "text/javascript"),
    "/style.css": ("style.css", "text/css"),
    "/favicon.ico": ("assets/app-icon.png", "image/x-icon"),
    "/icons/back.svg": ("icons/back.svg", "image/svg+xml"),
    "/icons/book.svg": ("icons/book.svg", "image/svg+xml"),
    "/icons/close.svg": ("icons/close.svg", "image/svg+xml"),
    "/icons/edit.svg": ("icons/edit.svg", "image/svg+xml"),
    "/icons/execute.svg": ("icons/execute.svg", "image/svg+xml"),
    "/icons/filter.svg": ("icons/filter.svg", "image/svg+xml"),
    "/icons/fit.svg": ("icons/fit.svg", "image/svg+xml"),
    "/icons/folder.svg": ("icons/folder.svg", "image/svg+xml"),
    "/icons/kanban.svg": ("icons/kanban.svg", "image/svg+xml"),
    "/icons/list.svg": ("icons/list.svg", "image/svg+xml"),
    "/icons/minus.svg": ("icons/minus.svg", "image/svg+xml"),
    "/icons/moon.svg": ("icons/moon.svg", "image/svg+xml"),
    "/icons/plus.svg": ("icons/plus.svg", "image/svg+xml"),
    "/icons/refresh.svg": ("icons/refresh.svg", "image/svg+xml"),
    "/icons/reset.svg": ("icons/reset.svg", "image/svg+xml"),
    "/icons/review.svg": ("icons/review.svg", "image/svg+xml"),
    "/icons/save.svg": ("icons/save.svg", "image/svg+xml"),
    "/icons/search.svg": ("icons/search.svg", "image/svg+xml"),
    "/icons/session.svg": ("icons/session.svg", "image/svg+xml"),
    "/icons/settings.svg": ("icons/settings.svg", "image/svg+xml"),
    "/icons/status.svg": ("icons/status.svg", "image/svg+xml"),
    "/icons/sun.svg": ("icons/sun.svg", "image/svg+xml"),
    "/icons/task.svg": ("icons/task.svg", "image/svg+xml"),
    "/icons/ticket.svg": ("icons/ticket.svg", "image/svg+xml"),
    "/icons/timeline.svg": ("icons/timeline.svg", "image/svg+xml"),
    "/icons/trash.svg": ("icons/trash.svg", "image/svg+xml"),
    "/icons/tree.svg": ("icons/tree.svg", "image/svg+xml"),
    "/assets/app-icon.png": ("assets/app-icon.png", "image/png"),
    "/assets/app-icon-light.png": ("assets/app-icon-light.png", "image/png"),
    "/assets/app-icon-white.png": ("assets/app-icon-white.png", "image/png"),
    "/assets/app-icon-black.png": ("assets/app-icon-black.png", "image/png"),
    "/assets/octicons/checklist-16.svg": ("assets/octicons/checklist-16.svg", "image/svg+xml"),
    "/assets/octicons/mark-github-16.svg": ("assets/octicons/mark-github-16.svg", "image/svg+xml"),
    "/assets/octicons/star-16.svg": ("assets/octicons/star-16.svg", "image/svg+xml"),
    "/assets/octicons/tag-16.svg": ("assets/octicons/tag-16.svg", "image/svg+xml"),
}


def normalize_allow_hosts(values=None, env_value=None):
    """Normalize CLI/env allow-host entries into a sorted tuple of lowercase host[:port]."""
    raw_items = []
    if env_value:
        raw_items.append(env_value)
    if values:
        if isinstance(values, str):
            raw_items.append(values)
        else:
            raw_items.extend(values)
    normalized = set()
    for item in raw_items:
        if not item:
            continue
        for part in str(item).split(","):
            host = part.strip().lower()
            if host:
                normalized.add(host)
    return tuple(sorted(normalized))


def _safe_next_path(value):
    if not isinstance(value, str) or not value.startswith("/") or value.startswith("//"):
        return "/"
    return value


def render_login_page(error_message="", next_path="/"):
    safe_next = html.escape(_safe_next_path(next_path), quote=True)
    error_html = (
        f'<p id="login-error" class="error-inline" role="alert">{html.escape(error_message)}</p>'
        if error_message
        else '<p id="login-error" class="error-inline" role="alert" hidden></p>'
    )
    return f"""<!doctype html>
<html lang="ja" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TTJWeb · 認証</title>
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="512x512" href="/assets/app-icon-light.png">
<link rel="stylesheet" href="/style.css">
<style>
  html, body {{
    overflow: auto;
    min-height: 100%;
  }}
  .auth-stage {{
    min-height: 100vh;
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px 16px;
    background: var(--bg);
  }}
  .auth-card {{
    width: 100%;
    max-width: 380px;
    padding: 24px 20px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow-modal);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }}
  .auth-head {{
    display: flex;
    align-items: center;
    gap: 10px;
  }}
  .auth-head h1 {{
    margin: 0;
    font-size: 17px;
    font-weight: 800;
    color: var(--fg);
  }}
  .auth-desc {{
    margin: 0;
    font-size: 12.5px;
    color: var(--muted);
    line-height: 1.6;
  }}
  .auth-form {{
    display: flex;
    flex-direction: column;
    gap: 12px;
  }}
  .auth-form label {{
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
  }}
  .auth-form input[type="password"] {{
    width: 100%;
    min-height: 44px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--fg);
    font-size: 16px;
  }}
  .auth-submit {{
    width: 100%;
    min-height: 44px;
    font-size: 14px;
    border-radius: 6px;
  }}
  .auth-card .error-inline {{
    margin: 0;
  }}
</style>
</head>
<body>
<main class="auth-stage">
  <section class="auth-card" aria-labelledby="auth-title">
    <div class="auth-head">
      <img src="/assets/app-icon-light.png" width="28" height="28" alt="">
      <h1 id="auth-title">TTJWeb にサインイン</h1>
    </div>
    <p class="auth-desc">この TTJWeb サーバーはトークン認証が有効です。アクセストークンを入力して続行してください。</p>
    {error_html}
    <form id="login-form" class="auth-form" method="post" action="/api/auth/login">
      <input type="hidden" name="next" value="{safe_next}">
      <label>
        <span>アクセストークン</span>
        <input id="token-input" name="token" type="password" autocomplete="current-password" placeholder="トークンを入力" required autofocus>
      </label>
      <button id="login-submit" type="submit" class="btn primary auth-submit">ログイン</button>
    </form>
  </section>
</main>
<script>
(() => {{
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const saved = (() => {{ try {{ return localStorage.getItem("ttjweb-theme"); }} catch {{ return null; }} }})();
  const theme = saved === "dark" || (saved !== "light" && prefersDark) ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  const form = document.getElementById("login-form");
  const errorEl = document.getElementById("login-error");
  const submitBtn = document.getElementById("login-submit");
  form.addEventListener("submit", async event => {{
    event.preventDefault();
    errorEl.hidden = true;
    submitBtn.disabled = true;
    try {{
      const token = document.getElementById("token-input").value;
      const res = await fetch("/api/auth/login", {{
        method: "POST",
        headers: {{ "Content-Type": "application/json" }},
        body: JSON.stringify({{ token }}),
      }});
      const data = await res.json().catch(() => ({{}}));
      if (!res.ok) {{
        errorEl.textContent = data.error || "認証に失敗しました。";
        errorEl.hidden = false;
        return;
      }}
      const next = form.querySelector('input[name="next"]')?.value || "/";
      location.replace(next.startsWith("/") && !next.startsWith("//") ? next : "/");
    }} catch {{
      errorEl.textContent = "通信エラーが発生しました。接続状態を確認してください。";
      errorEl.hidden = false;
    }} finally {{
      submitBtn.disabled = false;
    }}
  }});
}})();
</script>
</body>
</html>
""".encode("utf-8")


class CoreError(Exception):
    def __init__(self, message, code=-32000):
        super().__init__(message)
        self.code = code


class CoreClient:
    def __init__(self, executable, home, actor):
        self.executable = executable
        self.home = home
        self.actor = actor

    def invoke(self, method, params):
        command = [self.executable]
        if self.home:
            command += ["--home", self.home]
        command += ["rpc"]
        request = {"jsonrpc": "2.0", "protocol": "TTJ/1.1.0", "id": "web", "method": method, "params": params}
        try:
            result = subprocess.run(command, input=json.dumps(request, ensure_ascii=False) + "\n", capture_output=True, text=True, encoding="utf-8", timeout=35)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise CoreError("TTJCoreへ接続できません。指定profileのCoreを起動してください。") from error
        try:
            response = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise CoreError(result.stderr.strip() or "TTJCoreの応答を読み取れません。") from error
        if "error" in response:
            raise CoreError(response["error"]["message"], response["error"]["code"])
        if result.returncode or "result" not in response:
            raise CoreError("TTJCoreの呼び出しに失敗しました。")
        value = response["result"]
        return value.get("value", value)

    def watch_prefix(self):
        command = [self.executable]
        if self.home:
            command += ["--home", self.home]
        distro = os.environ.get("WSL_DISTRO_NAME")
        if distro:
            command = ["wsl", "-d", distro, "--", *command]
        if sys.platform == "win32" or distro:
            return "& " + " ".join("'" + part.replace("'", "''") + "'" for part in command)
        return shlex.join(command)

    def check(self):
        methods = {entry["name"] for entry in self.invoke("rpc.discover", {})["methods"]}
        if not {"run.progress", "ticket.snapshot"} <= methods:
            raise CoreError("進捗API対応版のTTJCoreが必要です。--coreと--homeを確認してください。")

    def request(self, method, params):
        if method not in READ | MANAGE | EXECUTE:
            raise CoreError("この操作はTTJWebから利用できません。", -32601)
        params = dict(params)
        params.pop("actor", None)
        params.pop("mode", None)
        if method in READ:
            return self.invoke(method, params)
        if method == "task.purge":
            reason = params.get("reason")
            if not isinstance(reason, str) or not reason.strip():
                params.pop("reason", None)
            else:
                params["reason"] = reason.strip()
        else:
            reason = params.get("reason")
            if not isinstance(reason, str) or not reason.strip():
                params["reason"] = "TTJWeb: " + method
            else:
                params["reason"] = reason.strip()
        if method in MANAGE:
            params.update(actor=[self.actor], mode="management")
        else:
            ticket_id = params.pop("ticket_id", None)
            if not isinstance(ticket_id, str) or not ticket_id:
                raise CoreError("実行対象のTicketが必要です。", -32602)
            snapshot = self.invoke("ticket.snapshot", {"id": ticket_id})
            ticket = snapshot["ticket"]["record"]
            job, run = snapshot["job"], snapshot["run"]
            if method == "run.start":
                valid = job and params.get("job") == job["record"]["id"]
            else:
                valid = run and run["active"] and params.get("id") == run["record"]["id"]
            if not valid:
                raise CoreError("対象のJob・Runが変わっています。最新の状態を確認してください。", -32009)
            params["actor"] = [ticket["worker_id"], ticket["session_id"]]
            params["mode"] = "execution"
        return self.invoke(method, params)


def png_to_ico(png_bytes):
    return struct.pack("<HHHBBBBHHII", 0, 1, 1, 0, 0, 0, 0, 1, 32, len(png_bytes), 22) + png_bytes


def make_handler(client, *, allow_hosts=(), auth_token=None, read_only=False):
    normalized_allow_hosts = normalize_allow_hosts(allow_hosts)
    allow_hosts_set = set(normalized_allow_hosts)
    configured_token = auth_token if isinstance(auth_token, str) and auth_token else None
    read_only_mode = bool(read_only)
    session_secret = secrets.token_bytes(32)
    expected_cookie = (
        hmac.new(session_secret, configured_token.encode("utf-8"), hashlib.sha256).hexdigest()
        if configured_token
        else None
    )

    class Handler(BaseHTTPRequestHandler):
        def send(self, status, body, content_type="application/json", cache_control="no-store", extra_headers=None):
            if not isinstance(body, bytes):
                body = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            if content_type.startswith("text/") or content_type in {"application/json", "image/svg+xml"}:
                self.send_header("Content-Type", content_type + "; charset=utf-8")
            else:
                self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", cache_control)
            self.send_header("X-Content-Type-Options", "nosniff")
            if extra_headers:
                for key, value in extra_headers:
                    self.send_header(key, value)
            try:
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

        def normalized_host(self):
            return (self.headers.get("Host") or "").strip().lower()

        def is_loopback_host(self, host=None):
            h = self.normalized_host() if host is None else host
            port = self.server.server_address[1]
            return h in {f"127.0.0.1:{port}", f"localhost:{port}"}

        def is_allowed_extra_host(self, host=None):
            h = self.normalized_host() if host is None else host
            return bool(h) and h in allow_hosts_set

        def valid_host(self):
            h = self.normalized_host()
            return bool(h) and (self.is_loopback_host(h) or self.is_allowed_extra_host(h))

        def valid_origin(self):
            host = self.normalized_host()
            origin = (self.headers.get("Origin") or "").strip().lower()
            if not host or not origin:
                return False
            if self.is_loopback_host(host):
                return origin == f"http://{host}"
            if self.is_allowed_extra_host(host):
                return origin in {f"https://{host}", f"http://{host}"}
            return False

        def is_https_request(self):
            forwarded = (self.headers.get("X-Forwarded-Proto") or "").split(",")[0].strip().lower()
            if forwarded == "https":
                return True
            origin = (self.headers.get("Origin") or "").strip().lower()
            return origin.startswith("https://")

        def is_authenticated(self):
            if not configured_token:
                return True
            auth_header = (self.headers.get("Authorization") or "").strip()
            if auth_header.lower().startswith("bearer "):
                supplied = auth_header[7:].strip()
                if hmac.compare_digest(supplied.encode("utf-8"), configured_token.encode("utf-8")):
                    return True
            cookie_header = self.headers.get("Cookie") or ""
            if cookie_header:
                jar = SimpleCookie()
                try:
                    jar.load(cookie_header)
                except Exception:
                    return False
                morsel = jar.get(SESSION_COOKIE_NAME)
                if morsel and hmac.compare_digest(morsel.value.encode("utf-8"), expected_cookie.encode("utf-8")):
                    return True
            return False

        def session_cookie_header(self, value, max_age=None):
            parts = [f"{SESSION_COOKIE_NAME}={value}", "Path=/", "HttpOnly", "SameSite=Lax"]
            if max_age is not None:
                parts.append(f"Max-Age={max_age}")
            if self.is_https_request():
                parts.append("Secure")
            return "; ".join(parts)

        def meta_payload(self):
            return {
                "actor": client.actor,
                "protocol": "TTJ/1.1.0",
                "watch_prefix": client.watch_prefix(),
                "allowHosts": list(normalized_allow_hosts),
                "readOnly": read_only_mode,
                "authEnabled": bool(configured_token),
            }

        def do_GET(self):
            if not self.valid_host():
                self.send(403, {"error": "許可されたホストアドレスで接続してください。"})
                return
            path = urlsplit(self.path).path
            if configured_token and not self.is_authenticated():
                if path in HTML_ROUTES:
                    self.send(200, render_login_page(next_path=self.path), "text/html", cache_control="no-store")
                    return
                if path not in PUBLIC_AUTH_ASSETS:
                    self.send(
                        401,
                        {"error": "認証が必要です。"},
                        extra_headers=[("WWW-Authenticate", 'Bearer realm="TTJWeb"')],
                    )
                    return

            if path in {"/api/meta", "/api/config"}:
                self.send(200, self.meta_payload())
            elif path in STATIC:
                filename, content_type = STATIC[path]
                data = (Path(__file__).parent / "static" / filename).read_bytes()
                if path == "/favicon.ico":
                    data = png_to_ico(data)
                cache_control = "public, max-age=300" if content_type.startswith("image/") else "no-store"
                self.send(200, data, content_type, cache_control=cache_control)
            else:
                self.send(404, {"error": "Not found"})

        def _handle_auth_login(self):
            content_type = self.headers.get_content_type()
            is_json = content_type == "application/json"
            is_form = content_type == "application/x-www-form-urlencoded"
            if not (is_json or is_form):
                self.send(415, {"error": "JSON またはフォーム形式で送信してください。"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > 65_536:
                    raise ValueError("リクエストサイズが不正です。")
                raw = self.rfile.read(length).decode("utf-8")
                if is_json:
                    payload = json.loads(raw)
                    if not isinstance(payload, dict):
                        raise ValueError("JSONオブジェクトが必要です。")
                    token = payload.get("token", "")
                    next_path = _safe_next_path(payload.get("next", "/"))
                else:
                    form = parse_qs(raw, keep_blank_values=True)
                    token = (form.get("token") or [""])[0]
                    next_path = _safe_next_path((form.get("next") or ["/"])[0])
            except (ValueError, UnicodeDecodeError) as error:
                self.send(400, {"error": str(error)})
                return

            if not configured_token:
                if is_json:
                    self.send(200, {"ok": True, "authEnabled": False})
                else:
                    self.send(303, b"", "text/plain", extra_headers=[("Location", next_path)])
                return

            if not isinstance(token, str) or not hmac.compare_digest(token.encode("utf-8"), configured_token.encode("utf-8")):
                if is_json:
                    self.send(401, {"error": "アクセストークンが正しくありません。"})
                else:
                    self.send(401, render_login_page("アクセストークンが正しくありません。", next_path=next_path), "text/html")
                return

            cookie = self.session_cookie_header(expected_cookie)
            if is_json:
                self.send(200, {"ok": True}, extra_headers=[("Set-Cookie", cookie)])
            else:
                self.send(303, b"", "text/plain", extra_headers=[("Set-Cookie", cookie), ("Location", next_path)])

        def _handle_auth_logout(self):
            cookie = self.session_cookie_header("", max_age=0)
            self.send(200, {"ok": True}, extra_headers=[("Set-Cookie", cookie)])

        def do_POST(self):
            if not self.valid_host() or not self.valid_origin():
                self.send(403, {"error": "同じTTJWeb画面から操作してください。"})
                return
            path = urlsplit(self.path).path
            if path == "/api/auth/login":
                self._handle_auth_login()
                return
            if path == "/api/auth/logout":
                self._handle_auth_logout()
                return
            if path != "/api/call":
                self.send(404, {"error": "Not found"})
                return
            if configured_token and not self.is_authenticated():
                self.send(
                    401,
                    {"error": "認証が必要です。"},
                    extra_headers=[("WWW-Authenticate", 'Bearer realm="TTJWeb"')],
                )
                return
            if self.headers.get_content_type() != "application/json":
                self.send(415, {"error": "JSONで操作を指定してください。"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0:
                    raise ValueError("JSONのリクエストが必要です。")
                if length > 1_048_576:
                    self.send(413, {"error": "リクエストが大きすぎます。"})
                    return
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict) or not isinstance(body.get("method"), str) or not isinstance(body.get("params", {}), dict):
                    raise ValueError("methodとparamsが必要です。")
                method = body["method"]
                if read_only_mode and method in WRITE:
                    self.send(403, {"error": "読み取り専用モード（--read-only）のため変更操作は実行できません。"})
                    return
                result = client.request(method, body.get("params", {}))
                self.send(200, {"result": result})
            except (ValueError, UnicodeDecodeError) as error:
                self.send(400, {"error": str(error)})
            except CoreError as error:
                self.send(409 if error.code == -32009 else 422, {"error": str(error), "code": error.code})

    return Handler


def main():
    parser = argparse.ArgumentParser(description="TTJCoreのローカルWeb UI")
    parser.add_argument("--core", default="ttjcore", help="進捗API対応のttjcore実行ファイル")
    parser.add_argument("--home", help="TTJCoreのprofile")
    parser.add_argument("--actor", default="ttjweb", help="ホスト側で許可済みの管理主体")
    parser.add_argument("--port", type=int, default=8765, help="ローカルHTTPポート。0で空きポート")
    parser.add_argument(
        "--allow-host",
        action="append",
        default=[],
        help="追加許可する Host[:port]（複数回またはカンマ区切り指定可。環境変数 TTJWEB_ALLOW_HOSTS でも指定可）",
    )
    parser.add_argument(
        "--auth-token",
        default=None,
        help="任意のアクセストークン認証（未指定時は認証なし。環境変数 TTJWEB_AUTH_TOKEN でも指定可）",
    )
    parser.add_argument(
        "--read-only",
        action="store_true",
        help="読み取り専用モード（WRITE系RPCを403で拒否）",
    )
    args = parser.parse_args()
    executable = shutil.which(args.core)
    if not executable:
        parser.error("ttjcoreが見つかりません。--coreで実行ファイルを指定してください。")
    client = CoreClient(executable, args.home, args.actor)
    try:
        client.check()
    except CoreError as error:
        parser.error(str(error))

    allow_hosts = normalize_allow_hosts(args.allow_host, env_value=os.environ.get("TTJWEB_ALLOW_HOSTS"))
    auth_token = args.auth_token if args.auth_token is not None else os.environ.get("TTJWEB_AUTH_TOKEN")
    if auth_token == "":
        auth_token = None
    read_only = bool(args.read_only or os.environ.get("TTJWEB_READ_ONLY", "").strip().lower() in {"1", "true", "yes"})

    handler = make_handler(client, allow_hosts=allow_hosts, auth_token=auth_token, read_only=read_only)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    flags = []
    if allow_hosts:
        flags.append(f"allow-hosts={','.join(allow_hosts)}")
    if auth_token:
        flags.append("auth=enabled")
    if read_only:
        flags.append("read-only")
    suffix = f" ({', '.join(flags)})" if flags else ""
    print(f"TTJWeb http://127.0.0.1:{server.server_address[1]}{suffix}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
