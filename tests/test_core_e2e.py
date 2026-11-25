"""End-to-end integration tests against a real ttjcore binary in an isolated temp home."""
import http.client
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

from server import CoreClient, make_handler


def _supports_ttj_1_1(binary):
    probe_home = tempfile.mkdtemp(prefix="ttjweb-probe-")
    try:
        res = subprocess.run(
            [binary, "--home", probe_home, "init"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if res.returncode != 0:
            return False
        data = json.loads(res.stdout)
        return data.get("protocol") == "TTJ/1.1.0"
    except Exception:
        return False
    finally:
        shutil.rmtree(probe_home, ignore_errors=True)


def _resolve_core_binary():
    candidates = [
        os.environ.get("TTJWEB_TEST_CORE"),
        shutil.which("ttjcore"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            if _supports_ttj_1_1(candidate):
                return candidate
    return None


REAL_CORE = _resolve_core_binary()


@unittest.skipUnless(REAL_CORE, "TTJ/1.1.0 ttjcore binary not available in this environment")
class RealCoreE2ETests(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="ttjweb-e2e-home-")
        self.core_proc = None
        self.http_server = None
        self.http_thread = None

        subprocess.run(
            [REAL_CORE, "--home", self.home, "init"],
            check=True,
            capture_output=True,
            text=True,
            timeout=15,
        )
        env = os.environ.copy()
        env["TTJCORE_MANAGEMENT_ACTORS"] = json.dumps(["ttjweb"])
        self.core_proc = subprocess.Popen(
            [REAL_CORE, "--home", self.home, "serve"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
        )

        # Wait until ttjcore IPC is ready
        client = CoreClient(REAL_CORE, self.home, "ttjweb")
        deadline = time.monotonic() + 10.0
        last_err = None
        while time.monotonic() < deadline:
            try:
                client.check()
                break
            except Exception as err:
                last_err = err
                time.sleep(0.1)
        else:
            self._cleanup()
            raise RuntimeError(f"ttjcore failed to become ready: {last_err}")

        self.client = client
        self.http_server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.client))
        self.port = self.http_server.server_address[1]
        self.origin = f"http://127.0.0.1:{self.port}"
        self.http_thread = threading.Thread(target=self.http_server.serve_forever, daemon=True)
        self.http_thread.start()

    def _cleanup(self):
        if self.http_server is not None:
            self.http_server.shutdown()
            self.http_server.server_close()
            self.http_server = None
        if self.http_thread is not None:
            self.http_thread.join(timeout=5)
            self.http_thread = None
        if self.core_proc is not None:
            try:
                self.client.invoke("core.stop", {})
            except Exception:
                pass
            self.core_proc.terminate()
            try:
                self.core_proc.wait(timeout=5)
            except Exception:
                self.core_proc.kill()
                self.core_proc.wait(timeout=3)
            for stream in (self.core_proc.stdout, self.core_proc.stderr):
                if stream is not None:
                    try:
                        stream.close()
                    except Exception:
                        pass
            self.core_proc = None
        if os.path.isdir(self.home):
            shutil.rmtree(self.home, ignore_errors=True)

    def tearDown(self):
        self._cleanup()

    def call_api(self, method, params=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)
        body = json.dumps({"method": method, "params": params or {}}, ensure_ascii=False).encode("utf-8")
        conn.request(
            "POST",
            "/api/call",
            body=body,
            headers={
                "Content-Type": "application/json",
                "Host": f"127.0.0.1:{self.port}",
                "Origin": self.origin,
            },
        )
        resp = conn.getresponse()
        raw = resp.read().decode("utf-8")
        status = resp.status
        conn.close()
        return status, json.loads(raw)

    def call_ok(self, method, params=None):
        status, data = self.call_api(method, params)
        self.assertEqual(status, 200, f"{method} failed with {status}: {data}")
        return data["result"]

    def test_run_progress_and_all_write_operations_end_to_end(self):
        # Worker & Session CRUD
        w1 = self.call_ok("worker.create", {"record": {"name": "E2E Worker"}})
        w1 = self.call_ok("worker.update", {"id": w1["record"]["id"], "revision": w1["revision"], "patch": {"name": "E2E Worker Renamed"}})
        w_tmp = self.call_ok("worker.create", {"record": {"name": "Unused Worker"}})
        self.call_ok("worker.delete", {"id": w_tmp["record"]["id"], "revision": w_tmp["revision"], "reason": "cleanup"})

        s1 = self.call_ok("session.create", {"record": {"worker_id": w1["record"]["id"]}})
        s_tmp = self.call_ok("session.create", {"record": {"worker_id": w1["record"]["id"]}})
        s_tmp = self.call_ok(
            "session.update",
            {"id": s_tmp["record"]["id"], "revision": s_tmp["revision"], "patch": {"ended": "2026-11-25T00:00:00Z"}, "reason": "ended"},
        )
        self.call_ok("session.delete", {"id": s_tmp["record"]["id"], "revision": s_tmp["revision"], "reason": "cleanup"})

        # Project & Task CRUD (including whitespace reason normalization!)
        pj = self.call_ok("project.create", {"record": {"name": "E2E Project"}})
        pj_id = pj["record"]["id"]
        pj = self.call_ok("project.update", {"id": pj_id, "revision": pj["revision"], "patch": {"name": "E2E Project Updated"}, "reason": "   "})

        tsk = self.call_ok(
            "task.create",
            {
                "parent": pj_id,
                "record": {"objective": "E2E Task", "criteria": ["基準1"]},
                "display": {"summary": "タスク補足"},
            },
        )
        tsk_id = tsk["record"]["id"]
        tsk = self.call_ok(
            "task.update",
            {
                "id": tsk_id,
                "revision": tsk["revision"],
                "patch": {"objective": "E2E Task Edited", "criteria": ["基準1", "基準2"], "deadline": None},
                "display": {"summary": ""},
                "reason": "   ",
            },
        )

        # Pause & release Task
        tsk = self.call_ok("status.set", {"id": tsk_id, "revision": tsk["revision"], "status": "paused", "release": False, "reason": "hold"})
        tsk = self.call_ok("status.set", {"id": tsk_id, "revision": tsk["revision"], "status": "todo", "release": True, "reason": "resume"})

        # Ticket create & update
        tkt = self.call_ok(
            "ticket.create",
            {
                "record": {
                    "task_id": tsk_id,
                    "worker_id": w1["record"]["id"],
                    "session_id": s1["record"]["id"],
                    "objective": "E2E Ticket",
                    "jobs": [
                        {"objective": "Job 1", "criteria": ["J1完了"], "display": {"icon": "edit"}},
                        {"objective": "Job 2", "criteria": ["J2完了"], "display": {"icon": "test"}},
                    ],
                },
                "display": {"summary": "チケット補足"},
            },
        )
        tkt_id = tkt["record"]["id"]
        tkt = self.call_ok(
            "ticket.update",
            {
                "id": tkt_id,
                "revision": tkt["revision"],
                "patch": {"resume": None, "refs": [], "artifacts": [], "depends": []},
                "display": {"summary": "更新済み"},
                "reason": "update ticket",
            },
        )

        # Run start -> run.progress matrix -> timeline assertions
        tsnap = self.call_ok("ticket.snapshot", {"id": tkt_id})
        job1 = tsnap["job"]
        started = self.call_ok("run.start", {"ticket_id": tkt_id, "job": job1["record"]["id"], "revision": job1["revision"]})
        run1 = started["run"]
        run1_id = run1["record"]["id"]

        snap0 = self.call_ok("project.snapshot", {"id": pj_id})
        initial_progress_events = [e for e in snap0["timeline"] if e["event"] == "run.progress_changed"]
        self.assertEqual(len(initial_progress_events), 0)

        # 1. Both null when empty -> no-op (revision & cursor unchanged)
        noop1 = self.call_ok("run.progress", {"ticket_id": tkt_id, "id": run1_id, "revision": run1["revision"], "percent": None, "message": None})
        self.assertEqual(noop1["revision"], run1["revision"])

        # 2. Percent only -> adds run.progress_changed to timeline
        run1 = self.call_ok("run.progress", {"ticket_id": tkt_id, "id": run1_id, "revision": run1["revision"], "percent": 25, "message": None})
        self.assertEqual(run1["progress"], {"percent": 25})

        # 3. Same values again -> no-op (revision unchanged)
        noop2 = self.call_ok("run.progress", {"ticket_id": tkt_id, "id": run1_id, "revision": run1["revision"], "percent": 25, "message": None})
        self.assertEqual(noop2["revision"], run1["revision"])

        # 4. Message only (clearing percent) -> adds run.progress_changed
        run1 = self.call_ok("run.progress", {"ticket_id": tkt_id, "id": run1_id, "revision": run1["revision"], "percent": None, "message": "調査中"})
        self.assertEqual(run1["progress"], {"message": "調査中"})

        # 5. Both percent and message -> adds run.progress_changed
        run1 = self.call_ok("run.progress", {"ticket_id": tkt_id, "id": run1_id, "revision": run1["revision"], "percent": 60, "message": "実装中"})
        self.assertEqual(run1["progress"], {"percent": 60, "message": "実装中"})

        # 6. Percent 0 and 100 boundary values -> both recorded
        run1 = self.call_ok("run.progress", {"ticket_id": tkt_id, "id": run1_id, "revision": run1["revision"], "percent": 0, "message": "開始"})
        self.assertEqual(run1["progress"]["percent"], 0)
        run1 = self.call_ok("run.progress", {"ticket_id": tkt_id, "id": run1_id, "revision": run1["revision"], "percent": 100, "message": "仕上げ"})
        self.assertEqual(run1["progress"]["percent"], 100)

        # 7. Clear both -> adds run.progress_changed and removes progress
        run1 = self.call_ok("run.progress", {"ticket_id": tkt_id, "id": run1_id, "revision": run1["revision"], "percent": None, "message": None})
        self.assertNotIn("progress", run1)

        # 8. Invalid inputs rejected with 422
        for bad_params in [
            {"percent": 33.5, "message": "float"},
            {"percent": -1, "message": "neg"},
            {"percent": 101, "message": "over"},
            {"percent": 50, "message": "bad\tcontrol"},
        ]:
            status, _ = self.call_api("run.progress", {"ticket_id": tkt_id, "id": run1_id, "revision": run1["revision"], **bad_params})
            self.assertEqual(status, 422, bad_params)

        snap1 = self.call_ok("project.snapshot", {"id": pj_id})
        prog_events = [e for e in snap1["timeline"] if e["event"] == "run.progress_changed"]
        self.assertEqual(len(prog_events), 6)
        self.assertEqual(prog_events[0]["to"]["progress"], {"percent": 25})
        self.assertEqual(prog_events[1]["to"]["progress"], {"message": "調査中"})
        self.assertEqual(prog_events[2]["to"]["progress"], {"percent": 60, "message": "実装中"})
        self.assertEqual(prog_events[3]["to"]["progress"], {"percent": 0, "message": "開始"})
        self.assertEqual(prog_events[4]["to"]["progress"], {"percent": 100, "message": "仕上げ"})
        self.assertNotIn("progress", prog_events[5]["to"])

        # Run finish & Job 1 complete
        self.call_ok("run.finish", {"ticket_id": tkt_id, "id": run1_id, "revision": run1["revision"], "result": "succeeded"})
        tsnap = self.call_ok("ticket.snapshot", {"id": tkt_id})
        job1 = tsnap["job"]
        self.call_ok("status.set", {"id": job1["record"]["id"], "revision": job1["revision"], "status": "completed", "criteria_met": True, "result": "J1 ok"})

        # Job 2 run with safety + >100 timeline events check
        tsnap = self.call_ok("ticket.snapshot", {"id": tkt_id})
        job2 = tsnap["job"]
        started2 = self.call_ok("run.start", {"ticket_id": tkt_id, "job": job2["record"]["id"], "revision": job2["revision"], "safety": "J1 clean"})
        run2 = started2["run"]
        for i in range(1, 106):
            run2 = self.call_ok(
                "run.progress",
                {"ticket_id": tkt_id, "id": run2["record"]["id"], "revision": run2["revision"], "percent": i % 101, "message": f"step-{i}"},
            )
        snap_big = self.call_ok("project.snapshot", {"id": pj_id})
        big_prog = [e for e in snap_big["timeline"] if e["event"] == "run.progress_changed"]
        self.assertEqual(len(big_prog), 6 + 105)
        self.assertEqual(big_prog[-1]["to"]["progress"]["message"], "step-105")

        # Finish Job 2 -> Ticket auto-completes -> Task complete
        self.call_ok("run.finish", {"ticket_id": tkt_id, "id": run2["record"]["id"], "revision": run2["revision"], "result": "succeeded"})
        tsnap = self.call_ok("ticket.snapshot", {"id": tkt_id})
        job2 = tsnap["job"]
        self.call_ok("status.set", {"id": job2["record"]["id"], "revision": job2["revision"], "status": "completed", "criteria_met": True, "result": "J2 ok"})

        psnap = self.call_ok("project.snapshot", {"id": pj_id})
        tsk_now = psnap["tasks"][0]["task"]
        self.call_ok("status.set", {"id": tsk_id, "revision": tsk_now["revision"], "status": "completed", "criteria_met": True, "result": "Task ok"})

        # Knowledge CRUD & supersede
        kn1 = self.call_ok("knowledge.create", {"parent": pj_id, "record": {"content": "方針1", "basis": "根拠1"}, "reason": "add"})
        kn2 = self.call_ok("knowledge.create", {"parent": pj_id, "record": {"content": "方針2", "basis": "根拠2", "supersedes": kn1["record"]["id"]}, "reason": "replace"})
        kn2 = self.call_ok("knowledge.update", {"id": kn2["record"]["id"], "revision": kn2["revision"], "patch": {"status": "supersed"}, "reason": "retire"})
        self.call_ok("knowledge.delete", {"id": kn2["record"]["id"], "revision": kn2["revision"], "reason": "delete"})

        # Task purge & Project delete
        psnap = self.call_ok("project.snapshot", {"id": pj_id})
        tsk_now = psnap["tasks"][0]["task"]
        self.call_ok("task.purge", {"id": tsk_id, "revision": tsk_now["revision"]})
        psnap = self.call_ok("project.snapshot", {"id": pj_id})
        pj_now = psnap["project"]
        self.call_ok("project.delete", {"id": pj_id, "revision": pj_now["revision"], "reason": "done"})


if __name__ == "__main__":
    unittest.main()
