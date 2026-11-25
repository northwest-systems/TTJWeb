import { EventEmitter } from "node:events";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { assert, mockHost, mountWorker, test } from "orca/testing";
import * as main from "./worker.mjs";
import { computeFormatBits, computeVersionBits, encodeQrMatrix, renderQrSvg } from "../panel/qrcode.mjs";

function startFakeTtjServer({ authToken = "", readOnly = false, allowHosts = [] } = {}) {
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const entry = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: raw ? JSON.parse(raw) : null,
      };
      received.push(entry);

      if (authToken && req.headers.authorization !== `Bearer ${authToken}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "認証が必要です。" }));
        return;
      }

      if (req.method === "GET" && req.url === "/api/meta") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          actor: "ttjweb",
          protocol: "TTJ/1.1.0",
          watch_prefix: "ttjcore",
          allowHosts,
          readOnly,
          authEnabled: Boolean(authToken),
        }));
        return;
      }

      if (req.method === "POST" && req.url === "/api/call") {
        const expectedOrigin = `http://127.0.0.1:${server.address().port}`;
        if (req.headers.origin !== expectedOrigin) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Origin mismatch" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          result: {
            items: [{ record: { id: "prj-test-1", name: "Sample PJ" } }],
            echoMethod: entry.body?.method,
            echoParams: entry.body?.params,
          },
        }));
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });
  });

  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        port,
        url: `http://127.0.0.1:${port}`,
        received,
        close: () => new Promise(done => server.close(done)),
      });
    });
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function readQrPayloadRoundtrip(qr) {
  const { version, size, mask, modules } = qr;
  // Reconstruct function mask to extract data bits in zig-zag order
  const isFn = Array.from({ length: size }, () => new Array(size).fill(false));
  const markFinder = (top, left) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = top + dr;
        const c = left + dc;
        if (r >= 0 && r < size && c >= 0 && c < size) isFn[r][c] = true;
      }
    }
  };
  markFinder(0, 0);
  markFinder(0, size - 7);
  markFinder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) {
    isFn[6][i] = true;
    isFn[i][6] = true;
  }
  const alignTable = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  for (const rc of alignTable[version]) {
    for (const cc of alignTable[version]) {
      if ((rc <= 8 && cc <= 8) || (rc <= 8 && cc >= size - 9) || (rc >= size - 9 && cc <= 8)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) isFn[rc + dr][cc + dc] = true;
      }
    }
  }
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      isFn[8][i] = true;
      isFn[i][8] = true;
    }
  }
  for (let i = size - 8; i < size; i++) {
    isFn[8][i] = true;
    isFn[i][8] = true;
  }
  isFn[size - 8][8] = true;
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = Math.floor(i / 3);
      const b = size - 11 + (i % 3);
      isFn[a][b] = true;
      isFn[b][a] = true;
    }
  }

  const maskFn = (r, c) => {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return false;
    }
  };

  const bits = [];
  let upward = true;
  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col--;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (!isFn[row][c]) {
          const val = modules[row][c] ^ (maskFn(row, c) ? 1 : 0);
          bits.push(val ? 1 : 0);
        }
      }
    }
    upward = !upward;
  }

  const codewords = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    codewords.push(b);
  }
  return codewords;
}

// --- QR Code Tests ---

test("QR encoder produces valid finder, timing, dark module, format bits, version bits, and decodable payload", () => {
  const sampleUrls = [
    "https://sample-host.tail0000.ts.net:8878/",
    "https://sample-machine.tail0000.ts.net:8878/?view=list&project=prj-123456",
    "https://sample-very-long-hostname-for-version7-check.tail0000.ts.net:8878/?view=timeline&project=prj-abcdef0123456789&ticket=tkt-9876543210",
  ];

  for (const url of sampleUrls) {
    const qr = encodeQrMatrix(url, { ecc: "M" });
    const { size, modules, version, mask } = qr;
    assert.equal(size, version * 4 + 17);
    assert.equal(modules.length, size);
    assert.equal(modules[0].length, size);

    // Check all 3 finder patterns (7x7)
    for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
      for (let dr = 0; dr < 7; dr++) {
        for (let dc = 0; dc < 7; dc++) {
          const expected =
            dr === 0 || dr === 6 || dc === 0 || dc === 6 ||
            (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
          assert.equal(modules[top + dr][left + dc], expected, `finder mismatch at (${top + dr},${left + dc})`);
        }
      }
    }

    // Check timing patterns
    for (let i = 8; i < size - 8; i++) {
      assert.equal(modules[6][i], i % 2 === 0);
      assert.equal(modules[i][6], i % 2 === 0);
    }

    // Check always-dark module
    assert.equal(modules[size - 8][8], true);

    // Check format bits in both copies
    const expectedFormat = computeFormatBits("M", mask);
    const coords1 = [
      [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
      [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
    ];
    for (let i = 0; i < 15; i++) {
      const bit = Boolean((expectedFormat >>> (14 - i)) & 1);
      const [r, c] = coords1[i];
      assert.equal(modules[r][c], bit);
    }
    for (let i = 0; i < 7; i++) {
      const bit = Boolean((expectedFormat >>> (14 - i)) & 1);
      assert.equal(modules[size - 1 - i][8], bit);
    }
    for (let i = 0; i < 8; i++) {
      const bit = Boolean((expectedFormat >>> (7 - i)) & 1);
      assert.equal(modules[8][size - 8 + i], bit);
    }

    // Check version info bits for Version >= 7
    if (version >= 7) {
      const expectedVersionBits = computeVersionBits(version);
      for (let i = 0; i < 18; i++) {
        const bit = Boolean((expectedVersionBits >>> i) & 1);
        const a = Math.floor(i / 3);
        const b = size - 11 + (i % 3);
        assert.equal(modules[a][b], bit);
        assert.equal(modules[b][a], bit);
      }
    }
  }

  // Roundtrip check on single-block Version 3 URL (ECC L: 1 block, no interleaving complexity)
  const shortUrl = "https://sample-host.tail0000.ts.net:8878/list";
  const qrL = encodeQrMatrix(shortUrl, { ecc: "L" });
  const cws = readQrPayloadRoundtrip(qrL);
  const mode = (cws[0] >>> 4) & 0xf;
  const byteLen = ((cws[0] & 0xf) << 4) | ((cws[1] >>> 4) & 0xf);
  assert.equal(mode, 0b0100, "Byte mode indicator");
  assert.equal(byteLen, Buffer.byteLength(shortUrl, "utf8"));
  const decodedBytes = [];
  for (let i = 0; i < byteLen; i++) {
    const byte = ((cws[1 + i] & 0xf) << 4) | ((cws[2 + i] >>> 4) & 0xf);
    decodedBytes.push(byte);
  }
  assert.equal(Buffer.from(decodedBytes).toString("utf8"), shortUrl);
});

test("renderQrSvg outputs crisp SVG with quiet zone and guards against empty or invalid input", () => {
  const svg = renderQrSvg("https://sample-host.tail0000.ts.net:8878/", { quietZone: 4, size: 164, label: 'QR "test"' });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /width="164" height="164"/);
  assert.match(svg, /fill="#ffffff"/);
  assert.match(svg, /<path d="M/);
  assert.match(svg, /aria-label="QR &quot;test&quot;"/);

  assert.throws(() => encodeQrMatrix(""));
  assert.throws(() => encodeQrMatrix(null));
  assert.throws(() => encodeQrMatrix("https://example.com", { ecc: "Z" }));
  assert.throws(() => encodeQrMatrix("x".repeat(400), { ecc: "M" }));
});

// --- Existing Core Worker Tests ---

test("toggle ON/OFF updates setting, status bar, posts state, and blocks calls while OFF", async () => {
  const host = mockHost({
    settings: {
      enabled: true,
      backendMode: "server",
      serverUrl: "http://127.0.0.1:8878",
      authToken: "sample-token",
      autoRefreshSeconds: 10,
    },
  });
  const worker = await mountWorker(main, { host });

  try {
    const initial = await worker.request("ttj.state");
    assert.equal(initial.enabled, true);
    assert.equal(initial.hasAuthToken, true);
    assert.equal("authToken" in initial, false, "authToken must never be exposed to panel");

    const offState = await worker.request("ttj.setEnabled", { enabled: false });
    assert.equal(offState.enabled, false);
    assert.equal(host.data().settings.enabled, false);

    const sbCalls = host.callsOf("statusBar.update");
    assert.ok(sbCalls.length >= 1);
    const lastEntry = sbCalls[sbCalls.length - 1];
    const lastOff = lastEntry?.params ?? lastEntry;
    assert.equal(lastOff.id, "ttjweb-status");
    assert.equal(lastOff.text, "TTJ: OFF");
    assert.equal(lastOff.tone, "neutral");

    const metaWhenOff = await worker.request("ttj.meta");
    assert.deepEqual(metaWhenOff, { disabled: true });
    await assert.rejects(() => worker.request("ttj.call", { method: "project.list", params: {} }));

    const cmdMsg = await worker.command("ttjweb.toggleEnabled");
    assert.match(String(cmdMsg), /ON/);
    assert.equal(host.data().settings.enabled, true);

    const sbCallsAfter = host.callsOf("statusBar.update");
    const lastOnEntry = sbCallsAfter[sbCallsAfter.length - 1];
    const lastOn = lastOnEntry?.params ?? lastOnEntry;
    assert.equal(lastOn.text, "TTJ: ON");
    assert.equal(lastOn.tone, "accent");

    assert.ok(worker.posts.some(p => p.event === "ttj.state" && p.payload?.enabled === false));
    assert.ok(worker.posts.some(p => p.event === "ttj.state" && p.payload?.enabled === true));
    assert.deepEqual(worker.refusals, []);
  } finally {
    await worker.deactivate();
  }
});

test("server mode relays ttj.meta and ttj.call with Origin and Bearer token and strips forged actor/mode", async () => {
  const srv = await startFakeTtjServer({ authToken: "sample-token" });
  try {
    const host = mockHost({
      settings: {
        enabled: true,
        backendMode: "server",
        serverUrl: srv.url,
        authToken: "sample-token",
        autoRefreshSeconds: 15,
      },
    });
    const worker = await mountWorker(main, { host });
    try {
      const meta = await worker.request("ttj.meta");
      assert.equal(meta.actor, "ttjweb");
      assert.equal(meta.authEnabled, true);
      assert.equal(meta.backendMode, "server");

      const result = await worker.request("ttj.call", {
        method: "project.list",
        params: { actor: ["forged"], mode: "management" },
      });
      assert.equal(result.echoMethod, "project.list");
      assert.deepEqual(result.echoParams, {});
      assert.equal(result.items[0].record.id, "prj-test-1");

      const postCall = srv.received.find(r => r.url === "/api/call");
      assert.ok(postCall);
      assert.equal(postCall.headers.origin, srv.url);
      assert.equal(postCall.headers.authorization, "Bearer sample-token");
      assert.deepEqual(worker.refusals, []);
    } finally {
      await worker.deactivate();
    }
  } finally {
    await srv.close();
  }
});

test("ttj.call enforces method whitelist before contacting backend server", async () => {
  const srv = await startFakeTtjServer();
  try {
    const host = mockHost({
      settings: {
        enabled: true,
        backendMode: "server",
        serverUrl: srv.url,
        authToken: "",
      },
    });
    const worker = await mountWorker(main, { host });
    try {
      for (const blocked of ["document.import", "job.delete", "run.delete", "unknown.method", ""]) {
        await assert.rejects(() => worker.request("ttj.call", { method: blocked, params: {} }));
      }
      assert.equal(srv.received.length, 0, "blocked methods must never reach server");
      assert.deepEqual(worker.refusals, []);
    } finally {
      await worker.deactivate();
    }
  } finally {
    await srv.close();
  }
});

test("ttjweb.refresh posts refresh event only when enabled", async () => {
  const host = mockHost({ settings: { enabled: true } });
  const worker = await mountWorker(main, { host });
  try {
    await worker.command("ttjweb.refresh");
    assert.equal(worker.posts.filter(p => p.event === "ttj.refresh").length, 1);

    await worker.request("ttj.setEnabled", { enabled: false });
    await worker.command("ttjweb.refresh");
    assert.equal(worker.posts.filter(p => p.event === "ttj.refresh").length, 1);
    assert.deepEqual(worker.refusals, []);
  } finally {
    await worker.deactivate();
  }
});

// --- v0.2.0 Server Management & Tailscale Tests ---

test("ttj.serverStatus detects running process config into storage and reads Tailscale status without leaking secrets", async () => {
  const srv = await startFakeTtjServer({ allowHosts: ["sample-host.tail0000.ts.net:8878"] });
  try {
    const execCalls = [];
    main.setWorkerTestDeps({
      getPlatform: () => "win32",
      existsSync: () => false,
      execFileAsync: async (cmd, args) => {
        execCalls.push({ cmd, args });
        if (cmd === "tailscale" && args[0] === "status") {
          return {
            stdout: JSON.stringify({
              BackendState: "Running",
              Self: { DNSName: "sample-host.tail0000.ts.net." },
            }),
            stderr: "",
          };
        }
        if (cmd === "tailscale" && args[0] === "serve" && args[1] === "status") {
          return {
            stdout: JSON.stringify({
              TCP: { "443": { HTTPS: true }, [String(srv.port)]: { HTTPS: true } },
              Web: {
                "sample-host.tail0000.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:8080" } } },
                [`sample-host.tail0000.ts.net:${srv.port}`]: { Handlers: { "/": { Proxy: `http://127.0.0.1:${srv.port}` } } },
              },
            }),
            stderr: "",
          };
        }
        if (cmd === "wsl.exe" && args.includes("ps")) {
          return {
            stdout: [
              "  101 python3 server.py --core ~/sample/other/ttjcore --port 0",
              "  202 python3 server.py --core ~/sample/other/ttjcore --port 8877",
              `  303 python3 server.py --core ~/sample/path/ttjcore --home ~/sample/path/sample.profile --port ${srv.port} --allow-host sample-host.tail0000.ts.net:${srv.port} --auth-token sample-token --read-only`,
            ].join("\n"),
            stderr: "",
          };
        }
        if (cmd === "wsl.exe" && args.includes("readlink")) {
          return { stdout: "~/sample/path/ttjweb\n", stderr: "" };
        }
        throw new Error(`Unexpected command: ${cmd} ${args.join(" ")}`);
      },
    });

    const host = mockHost({
      settings: {
        enabled: true,
        backendMode: "server",
        serverUrl: srv.url,
        wslDistro: "sample-wsl-distro",
        mobileUrl: "",
        serverWorkdir: "",
        corePath: "",
        homePath: "",
      },
    });
    const worker = await mountWorker(main, { host });
    try {
      const status = await worker.request("ttj.serverStatus");
      assert.equal(status.running, true);
      assert.equal(status.port, srv.port);
      assert.equal(status.tailscaleAvailable, true);
      assert.equal(status.tailscaleDnsName, "sample-host.tail0000.ts.net");
      assert.equal(status.tailscaleServing, true);
      assert.equal(status.mobileUrl, `https://sample-host.tail0000.ts.net:${srv.port}/`);
      assert.equal(status.effectiveConfig.serverWorkdir, "~/sample/path/ttjweb");
      assert.equal(status.effectiveConfig.corePath, "~/sample/path/ttjcore");
      assert.equal(status.effectiveConfig.homePath, "~/sample/path/sample.profile");
      assert.equal(status.canStart, true);

      const stored = host.data().storage.lastServerConfig;
      assert.ok(stored);
      assert.equal(stored.serverWorkdir, "~/sample/path/ttjweb");
      assert.equal(stored.corePath, "~/sample/path/ttjcore");
      assert.equal(stored.homePath, "~/sample/path/sample.profile");
      assert.equal("authToken" in stored, false, "authToken must never be stored in storage");
      assert.deepEqual(worker.refusals, []);
    } finally {
      await worker.deactivate();
    }
  } finally {
    main.setWorkerTestDeps(null);
    await srv.close();
  }
});

test("ttj.tailscaleToggle only toggles target port and never runs tailscale serve reset", async () => {
  const port = await getFreePort();
  let serving = false;
  const tsCalls = [];

  main.setWorkerTestDeps({
    existsSync: () => false,
    execFileAsync: async (cmd, args) => {
      if (cmd === "tailscale") {
        tsCalls.push([...args]);
        if (args[0] === "status") {
          return {
            stdout: JSON.stringify({
              BackendState: "Running",
              Self: { DNSName: "sample-host.tail0000.ts.net." },
            }),
            stderr: "",
          };
        }
        if (args[0] === "serve" && args[1] === "status") {
          const web = {
            "sample-host.tail0000.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:8080" } } },
          };
          const tcp = { "443": { HTTPS: true } };
          if (serving) {
            web[`sample-host.tail0000.ts.net:${port}`] = { Handlers: { "/": { Proxy: `http://127.0.0.1:${port}` } } };
            tcp[String(port)] = { HTTPS: true };
          }
          return { stdout: JSON.stringify({ TCP: tcp, Web: web }), stderr: "" };
        }
        if (args[0] === "serve" && args[1] === "--bg") {
          serving = true;
          return { stdout: "Available within your tailnet\n", stderr: "" };
        }
        if (args[0] === "serve" && args[2] === "off") {
          serving = false;
          return { stdout: "", stderr: "" };
        }
      }
      throw Object.assign(new Error("not found"), { code: "ENOENT" });
    },
  });

  const host = mockHost({
    settings: {
      enabled: true,
      serverUrl: `http://127.0.0.1:${port}`,
    },
  });
  const worker = await mountWorker(main, { host });
  try {
    const onRes = await worker.request("ttj.tailscaleToggle", { enable: true });
    assert.equal(onRes.ok, true);
    assert.equal(onRes.enabled, true);
    assert.equal(onRes.status.tailscaleServing, true);

    const offRes = await worker.request("ttj.tailscaleToggle", { enable: false });
    assert.equal(offRes.ok, true);
    assert.equal(offRes.enabled, false);
    assert.equal(offRes.status.tailscaleServing, false);

    // Command toggle should turn it back ON
    const cmdMsg = await worker.command("ttjweb.toggleTailscale");
    assert.match(String(cmdMsg), /ON/);

    const serveMutators = tsCalls.filter(a => a[0] === "serve" && a[1] !== "status");
    assert.deepEqual(serveMutators, [
      ["serve", "--bg", `--https=${port}`, `http://127.0.0.1:${port}`],
      ["serve", `--https=${port}`, "off"],
      ["serve", "--bg", `--https=${port}`, `http://127.0.0.1:${port}`],
    ]);
    for (const args of tsCalls) {
      assert.equal(args.includes("reset"), false, "tailscale serve reset must NEVER be called");
      assert.equal(args.includes("--https=443"), false, "other ports like 443 must NEVER be touched");
    }
    assert.deepEqual(worker.refusals, []);
  } finally {
    main.setWorkerTestDeps(null);
    await worker.deactivate();
  }
});

test("ttj.serverStart requires workdir and corePath, spawns with auto Tailscale allow-host, and resident OFF does NOT stop server", async () => {
  const port = await getFreePort();
  let fakeServerRunning = false;
  let fakeServerKillCalls = 0;
  const spawned = [];

  main.setWorkerTestDeps({
    getPlatform: () => "win32",
    existsSync: () => false,
    pollIntervalMs: 25,
    startTimeoutMs: 1500,
    stopTimeoutMs: 1500,
    fetch: async (url) => {
      if (!fakeServerRunning) {
        const err = new Error("connect ECONNREFUSED");
        err.cause = { code: "ECONNREFUSED" };
        throw err;
      }
      if (String(url).endsWith("/api/meta")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            actor: "ttjweb",
            protocol: "TTJ/1.1.0",
            watch_prefix: "ttjcore",
            allowHosts: [`sample-other.tail0000.ts.net:${port}`],
            readOnly: true,
            authEnabled: false,
          }),
        };
      }
      return { ok: false, status: 404, text: async () => "{}" };
    },
    execFileAsync: async (cmd, args) => {
      if (cmd === "tailscale" && args[0] === "status") {
        return {
          stdout: JSON.stringify({
            BackendState: "Running",
            Self: { DNSName: "sample-other.tail0000.ts.net." },
          }),
          stderr: "",
        };
      }
      if (cmd === "tailscale" && args[0] === "serve") {
        return { stdout: JSON.stringify({ TCP: {}, Web: {} }), stderr: "" };
      }
      if (cmd === "wsl.exe" && args.includes("ps")) {
        return { stdout: "", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
    spawnProcess: (cmd, args, opts) => {
      spawned.push({ cmd, args, opts });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {
        fakeServerKillCalls++;
        fakeServerRunning = false;
        child.emit("exit", 0);
      };
      setTimeout(() => {
        fakeServerRunning = true;
      }, 30);
      return child;
    },
  });

  const host = mockHost({
    settings: {
      enabled: true,
      serverUrl: `http://127.0.0.1:${port}`,
      wslDistro: "sample-wsl-distro",
      serverWorkdir: "",
      corePath: "",
      homePath: "",
      serverAllowHosts: "",
      serverReadOnly: true,
    },
  });
  const worker = await mountWorker(main, { host });
  try {
    // Missing config must reject with clear Japanese guidance
    await assert.rejects(
      () => worker.request("ttj.serverStart"),
      /起動設定で TTJWeb フォルダと ttjcore パスを設定してください/,
    );

    // Save config via ttj.saveServerConfig
    const saveRes = await worker.request("ttj.saveServerConfig", {
      serverWorkdir: "~/sample/path/ttjweb",
      corePath: "~/sample/path/ttjcore",
      homePath: "~/sample/path/sample.profile",
      wslDistro: "sample-wsl-distro",
      serverReadOnly: true,
    });
    assert.equal(saveRes.ok, true);
    assert.equal(host.data().settings.serverWorkdir, "~/sample/path/ttjweb");

    // Start server
    const startRes = await worker.request("ttj.serverStart");
    assert.equal(startRes.ok, true);
    assert.equal(startRes.running, true);
    assert.equal(startRes.alreadyRunning, false);
    assert.equal(spawned.length, 1);
    assert.equal(spawned[0].cmd, "wsl.exe");
    assert.deepEqual(spawned[0].args, [
      "-d", "sample-wsl-distro",
      "--cd", "~/sample/path/ttjweb",
      "--", "python3",
      "server.py",
      "--core", "~/sample/path/ttjcore",
      "--home", "~/sample/path/sample.profile",
      "--port", String(port),
      "--allow-host", `sample-other.tail0000.ts.net:${port}`,
      "--read-only",
    ]);

    // Turning resident OFF via panel or command must NOT stop the server
    await worker.request("ttj.setEnabled", { enabled: false });
    assert.equal(fakeServerRunning, true, "server must stay running when resident is toggled OFF");
    assert.equal(fakeServerKillCalls, 0);

    await worker.command("ttjweb.toggleEnabled"); // back ON
    await worker.command("ttjweb.toggleEnabled"); // OFF again
    assert.equal(fakeServerRunning, true, "server must stay running on toggleEnabled command OFF");
    assert.equal(fakeServerKillCalls, 0);

    // Explicit stop stops the server
    const stopRes = await worker.request("ttj.serverStop");
    assert.equal(stopRes.ok, true);
    assert.equal(stopRes.running, false);
    assert.equal(fakeServerRunning, false);
    assert.equal(fakeServerKillCalls, 1);
    assert.deepEqual(worker.refusals, []);
  } finally {
    main.setWorkerTestDeps(null);
    await worker.deactivate();
  }
});

test("ttj.serverStop on external server kills ONLY exact target port server.py PID and never touches other ports", async () => {
  const targetPort = await getFreePort();
  let running = true;
  const killedPids = [];

  main.setWorkerTestDeps({
    getPlatform: () => "win32",
    existsSync: () => false,
    pollIntervalMs: 25,
    stopTimeoutMs: 1500,
    fetch: async () => {
      if (!running) {
        const err = new Error("ECONNREFUSED");
        err.cause = { code: "ECONNREFUSED" };
        throw err;
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ actor: "ttjweb", protocol: "TTJ/1.1.0", watch_prefix: "ttjcore" }),
      };
    },
    execFileAsync: async (cmd, args) => {
      if (cmd === "tailscale") {
        throw Object.assign(new Error("no tailscale"), { code: "ENOENT" });
      }
      if (cmd === "wsl.exe" && args.includes("ps")) {
        return {
          stdout: [
            "  111 python3 server.py --core ~/sample/path/ttjcore --port 8877",
            "  222 python3 server.py --core ~/sample/path/ttjcore --port 8878",
            "  333 python3 server.py --core ~/sample/path/ttjcore --port 0",
            `  444 python3 other_app.py --port ${targetPort}`,
            `  555 python3 server.py --core ~/sample/path/ttjcore --home ~/sample/path/sample.profile --port ${targetPort}`,
          ].join("\n"),
          stderr: "",
        };
      }
      if (cmd === "wsl.exe" && args.includes("readlink")) {
        return { stdout: "~/sample/path/ttjweb\n", stderr: "" };
      }
      if (cmd === "wsl.exe" && args.includes("kill")) {
        const pid = Number(args[args.length - 1]);
        killedPids.push(pid);
        if (pid === 555) running = false;
        return { stdout: "", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
  });

  const host = mockHost({
    settings: {
      enabled: true,
      serverUrl: `http://127.0.0.1:${targetPort}`,
      wslDistro: "sample-wsl-distro",
    },
  });
  const worker = await mountWorker(main, { host });
  try {
    const res = await worker.request("ttj.serverStop");
    assert.equal(res.ok, true);
    assert.equal(res.running, false);
    assert.deepEqual(killedPids, [555], "must ONLY kill PID 555 matching server.py and targetPort");
    // Config should have been remembered before stop
    assert.equal(host.data().storage.lastServerConfig.serverWorkdir, "~/sample/path/ttjweb");
    assert.equal(host.data().storage.lastServerConfig.corePath, "~/sample/path/ttjcore");
    assert.deepEqual(worker.refusals, []);
  } finally {
    main.setWorkerTestDeps(null);
    await worker.deactivate();
  }
});

test("real isolated child process start and stop on ephemeral port cleans up cleanly", async () => {
  const freePort = await getFreePort();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ttjweb-plugin-test-"));
  const fakeServerScript = [
    "import argparse, json, signal, sys",
    "from http.server import BaseHTTPRequestHandler, HTTPServer",
    "parser = argparse.ArgumentParser()",
    "parser.add_argument('--core', required=True)",
    "parser.add_argument('--home', default='')",
    "parser.add_argument('--port', type=int, required=True)",
    "parser.add_argument('--allow-host', action='append', default=[])",
    "parser.add_argument('--read-only', action='store_true')",
    "args = parser.parse_args()",
    "class H(BaseHTTPRequestHandler):",
    "    def log_message(self, *a): pass",
    "    def do_GET(self):",
    "        if self.path == '/api/meta':",
    "            body = json.dumps({'actor':'ttjweb','protocol':'TTJ/1.1.0','watch_prefix':'ttjcore','allowHosts':args.allow_host,'readOnly':args.read_only,'authEnabled':False}).encode()",
    "            self.send_response(200)",
    "            self.send_header('Content-Type','application/json')",
    "            self.send_header('Content-Length', str(len(body)))",
    "            self.end_headers()",
    "            self.wfile.write(body)",
    "        else:",
    "            self.send_response(404)",
    "            self.end_headers()",
    "srv = HTTPServer(('127.0.0.1', args.port), H)",
    "signal.signal(signal.SIGTERM, lambda *a: sys.exit(0))",
    "srv.serve_forever()",
  ].join("\n");
  fs.writeFileSync(path.join(tmpDir, "server.py"), fakeServerScript, "utf8");

  // Disable tailscale lookup in this real-spawn test so it doesn't touch host tailscale
  main.setWorkerTestDeps({
    existsSync: () => false,
    execFileAsync: async () => {
      throw Object.assign(new Error("disabled in test"), { code: "ENOENT" });
    },
    startTimeoutMs: 5000,
    stopTimeoutMs: 3000,
  });

  const host = mockHost({
    settings: {
      enabled: true,
      serverUrl: `http://127.0.0.1:${freePort}`,
      wslDistro: "", // run native python in tmpDir
      serverWorkdir: tmpDir,
      corePath: "~/sample/path/ttjcore",
      homePath: "",
      serverAllowHosts: "",
      serverReadOnly: false,
    },
  });
  const worker = await mountWorker(main, { host });
  try {
    const started = await worker.request("ttj.serverStart");
    assert.equal(started.ok, true);
    assert.equal(started.running, true);
    assert.equal(started.status.managedByPlugin, true);

    const statusWhileRunning = await worker.request("ttj.serverStatus");
    assert.equal(statusWhileRunning.running, true);

    const stopped = await worker.request("ttj.serverStop");
    assert.equal(stopped.ok, true);
    assert.equal(stopped.running, false);
    assert.deepEqual(worker.refusals, []);
  } finally {
    await worker.deactivate();
    main.setWorkerTestDeps(null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("server mode relays run.progress payload intact and propagates server error status", async () => {
  const srv = await startFakeTtjServer();
  try {
    const host = mockHost({
      settings: {
        enabled: true,
        backendMode: "server",
        serverUrl: srv.url,
        authToken: "",
      },
    });
    const worker = await mountWorker(main, { host });
    try {
      const result = await worker.request("ttj.call", {
        method: "run.progress",
        params: {
          ticket_id: "tkt-abc-1",
          id: "run-abc-1",
          revision: 3,
          percent: 75,
          message: "検証中",
          actor: ["forged"],
          mode: "management",
        },
      });
      assert.equal(result.echoMethod, "run.progress");
      assert.deepEqual(result.echoParams, {
        ticket_id: "tkt-abc-1",
        id: "run-abc-1",
        revision: 3,
        percent: 75,
        message: "検証中",
      });
      assert.deepEqual(worker.refusals, []);
    } finally {
      await worker.deactivate();
    }
  } finally {
    await srv.close();
  }
});

test("default wslDistro is empty, Windows tailscale paths resolve from env, and toWslPath converts drive paths", async () => {
  const host = mockHost({ settings: { enabled: true } });
  const worker = await mountWorker(main, { host });
  try {
    const state = await worker.request("ttj.state");
    assert.equal(state.wslDistro, "");
  } finally {
    await worker.deactivate();
  }

  const fakeRoot = ["sample-root", "Programs"].join("\\");
  const fakeRootX86 = ["sample-root", "Programs-x86"].join("\\");
  const candidates = main.getWindowsTailscalePaths({
    ProgramFiles: fakeRoot,
    "ProgramFiles(x86)": fakeRootX86,
  });
  assert.deepEqual(candidates, [
    `${fakeRoot}\\Tailscale\\tailscale.exe`,
    `${fakeRootX86}\\Tailscale\\tailscale.exe`,
  ]);
  assert.deepEqual(main.getWindowsTailscalePaths({}), []);

  assert.equal(main.toWslPath("~/sample/path/ttjweb"), "~/sample/path/ttjweb");
  const syntheticDrivePath = ["X", ":", "\\", "sample", "\\", "ttjweb"].join("");
  const expectedMountPath = ["", "mnt", "x", "sample", "ttjweb"].join("/");
  assert.equal(main.toWslPath(syntheticDrivePath), expectedMountPath);
});
