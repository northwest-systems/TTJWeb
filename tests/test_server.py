import copy
import http.client
import json
import struct
import threading
import unittest
from pathlib import Path
from http.server import ThreadingHTTPServer

from server import CoreClient, CoreError, make_handler, normalize_allow_hosts
from scripts.sync_orca_plugin import check_sync


class FakeCore(CoreClient):
    def __init__(self):
        super().__init__("ttjcore", "~/sample/path/sample.profile", "trusted-owner")
        self.calls = []
        self.snapshot = {
            "ticket": {"record": {"worker_id": "wkr-abcdef-1", "session_id": "ssn-abcdef-1"}},
            "job": {"record": {"id": "job-abcdef-1"}},
            "run": {"active": True, "record": {"id": "run-abcdef-1"}},
        }

    def invoke(self, method, params):
        self.calls.append((method, copy.deepcopy(params)))
        return copy.deepcopy(self.snapshot) if method == "ticket.snapshot" else {"ok": True}


class AuthorityTests(unittest.TestCase):
    def setUp(self):
        self.core = FakeCore()

    def test_management_identity_is_bound_by_host(self):
        self.core.request("status.set", {"id": "job-abcdef-1", "actor": ["forged"], "mode": "execution"})
        self.assertEqual(self.core.calls[-1][1]["actor"], ["trusted-owner"])
        self.assertEqual(self.core.calls[-1][1]["mode"], "management")

    def test_execution_identity_comes_from_current_ticket(self):
        self.core.request("run.progress", {
            "ticket_id": "tkt-abcdef-1", "id": "run-abcdef-1", "revision": 3,
            "percent": 37, "actor": ["forged"], "mode": "management",
        })
        params = self.core.calls[-1][1]
        self.assertEqual(params["actor"], ["wkr-abcdef-1", "ssn-abcdef-1"])
        self.assertEqual(params["mode"], "execution")
        self.assertNotIn("ticket_id", params)

    def test_old_or_unrelated_run_does_not_reach_write(self):
        for active, run_id in [(True, "run-abcdef-99"), (False, "run-abcdef-1")]:
            self.core.calls.clear()
            self.core.snapshot["run"]["active"] = active
            with self.assertRaises(CoreError):
                self.core.request("run.finish", {"ticket_id": "tkt-abcdef-1", "id": run_id})
            self.assertEqual([method for method, _ in self.core.calls], ["ticket.snapshot"])

    def test_unknown_method_is_not_forwarded(self):
        for blocked in ["document.import", "job.delete", "run.delete", "unknown.method"]:
            with self.assertRaises(CoreError):
                self.core.request(blocked, {})
        self.assertEqual(self.core.calls, [])

    def test_expanded_manage_crud_methods_bind_host_actor_and_mode(self):
        methods = [
            "project.create", "project.update", "project.delete",
            "task.create", "task.update", "task.delete", "task.purge",
            "ticket.create", "ticket.update", "ticket.delete",
            "worker.create", "worker.update", "worker.delete",
            "session.create", "session.update", "session.delete",
            "knowledge.create", "knowledge.update", "knowledge.delete",
            "status.set",
        ]
        for method in methods:
            self.core.calls.clear()
            self.core.request(method, {"id": "tsk-abcdef-1", "revision": 1, "actor": ["forged"], "mode": "execution"})
            called_method, params = self.core.calls[-1]
            self.assertEqual(called_method, method)
            self.assertEqual(params["actor"], ["trusted-owner"], method)
            self.assertEqual(params["mode"], "management", method)
            if method == "task.purge":
                self.assertNotIn("reason", params)
            else:
                self.assertTrue(params.get("reason"), method)

    def test_task_purge_strips_empty_reason_and_preserves_explicit_reason(self):
        self.core.request("task.purge", {"id": "tsk-abcdef-1", "revision": 2, "reason": ""})
        self.assertNotIn("reason", self.core.calls[-1][1])
        self.core.request("task.purge", {"id": "tsk-abcdef-1", "revision": 2, "reason": "   "})
        self.assertNotIn("reason", self.core.calls[-1][1])
        self.core.request("task.purge", {"id": "tsk-abcdef-1", "revision": 2, "reason": " explicit "})
        self.assertEqual(self.core.calls[-1][1]["reason"], "explicit")

    def test_blank_or_whitespace_reason_falls_back_to_default_on_mutations(self):
        for raw_reason in ["", "   ", None]:
            self.core.calls.clear()
            self.core.request("task.update", {"id": "tsk-abcdef-1", "revision": 1, "patch": {}, "reason": raw_reason})
            self.assertEqual(self.core.calls[-1][1]["reason"], "TTJWeb: task.update")
        self.core.calls.clear()
        self.core.request("run.progress", {"ticket_id": "tkt-abcdef-1", "id": "run-abcdef-1", "revision": 2, "percent": 50, "reason": "   "})
        self.assertEqual(self.core.calls[-1][1]["reason"], "TTJWeb: run.progress")

    def test_knowledge_read_methods_are_whitelisted_and_strip_actor_mode(self):
        self.core.request("knowledge.get", {"id": "knw-abcdef-1", "include_deleted": True, "actor": ["forged"], "mode": "management"})
        method, params = self.core.calls[-1]
        self.assertEqual(method, "knowledge.get")
        self.assertEqual(params, {"id": "knw-abcdef-1", "include_deleted": True})

        self.core.request("knowledge.list", {"parent": "pj-abcdef-1", "actor": ["forged"], "mode": "execution"})
        method, params = self.core.calls[-1]
        self.assertEqual(method, "knowledge.list")
        self.assertEqual(params, {"parent": "pj-abcdef-1"})


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.core = FakeCore()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.core))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]
        self.origin = f"http://127.0.0.1:{self.port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        data = response.read()
        status = response.status
        connection.close()
        return status, data

    def test_foreign_or_missing_origin_is_rejected_without_core_calls(self):
        for origin in [None, "https://outside.example"]:
            headers = {"Content-Type": "application/json"}
            if origin:
                headers["Origin"] = origin
            status, _ = self.request("POST", "/api/call", '{"method":"status.set","params":{}}', headers)
            self.assertEqual(status, 403)
        status, _ = self.request("GET", "/", headers={"Host": "outside.example"})
        self.assertEqual(status, 403)
        self.assertEqual(self.core.calls, [])

    def test_same_origin_and_static_ui(self):
        status, data = self.request(
            "POST",
            "/api/call",
            '{"method":"project.create","params":{"record":{"name":"Example"},"actor":["forged"]}}',
            {"Content-Type": "application/json", "Origin": self.origin},
        )
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data)["result"], {"ok": True})
        self.assertEqual(self.core.calls[-1][1]["actor"], ["trusted-owner"])
        status, data = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn("TTJWeb".encode(), data)
        status, _ = self.request("GET", "/../server.py")
        self.assertEqual(status, 404)

    def test_view_routes_and_module_assets(self):
        for path in [
            "/?view=tree",
            "/?view=kanban&project=prj-1&ticket=tkt-1",
            "/?view=list&project=prj-1&ticket=tkt-1",
            "/?view=timeline",
            "/?view=settings",
            "/tree",
            "/kanban",
            "/list",
            "/timeline",
            "/settings",
        ]:
            status, data = self.request("GET", path)
            self.assertEqual(status, 200, path)
            self.assertIn(b'data-view="tree"', data)
            self.assertIn(b'data-view="kanban"', data)
            self.assertIn(b'<link rel="icon" href="/favicon.ico" sizes="any">', data)
            self.assertIn(b'<link id="favicon" rel="icon" type="image/png" sizes="512x512" href="/assets/app-icon-light.png">', data)
            self.assertIn(b'id="filter-icon-chips"', data)
            self.assertIn(b'id="detail-error"', data)
            self.assertIn(b'id="toast" class="toast" popover="manual"', data)
        status, data = self.request("GET", "/view-model.mjs")
        self.assertEqual(status, 200)
        self.assertIn(b"parseRoute", data)
        self.assertIn(b"MODALS", data)
        self.assertIn(b"kanbanColumns", data)
        self.assertIn(b"visibleWork", data)
        self.assertIn(b"filterWork", data)
        self.assertIn(b"filterTimelineRows", data)
        self.assertIn(b"formatTimestamp", data)
        self.assertIn(b"canPurgeTask", data)
        self.assertIn(b"jobIcon", data)
        self.assertIn(b"visibleJobs", data)

    def test_knowledge_read_http_relay(self):
        for payload in [
            {"method": "knowledge.get", "params": {"id": "knw-1", "include_deleted": True}},
            {"method": "knowledge.list", "params": {"parent": "pj-1"}},
        ]:
            status, data = self.request(
                "POST",
                "/api/call",
                json.dumps(payload),
                {"Content-Type": "application/json", "Origin": self.origin},
            )
            self.assertEqual(status, 200, payload["method"])
            self.assertEqual(json.loads(data)["result"], {"ok": True})
            self.assertEqual(self.core.calls[-1][0], payload["method"])
            self.assertEqual(self.core.calls[-1][1], payload["params"])

    def test_whitelisted_svg_and_png_assets_and_path_traversal_rejection(self):
        for path in [
            "/assets/octicons/checklist-16.svg",
            "/assets/octicons/mark-github-16.svg",
            "/assets/octicons/star-16.svg",
            "/assets/octicons/tag-16.svg",
            "/icons/back.svg",
            "/icons/book.svg",
            "/icons/close.svg",
            "/icons/edit.svg",
            "/icons/execute.svg",
            "/icons/filter.svg",
            "/icons/fit.svg",
            "/icons/folder.svg",
            "/icons/kanban.svg",
            "/icons/list.svg",
            "/icons/minus.svg",
            "/icons/moon.svg",
            "/icons/plus.svg",
            "/icons/refresh.svg",
            "/icons/reset.svg",
            "/icons/review.svg",
            "/icons/search.svg",
            "/icons/session.svg",
            "/icons/settings.svg",
            "/icons/sun.svg",
            "/icons/task.svg",
            "/icons/ticket.svg",
            "/icons/timeline.svg",
            "/icons/trash.svg",
            "/icons/tree.svg",
        ]:
            connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
            connection.request("GET", path)
            response = connection.getresponse()
            data = response.read()
            content_type = response.getheader("Content-Type", "")
            nosniff = response.getheader("X-Content-Type-Options", "")
            cache_control = response.getheader("Cache-Control", "")
            connection.close()
            self.assertEqual(response.status, 200, path)
            self.assertTrue(content_type.startswith("image/svg+xml"), f"{path}: {content_type}")
            self.assertEqual(nosniff, "nosniff")
            self.assertNotIn("no-store", cache_control.lower(), path)
            self.assertIn(b"<svg", data, path)

        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        connection.request("GET", "/favicon.ico")
        response = connection.getresponse()
        ico_data = response.read()
        ico_content_type = response.getheader("Content-Type", "")
        ico_nosniff = response.getheader("X-Content-Type-Options", "")
        ico_cache_control = response.getheader("Cache-Control", "")
        connection.close()
        self.assertEqual(response.status, 200)
        self.assertEqual(ico_content_type, "image/x-icon")
        self.assertEqual(ico_nosniff, "nosniff")
        self.assertNotIn("no-store", ico_cache_control.lower())
        self.assertEqual(ico_data[:4], b"\x00\x00\x01\x00")
        header = struct.unpack("<HHHBBBBHHII", ico_data[:22])
        self.assertEqual(header, (0, 1, 1, 0, 0, 0, 0, 1, 32, len(ico_data) - 22, 22))
        self.assertTrue(ico_data[22:].startswith(b"\x89PNG\r\n\x1a\n"))

        for png_path in [
            "/assets/app-icon.png",
            "/assets/app-icon-light.png",
            "/assets/app-icon-white.png",
            "/assets/app-icon-black.png",
        ]:
            connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
            connection.request("GET", png_path)
            response = connection.getresponse()
            data = response.read()
            content_type = response.getheader("Content-Type", "")
            nosniff = response.getheader("X-Content-Type-Options", "")
            cache_control = response.getheader("Cache-Control", "")
            connection.close()
            self.assertEqual(response.status, 200, png_path)
            self.assertEqual(content_type, "image/png", f"{png_path}: {content_type}")
            self.assertEqual(nosniff, "nosniff")
            self.assertNotIn("no-store", cache_control.lower(), png_path)
            self.assertTrue(data.startswith(b"\x89PNG\r\n\x1a\n"), png_path)

        for no_store_path in ["/", "/api/config", "/app.js", "/style.css"]:
            connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
            connection.request("GET", no_store_path)
            response = connection.getresponse()
            response.read()
            cache_control = response.getheader("Cache-Control", "")
            connection.close()
            self.assertEqual(response.status, 200, no_store_path)
            self.assertEqual(cache_control, "no-store", no_store_path)

        for blocked in [
            "/icons/../app.js",
            "/icons/../../server.py",
            "/assets/../server.py",
            "/assets/octicons/../../server.py",
            "/assets/octicons/LICENSE",
            "/icons/%2e%2e/server.py",
            "/icons/does-not-exist.svg",
            "/assets/does-not-exist.png",
            "/THIRD_PARTY_NOTICES.txt",
        ]:
            status, _ = self.request("GET", blocked)
            self.assertEqual(status, 404, blocked)


class RemoteAccessAndAuthTests(unittest.TestCase):
    def _start_server(self, **handler_kwargs):
        core = FakeCore()
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(core, **handler_kwargs))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return core, server, server.server_address[1]

    def _raw_request(self, port, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        conn.request(method, path, body=body, headers=headers or {})
        resp = conn.getresponse()
        data = resp.read()
        resp_headers = resp.headers
        status = resp.status
        conn.close()
        return status, data, resp_headers

    def test_normalize_allow_hosts_merges_cli_csv_and_env(self):
        hosts = normalize_allow_hosts(
            [
                "Sample-Host.tail0000.ts.net:8878",
                "sample-foo.tail0000.ts.net, sample-bar.tail0000.ts.net:443",
            ],
            env_value="SAMPLE-BAR.tail0000.ts.net:443, sample-baz.tail0000.ts.net ",
        )
        self.assertEqual(
            hosts,
            (
                "sample-bar.tail0000.ts.net:443",
                "sample-baz.tail0000.ts.net",
                "sample-foo.tail0000.ts.net",
                "sample-host.tail0000.ts.net:8878",
            ),
        )

    def test_default_mode_still_rejects_non_loopback_host(self):
        core, _, port = self._start_server()
        status, _, _ = self._raw_request(
            port, "GET", "/api/meta", headers={"Host": "sample-host.tail0000.ts.net:8878"}
        )
        self.assertEqual(status, 403)
        self.assertEqual(core.calls, [])

    def test_allow_host_accepts_matching_host_and_https_origin_and_blocks_foreign(self):
        target_host = "sample-host.tail0000.ts.net:8878"
        core, _, port = self._start_server(allow_hosts=["SAMPLE-HOST.tail0000.ts.net:8878"])

        status, data, _ = self._raw_request(port, "GET", "/", headers={"Host": target_host})
        self.assertEqual(status, 200)
        self.assertIn(b"TTJWeb", data)

        status, data, _ = self._raw_request(port, "GET", "/api/meta", headers={"Host": target_host})
        self.assertEqual(status, 200)
        meta = json.loads(data)
        self.assertEqual(meta["allowHosts"], [target_host])
        self.assertFalse(meta["readOnly"])
        self.assertFalse(meta["authEnabled"])

        status, data, _ = self._raw_request(
            port,
            "POST",
            "/api/call",
            '{"method":"project.list","params":{}}',
            {
                "Host": target_host,
                "Origin": f"https://{target_host}",
                "Content-Type": "application/json",
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data)["result"], {"ok": True})

        # Foreign Origin must be rejected
        status, _, _ = self._raw_request(
            port,
            "POST",
            "/api/call",
            '{"method":"project.list","params":{}}',
            {
                "Host": target_host,
                "Origin": "https://evil.example",
                "Content-Type": "application/json",
            },
        )
        self.assertEqual(status, 403)

        # Unlisted Host must be rejected
        status, _, _ = self._raw_request(
            port, "GET", "/api/meta", headers={"Host": "sample-other.tail0000.ts.net:8878"}
        )
        self.assertEqual(status, 403)

        # Loopback still only allows http:// origin
        status, _, _ = self._raw_request(
            port,
            "POST",
            "/api/call",
            '{"method":"project.list","params":{}}',
            {
                "Host": f"127.0.0.1:{port}",
                "Origin": f"https://127.0.0.1:{port}",
                "Content-Type": "application/json",
            },
        )
        self.assertEqual(status, 403)
        self.assertEqual(len(core.calls), 1)

    def test_auth_token_protects_endpoints_and_supports_bearer_and_cookie(self):
        secret = "sample-token"
        target_host = "sample-host.tail0000.ts.net:8878"
        core, _, port = self._start_server(allow_hosts=[target_host], auth_token=secret)

        # Unauthenticated /api/meta -> 401
        status, data, _ = self._raw_request(port, "GET", "/api/meta", headers={"Host": target_host})
        self.assertEqual(status, 401)
        self.assertNotIn(secret.encode(), data)

        # Unauthenticated /api/call -> 401
        status, _, _ = self._raw_request(
            port,
            "POST",
            "/api/call",
            '{"method":"project.list","params":{}}',
            {"Host": target_host, "Origin": f"https://{target_host}", "Content-Type": "application/json"},
        )
        self.assertEqual(status, 401)

        # Unauthenticated / returns login HTML form without leaking secret
        status, html_data, _ = self._raw_request(port, "GET", "/", headers={"Host": target_host})
        self.assertEqual(status, 200)
        self.assertIn(b"/api/auth/login", html_data)
        self.assertIn(b'type="password"', html_data)
        self.assertNotIn(secret.encode(), html_data)

        # Minimal style/icon allowed without auth, app.js blocked
        status, _, _ = self._raw_request(port, "GET", "/style.css", headers={"Host": target_host})
        self.assertEqual(status, 200)
        status, _, _ = self._raw_request(port, "GET", "/app.js", headers={"Host": target_host})
        self.assertEqual(status, 401)

        # Bearer authentication works and does not leak secret in /api/meta
        status, data, _ = self._raw_request(
            port,
            "GET",
            "/api/meta",
            headers={"Host": target_host, "Authorization": f"Bearer {secret}"},
        )
        self.assertEqual(status, 200)
        self.assertNotIn(secret.encode(), data)
        meta = json.loads(data)
        self.assertTrue(meta["authEnabled"])

        status, _, _ = self._raw_request(
            port,
            "POST",
            "/api/call",
            '{"method":"project.list","params":{}}',
            {
                "Host": target_host,
                "Origin": f"https://{target_host}",
                "Authorization": f"Bearer {secret}",
                "Content-Type": "application/json",
            },
        )
        self.assertEqual(status, 200)

        # Wrong token login fails
        status, _, _ = self._raw_request(
            port,
            "POST",
            "/api/auth/login",
            json.dumps({"token": "wrong-token"}),
            {"Host": target_host, "Origin": f"https://{target_host}", "Content-Type": "application/json"},
        )
        self.assertEqual(status, 401)

        # Valid login issues HttpOnly SameSite=Lax Secure session cookie without raw token
        status, _, resp_headers = self._raw_request(
            port,
            "POST",
            "/api/auth/login",
            json.dumps({"token": secret}),
            {
                "Host": target_host,
                "Origin": f"https://{target_host}",
                "X-Forwarded-Proto": "https",
                "Content-Type": "application/json",
            },
        )
        self.assertEqual(status, 200)
        set_cookie = resp_headers.get("Set-Cookie", "")
        self.assertIn("ttjweb_session=", set_cookie)
        self.assertIn("HttpOnly", set_cookie)
        self.assertIn("SameSite=Lax", set_cookie)
        self.assertIn("Secure", set_cookie)
        self.assertNotIn(secret, set_cookie)

        cookie_pair = set_cookie.split(";", 1)[0]
        status, data, _ = self._raw_request(
            port, "GET", "/api/meta", headers={"Host": target_host, "Cookie": cookie_pair}
        )
        self.assertEqual(status, 200)
        self.assertNotIn(secret.encode(), data)

        status, page_data, _ = self._raw_request(
            port, "GET", "/", headers={"Host": target_host, "Cookie": cookie_pair}
        )
        self.assertEqual(status, 200)
        self.assertIn(b'data-view="tree"', page_data)

        status, _, logout_headers = self._raw_request(
            port,
            "POST",
            "/api/auth/logout",
            "{}",
            {"Host": target_host, "Origin": f"https://{target_host}", "Cookie": cookie_pair},
        )
        self.assertEqual(status, 200)
        self.assertIn("Max-Age=0", logout_headers.get("Set-Cookie", ""))
        self.assertEqual(len(core.calls), 1)

    def test_read_only_mode_allows_read_and_blocks_write(self):
        core, _, port = self._start_server(read_only=True)
        origin = f"http://127.0.0.1:{port}"

        status, data, _ = self._raw_request(port, "GET", "/api/meta")
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(data)["readOnly"])

        # READ allowed
        status, data, _ = self._raw_request(
            port,
            "POST",
            "/api/call",
            '{"method":"project.list","params":{}}',
            {"Origin": origin, "Content-Type": "application/json"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data)["result"], {"ok": True})

        # WRITE blocked with 403
        for write_method in ["project.create", "status.set", "run.progress"]:
            status, _, _ = self._raw_request(
                port,
                "POST",
                "/api/call",
                json.dumps({"method": write_method, "params": {}}),
                {"Origin": origin, "Content-Type": "application/json"},
            )
            self.assertEqual(status, 403, write_method)

        self.assertEqual([m for m, _ in core.calls], ["project.list"])


class OrcaPluginSyncTests(unittest.TestCase):
    def test_static_and_orca_plugin_vendor_are_in_sync(self):
        problems = check_sync()
        self.assertEqual(problems, [], "Run `python scripts/sync_orca_plugin.py`: " + "\n".join(problems))

    def test_orca_plugin_manifest_and_icon_constraints(self):
        root = Path(__file__).resolve().parent.parent
        manifest_path = root / "orca-plugin" / "orca-plugin.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(manifest["manifestVersion"], 2)
        self.assertEqual(manifest["execution"], "trusted-worker")
        self.assertEqual(manifest["id"], "ttjweb-sidebar")
        self.assertNotIn("publisher", manifest)
        icon_bytes = (root / "orca-plugin" / manifest["icon"]).read_bytes()
        self.assertTrue(icon_bytes.startswith(b"\x89PNG\r\n\x1a\n"))
        width, height = struct.unpack(">II", icon_bytes[16:24])
        self.assertEqual(width, height)
        self.assertGreaterEqual(width, 128)
        self.assertLessEqual(len(icon_bytes), 256 * 1024)


if __name__ == "__main__":
    unittest.main()
