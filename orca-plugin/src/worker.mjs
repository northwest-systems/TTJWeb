import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const READ = new Set([
  "project.list",
  "project.snapshot",
  "ticket.snapshot",
  "worker.list",
  "session.list",
  "knowledge.get",
  "knowledge.list",
  "events.wait",
]);

const MANAGE = new Set([
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
]);

const EXECUTE = new Set(["run.start", "run.finish", "run.progress"]);

const DEFAULTS = {
  enabled: true,
  backendMode: "server",
  serverUrl: "http://127.0.0.1:8878",
  authToken: "",
  corePath: "",
  homePath: "",
  wslDistro: "",
  autoRefreshSeconds: 10,
  mobileUrl: "",
  serverWorkdir: "",
  serverAllowHosts: "",
  serverReadOnly: false,
};

const DEFAULT_ACTOR = "ttjweb";
const STATUS_BAR_ID = "ttjweb-status";
const LAST_SERVER_CONFIG_KEY = "lastServerConfig";

const EDITABLE_SERVER_CONFIG_KEYS = new Set([
  "serverWorkdir",
  "corePath",
  "homePath",
  "wslDistro",
  "serverUrl",
  "serverAllowHosts",
  "serverReadOnly",
  "mobileUrl",
]);

let activeDisposables = [];
let activeManagedServer = null;

function defaultExecFileAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        encoding: "utf8",
        timeout: 15000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        ...options,
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout || "";
          error.stderr = stderr || "";
          reject(error);
          return;
        }
        resolve({ stdout: stdout || "", stderr: stderr || "" });
      },
    );
  });
}

const DEFAULT_DEPS = {
  execFileAsync: defaultExecFileAsync,
  spawnProcess: (command, args, options) => spawn(command, args, options),
  fetch: (...args) => globalThis.fetch(...args),
  existsSync: p => fs.existsSync(p),
  getPlatform: () => process.platform,
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  pollIntervalMs: 200,
  startTimeoutMs: 5000,
  stopTimeoutMs: 3000,
};

let runtimeDeps = { ...DEFAULT_DEPS };

export function setWorkerTestDeps(overrides) {
  runtimeDeps = overrides ? { ...DEFAULT_DEPS, ...overrides } : { ...DEFAULT_DEPS };
}

export function normalizeUrl(raw) {
  const trimmed = String(raw || "").trim() || DEFAULTS.serverUrl;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`接続先 URL が不正です: ${trimmed}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`接続先 URL は http:// または https:// で指定してください: ${trimmed}`);
  }
  return parsed;
}

export function extractPortFromUrl(rawUrl) {
  try {
    const parsed = normalizeUrl(rawUrl);
    if (parsed.port) {
      const p = Number(parsed.port);
      if (Number.isInteger(p) && p >= 1 && p <= 65535) return p;
    }
    return parsed.protocol === "https:" ? 443 : 80;
  } catch {
    return 8878;
  }
}

export function toWslPath(rawPath) {
  const trimmed = String(rawPath || "").trim();
  if (!trimmed) return "";
  const winDrive = trimmed.match(/^([A-Za-z]):[\\/](.*)$/);
  if (winDrive) {
    const drive = winDrive[1].toLowerCase();
    const rest = winDrive[2].replace(/\\/g, "/");
    return `/mnt/${drive}/${rest}`;
  }
  return trimmed;
}

export function parseAllowHostsList(raw) {
  if (Array.isArray(raw)) {
    return Array.from(
      new Set(
        raw
          .flatMap(item => String(item || "").split(","))
          .map(s => s.trim())
          .filter(Boolean),
      ),
    );
  }
  return Array.from(
    new Set(
      String(raw || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean),
    ),
  );
}

export function splitShellArgs(line) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaped = false;
  const input = String(line || "");

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      // Preserve Windows backslashes when followed by non-space/non-quote
      const next = input[i + 1];
      if (next === " " || next === '"' || next === "'" || next === "\\") {
        escaped = true;
        continue;
      }
      current += ch;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function isPythonExecutable(token) {
  const base = path.posix.basename(String(token || "").replace(/\\/g, "/")).toLowerCase();
  return /^python(\d+(\.\d+)*)?(\.exe)?$/.test(base) || base === "py" || base === "py.exe";
}

function isServerPyScript(token) {
  const base = path.posix.basename(String(token || "").replace(/\\/g, "/")).toLowerCase();
  return base === "server.py";
}

export function parseServerPyArgs(argsList) {
  if (!Array.isArray(argsList) || argsList.length < 2) {
    return { matched: false };
  }
  const pyIdx = argsList.findIndex(tok => isPythonExecutable(tok));
  if (pyIdx < 0) return { matched: false };
  let scriptIdx = -1;
  for (let i = pyIdx + 1; i < argsList.length; i++) {
    if (isServerPyScript(argsList[i])) {
      scriptIdx = i;
      break;
    }
  }
  if (scriptIdx < 0) return { matched: false };

  let port = 8765;
  let explicitPort = false;
  let corePath = "";
  let homePath = "";
  const allowHosts = [];
  let readOnly = false;

  const rest = argsList.slice(scriptIdx + 1);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--port" && i + 1 < rest.length) {
      const parsed = Number(rest[++i]);
      if (Number.isInteger(parsed)) {
        port = parsed;
        explicitPort = true;
      }
    } else if (arg.startsWith("--port=")) {
      const parsed = Number(arg.slice("--port=".length));
      if (Number.isInteger(parsed)) {
        port = parsed;
        explicitPort = true;
      }
    } else if (arg === "--core" && i + 1 < rest.length) {
      corePath = rest[++i];
    } else if (arg.startsWith("--core=")) {
      corePath = arg.slice("--core=".length);
    } else if (arg === "--home" && i + 1 < rest.length) {
      homePath = rest[++i];
    } else if (arg.startsWith("--home=")) {
      homePath = arg.slice("--home=".length);
    } else if (arg === "--allow-host" && i + 1 < rest.length) {
      allowHosts.push(...parseAllowHostsList(rest[++i]));
    } else if (arg.startsWith("--allow-host=")) {
      allowHosts.push(...parseAllowHostsList(arg.slice("--allow-host=".length)));
    } else if (arg === "--read-only") {
      readOnly = true;
    } else if (arg === "--auth-token" && i + 1 < rest.length) {
      // Skip value intentionally so secrets are never captured
      i++;
    }
  }

  return {
    matched: true,
    scriptPath: argsList[scriptIdx],
    port,
    explicitPort,
    corePath,
    homePath,
    allowHosts: Array.from(new Set(allowHosts)),
    readOnly,
  };
}

export function matchServerPyProcessLine(line, targetPort) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d+)\s+(.+)$/);
  if (!match) return null;
  const pid = Number(match[1]);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const tokens = splitShellArgs(match[2]);
  const parsed = parseServerPyArgs(tokens);
  if (!parsed.matched) return null;
  if (!Number.isInteger(targetPort) || targetPort <= 0) return null;
  if (parsed.port !== targetPort) return null;
  return { pid, ...parsed };
}

export function buildServerStartArgs({ port, corePath, homePath, allowHosts, authToken, readOnly }) {
  const args = ["server.py", "--core", String(corePath)];
  if (homePath) {
    args.push("--home", String(homePath));
  }
  args.push("--port", String(port));
  for (const host of parseAllowHostsList(allowHosts)) {
    args.push("--allow-host", host);
  }
  if (authToken) {
    args.push("--auth-token", String(authToken));
  }
  if (readOnly) {
    args.push("--read-only");
  }
  return args;
}

export function buildMobileUrl({ configuredMobileUrl, tailscaleDnsName, port }) {
  const explicit = String(configuredMobileUrl || "").trim();
  if (explicit) return explicit;
  const dns = String(tailscaleDnsName || "").trim().replace(/\.+$/, "");
  if (!dns) return "";
  const p = Number(port);
  if (!Number.isInteger(p) || p === 443) {
    return `https://${dns}/`;
  }
  return `https://${dns}:${p}/`;
}

export function parseTailscaleServeStatus({ jsonOutput = "", textOutput = "", dnsName = "", port }) {
  const p = Number(port);
  if (!Number.isInteger(p) || p <= 0) return false;
  const normalizedDns = String(dnsName || "").trim().toLowerCase().replace(/\.+$/, "");

  if (jsonOutput && jsonOutput.trim()) {
    try {
      const parsed = JSON.parse(jsonOutput);
      if (parsed && typeof parsed === "object") {
        const web = parsed.Web && typeof parsed.Web === "object" ? parsed.Web : {};
        for (const [hostPort, entry] of Object.entries(web)) {
          const lower = hostPort.toLowerCase();
          const hasHandlers = entry && typeof entry === "object" && entry.Handlers && Object.keys(entry.Handlers).length > 0;
          if (!hasHandlers) continue;
          if (normalizedDns && lower === `${normalizedDns}:${p}`) return true;
          if (lower.endsWith(`:${p}`)) return true;
        }
        const tcp = parsed.TCP && typeof parsed.TCP === "object" ? parsed.TCP : {};
        if (tcp[String(p)] && (tcp[String(p)].HTTPS || tcp[String(p)].HTTP)) {
          return true;
        }
        return false;
      }
    } catch {
      // Fall through to text parsing
    }
  }

  if (textOutput && textOutput.trim()) {
    const lines = textOutput.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim().toLowerCase();
      if (!line.startsWith("https://") && !line.startsWith("http://")) continue;
      if (p === 443) {
        if (normalizedDns) {
          if (
            line.startsWith(`https://${normalizedDns} `) ||
            line === `https://${normalizedDns}` ||
            line.startsWith(`https://${normalizedDns}:443`)
          ) {
            return true;
          }
        } else if (/^https:\/\/[^:\s/]+(?:\s|$|:443(?:\s|$))/.test(line)) {
          return true;
        }
      } else {
        const suffixPattern = new RegExp(`:${p}(?:\\s|/|$)`);
        if (suffixPattern.test(line)) {
          if (!normalizedDns || line.includes(normalizedDns)) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

function clampRefreshSeconds(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULTS.autoRefreshSeconds;
  return Math.max(0, Math.min(300, Math.round(num)));
}

async function readSetting(orca, key, fallback) {
  try {
    if (orca.settings && typeof orca.settings.get === "function") {
      const value = await orca.settings.get(key);
      return value === undefined ? fallback : value;
    }
  } catch {
    // Fall through to host.call
  }
  try {
    const res = await orca.host.call("settings.get", {});
    const map = res?.settings || {};
    return Object.hasOwn(map, key) && map[key] !== undefined ? map[key] : fallback;
  } catch {
    return fallback;
  }
}

async function writeSetting(orca, key, value) {
  if (orca.settings && typeof orca.settings.set === "function") {
    await orca.settings.set(key, value);
    return;
  }
  await orca.host.call("settings.set", { key, value });
}

async function readStorage(orca, key, fallback = null) {
  try {
    if (orca.storage && typeof orca.storage.get === "function") {
      const value = await orca.storage.get(key);
      return value === undefined || value === null ? fallback : value;
    }
  } catch {
    // Fall through to host.call
  }
  try {
    const res = await orca.host.call("storage.get", { key });
    const value = res?.value;
    return value === undefined || value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

async function writeStorage(orca, key, value) {
  try {
    if (orca.storage && typeof orca.storage.set === "function") {
      await orca.storage.set(key, value);
      return;
    }
    await orca.host.call("storage.set", { key, value });
  } catch (error) {
    orca.log?.(`storage.set(${key}) skipped: ${error?.message || String(error)}`);
  }
}

async function readConfig(orca) {
  const [
    enabled,
    backendMode,
    serverUrl,
    authToken,
    corePath,
    homePath,
    wslDistro,
    autoRefreshSeconds,
    mobileUrl,
    serverWorkdir,
    serverAllowHosts,
    serverReadOnly,
  ] = await Promise.all([
    readSetting(orca, "enabled", DEFAULTS.enabled),
    readSetting(orca, "backendMode", DEFAULTS.backendMode),
    readSetting(orca, "serverUrl", DEFAULTS.serverUrl),
    readSetting(orca, "authToken", DEFAULTS.authToken),
    readSetting(orca, "corePath", DEFAULTS.corePath),
    readSetting(orca, "homePath", DEFAULTS.homePath),
    readSetting(orca, "wslDistro", DEFAULTS.wslDistro),
    readSetting(orca, "autoRefreshSeconds", DEFAULTS.autoRefreshSeconds),
    readSetting(orca, "mobileUrl", DEFAULTS.mobileUrl),
    readSetting(orca, "serverWorkdir", DEFAULTS.serverWorkdir),
    readSetting(orca, "serverAllowHosts", DEFAULTS.serverAllowHosts),
    readSetting(orca, "serverReadOnly", DEFAULTS.serverReadOnly),
  ]);

  return {
    enabled: Boolean(enabled),
    backendMode: backendMode === "ttjcore" ? "ttjcore" : "server",
    serverUrl: String(serverUrl || DEFAULTS.serverUrl).trim(),
    authToken: typeof authToken === "string" ? authToken : "",
    corePath: typeof corePath === "string" ? corePath.trim() : "",
    homePath: typeof homePath === "string" ? homePath.trim() : "",
    wslDistro: typeof wslDistro === "string" ? wslDistro.trim() : "",
    autoRefreshSeconds: clampRefreshSeconds(autoRefreshSeconds),
    mobileUrl: typeof mobileUrl === "string" ? mobileUrl.trim() : "",
    serverWorkdir: typeof serverWorkdir === "string" ? serverWorkdir.trim() : "",
    serverAllowHosts: typeof serverAllowHosts === "string" ? serverAllowHosts.trim() : "",
    serverReadOnly: Boolean(serverReadOnly),
  };
}

function toPublicState(config, runtime) {
  return {
    enabled: config.enabled,
    backendMode: config.backendMode,
    serverUrl: config.serverUrl,
    hasAuthToken: Boolean(config.authToken),
    corePath: config.corePath,
    homePath: config.homePath,
    wslDistro: config.wslDistro,
    autoRefreshSeconds: config.autoRefreshSeconds,
    mobileUrl: config.mobileUrl,
    serverWorkdir: config.serverWorkdir,
    serverAllowHosts: config.serverAllowHosts,
    serverReadOnly: config.serverReadOnly,
    connected: config.enabled ? runtime.connected : false,
    lastError: config.enabled ? runtime.lastError : null,
    lastUpdatedAt: runtime.lastUpdatedAt,
  };
}

async function syncStatusBar(orca, config) {
  const payload = config.enabled
    ? {
        id: STATUS_BAR_ID,
        text: "TTJ: ON",
        tone: "accent",
        tooltip: "TTJWeb 常駐 ON — クリックで OFF に切り替え",
      }
    : {
        id: STATUS_BAR_ID,
        text: "TTJ: OFF",
        tone: "neutral",
        tooltip: "TTJWeb 常駐 OFF — クリックで ON に切り替え",
      };
  try {
    await orca.host.call("statusBar.update", payload);
  } catch (error) {
    orca.log?.(`statusBar.update skipped: ${error?.message || String(error)}`);
  }
}

function formatFetchError(error, serverUrl) {
  if (error?.name === "AbortError") {
    return "TTJWeb サーバーへの接続がタイムアウトまたは中断されました。";
  }
  const causeCode = error?.cause?.code || error?.code || "";
  if (causeCode === "ECONNREFUSED") {
    return `TTJWeb サーバー (${serverUrl}) へ接続できません。サーバーが起動しているか確認してください。`;
  }
  if (causeCode === "ENOTFOUND") {
    return `TTJWeb サーバーのホストが見つかりません (${serverUrl})。設定の URL を確認してください。`;
  }
  return `TTJWeb サーバー (${serverUrl}) への通信に失敗しました: ${error?.message || String(error)}`;
}

async function fetchJsonFromServer(config, endpointPath, { method = "GET", body = null, signal, timeoutMs = 0 } = {}) {
  const baseUrl = normalizeUrl(config.serverUrl);
  const target = new URL(endpointPath, baseUrl);
  const headers = { Accept: "application/json" };
  if (config.authToken) {
    headers.Authorization = `Bearer ${config.authToken}`;
  }
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
    headers.Origin = baseUrl.origin;
  }

  let controller = null;
  let timer = null;
  let effectiveSignal = signal;
  if (timeoutMs > 0) {
    controller = new AbortController();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    timer = setTimeout(() => controller.abort(), timeoutMs);
    effectiveSignal = controller.signal;
  }

  let response;
  try {
    response = await runtimeDeps.fetch(target, {
      method,
      headers,
      body: body !== null ? JSON.stringify(body) : undefined,
      signal: effectiveSignal,
    });
  } catch (error) {
    throw new Error(formatFetchError(error, baseUrl.origin));
  } finally {
    if (timer) clearTimeout(timer);
  }

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = null;
  }

  if (response.status === 401) {
    throw new Error("TTJWeb サーバーで認証エラー (401) が発生しました。プラグイン設定の authToken を確認してください。");
  }
  if (response.status === 403) {
    throw new Error(parsed?.error || "TTJWeb サーバーによりアクセスが拒否されました (403)。--allow-host または --read-only 設定を確認してください。");
  }
  if (!response.ok) {
    const err = new Error(parsed?.error || `TTJWeb サーバーがエラー (${response.status}) を返しました。`);
    err.status = response.status;
    throw err;
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("TTJWeb サーバーから有効な JSON 応答を受け取れませんでした。");
  }
  return parsed;
}

async function probeServerMeta(config, { signal, timeoutMs = 2000 } = {}) {
  try {
    const meta = await fetchJsonFromServer(config, "/api/meta", { signal, timeoutMs });
    return { running: true, meta, error: null };
  } catch (error) {
    if (error?.status === 404) {
      try {
        const meta = await fetchJsonFromServer(config, "/api/config", { signal, timeoutMs });
        return { running: true, meta, error: null };
      } catch (err2) {
        return { running: false, meta: null, error: err2?.message || String(err2) };
      }
    }
    return { running: false, meta: null, error: error?.message || String(error) };
  }
}

function buildWatchPrefix(config) {
  const exe = config.corePath || "ttjcore";
  const parts = [exe];
  if (config.homePath) parts.push("--home", config.homePath);
  if (runtimeDeps.getPlatform() === "win32" && config.wslDistro) {
    const wslParts = ["wsl", "-d", config.wslDistro, "--", ...parts];
    return "& " + wslParts.map(p => `'${p.replace(/'/g, "''")}'`).join(" ");
  }
  if (runtimeDeps.getPlatform() === "win32") {
    return "& " + parts.map(p => `'${p.replace(/'/g, "''")}'`).join(" ");
  }
  return parts.join(" ");
}

function execTtjCoreRpc(config, method, params, { signal } = {}) {
  const coreExe = config.corePath || "ttjcore";
  const coreArgs = [];
  if (config.homePath) {
    coreArgs.push("--home", config.homePath);
  }
  coreArgs.push("rpc");

  const useWsl = runtimeDeps.getPlatform() === "win32" && Boolean(config.wslDistro);
  const command = useWsl ? "wsl.exe" : coreExe;
  const args = useWsl ? ["-d", config.wslDistro, "--", coreExe, ...coreArgs] : coreArgs;

  const payload = JSON.stringify({
    jsonrpc: "2.0",
    protocol: "TTJ/1.1.0",
    id: "orca-plugin",
    method,
    params: params || {},
  }) + "\n";

  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      {
        encoding: "utf8",
        timeout: 35000,
        maxBuffer: 16 * 1024 * 1024,
        signal,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error && !stdout) {
          reject(new Error(`ttjcore の実行に失敗しました。corePath / homePath / wslDistro を確認してください (${error.message})。`));
          return;
        }
        let response;
        try {
          response = JSON.parse(String(stdout || "").trim());
        } catch {
          reject(new Error((stderr || "").trim() || "ttjcore の応答を読み取れませんでした。"));
          return;
        }
        if (response.error) {
          reject(new Error(response.error.message || "ttjcore RPC エラー"));
          return;
        }
        if (!Object.hasOwn(response, "result")) {
          reject(new Error("ttjcore の呼び出しに失敗しました。"));
          return;
        }
        const value = response.result;
        resolve(value && typeof value === "object" && Object.hasOwn(value, "value") ? value.value : value);
      },
    );
    if (child.stdin) {
      child.stdin.end(payload, "utf8");
    }
  });
}

async function callTtjCoreWhitelisted(config, method, rawParams, { signal } = {}) {
  if (!READ.has(method) && !MANAGE.has(method) && !EXECUTE.has(method)) {
    throw new Error("この操作は TTJWeb プラグインから利用できません。");
  }
  const params = { ...(rawParams && typeof rawParams === "object" ? rawParams : {}) };
  delete params.actor;
  delete params.mode;

  if (READ.has(method)) {
    return execTtjCoreRpc(config, method, params, { signal });
  }
  if (method === "task.purge") {
    if (typeof params.reason !== "string" || !params.reason.trim()) {
      delete params.reason;
    } else {
      params.reason = params.reason.trim();
    }
  } else if (typeof params.reason !== "string" || !params.reason.trim()) {
    params.reason = `TTJWeb: ${method}`;
  } else {
    params.reason = params.reason.trim();
  }
  if (MANAGE.has(method)) {
    params.actor = [DEFAULT_ACTOR];
    params.mode = "management";
    return execTtjCoreRpc(config, method, params, { signal });
  }
  const ticketId = params.ticket_id;
  delete params.ticket_id;
  if (typeof ticketId !== "string" || !ticketId) {
    throw new Error("実行対象の Ticket が必要です。");
  }
  const snapshot = await execTtjCoreRpc(config, "ticket.snapshot", { id: ticketId }, { signal });
  const ticket = snapshot?.ticket?.record;
  const job = snapshot?.job;
  const run = snapshot?.run;
  const valid = Boolean(ticket) && (method === "run.start"
    ? Boolean(job && params.job === job.record?.id)
    : Boolean(run && run.active && params.id === run.record?.id));
  if (!valid) {
    throw new Error("対象の Job・Run が変わっています。最新の状態を確認してください。");
  }
  params.actor = [ticket.worker_id, ticket.session_id];
  params.mode = "execution";
  return execTtjCoreRpc(config, method, params, { signal });
}

export function getWindowsTailscalePaths(env = process.env) {
  const roots = [env?.ProgramFiles, env?.["ProgramFiles(x86)"]].filter(
    value => typeof value === "string" && value.trim().length > 0,
  );
  const seen = new Set();
  const candidates = [];
  for (const root of roots) {
    const full = path.win32.join(root.trim(), "Tailscale", "tailscale.exe");
    const key = full.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(full);
    }
  }
  return candidates;
}

function getTailscaleCandidates() {
  const candidates = ["tailscale"];
  if (runtimeDeps.getPlatform() === "win32") {
    for (const candidate of getWindowsTailscalePaths()) {
      if (runtimeDeps.existsSync(candidate)) {
        candidates.push(candidate);
      }
    }
  }
  return candidates;
}

async function runTailscaleCommand(args, { timeout = 8000 } = {}) {
  const candidates = getTailscaleCandidates();
  let lastError = null;
  for (const bin of candidates) {
    try {
      const result = await runtimeDeps.execFileAsync(bin, args, { timeout });
      return { bin, ...result };
    } catch (error) {
      lastError = error;
      if (error?.code !== "ENOENT") {
        // Binary was found but exited with non-zero; do not retry fallback unless ENOENT
        throw error;
      }
    }
  }
  throw lastError || new Error("Tailscale コマンドが見つかりません。");
}

async function getTailscaleStatus(port) {
  let statusJson = null;
  let tailscaleBin = null;
  try {
    const res = await runTailscaleCommand(["status", "--json"], { timeout: 6000 });
    tailscaleBin = res.bin;
    statusJson = JSON.parse(res.stdout || "{}");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        tailscaleAvailable: false,
        tailscaleRunning: false,
        tailscaleDnsName: "",
        tailscaleServing: false,
        tailscaleUrl: "",
      };
    }
    return {
      tailscaleAvailable: false,
      tailscaleRunning: false,
      tailscaleDnsName: "",
      tailscaleServing: false,
      tailscaleUrl: "",
    };
  }

  const backendState = String(statusJson?.BackendState || "");
  const tailscaleRunning = backendState === "Running";
  const tailscaleDnsName = String(statusJson?.Self?.DNSName || "").trim().replace(/\.+$/, "");

  let serveJson = "";
  let serveText = "";
  try {
    const res = await runtimeDeps.execFileAsync(tailscaleBin || "tailscale", ["serve", "status", "--json"], { timeout: 6000 });
    serveJson = res.stdout || "";
  } catch {
    try {
      const res = await runtimeDeps.execFileAsync(tailscaleBin || "tailscale", ["serve", "status"], { timeout: 6000 });
      serveText = res.stdout || "";
    } catch {
      // Ignore serve status read errors
    }
  }

  const tailscaleServing = parseTailscaleServeStatus({
    jsonOutput: serveJson,
    textOutput: serveText,
    dnsName: tailscaleDnsName,
    port,
  });

  const tailscaleUrl = buildMobileUrl({
    configuredMobileUrl: "",
    tailscaleDnsName,
    port,
  });

  return {
    tailscaleAvailable: true,
    tailscaleRunning,
    tailscaleDnsName,
    tailscaleServing,
    tailscaleUrl,
  };
}

async function toggleTailscaleServe(port, enable) {
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) {
    throw new Error(`対象ポート番号が不正です: ${port}`);
  }
  // Never call `tailscale serve reset`; only modify the single target HTTPS port.
  const args = enable
    ? ["serve", "--bg", `--https=${p}`, `http://127.0.0.1:${p}`]
    : ["serve", `--https=${p}`, "off"];
  try {
    await runTailscaleCommand(args, { timeout: 12000 });
  } catch (error) {
    const detail = (error?.stderr || error?.stdout || error?.message || "").trim();
    throw new Error(`Tailscale 公開の切り替えに失敗しました: ${detail || "tailscale コマンドエラー"}`);
  }
}

async function listMatchingServerProcesses(config, port) {
  const p = Number(port);
  if (!Number.isInteger(p) || p <= 0) return [];
  const platform = runtimeDeps.getPlatform();
  const useWsl = platform === "win32" && Boolean(config.wslDistro);

  if (useWsl) {
    try {
      const { stdout } = await runtimeDeps.execFileAsync(
        "wsl.exe",
        ["-d", config.wslDistro, "--", "ps", "-ww", "-eo", "pid=,args="],
        { timeout: 6000 },
      );
      const matches = [];
      for (const line of stdout.split(/\r?\n/)) {
        const item = matchServerPyProcessLine(line, p);
        if (item) {
          let workdir = "";
          if (item.scriptPath.startsWith("/")) {
            workdir = path.posix.dirname(item.scriptPath);
          } else {
            try {
              const cwdRes = await runtimeDeps.execFileAsync(
                "wsl.exe",
                ["-d", config.wslDistro, "--", "readlink", "-f", `/proc/${item.pid}/cwd`],
                { timeout: 4000 },
              );
              workdir = cwdRes.stdout.trim();
            } catch {
              // Ignore cwd inspection error
            }
          }
          matches.push({ ...item, workdir, viaWsl: true, wslDistro: config.wslDistro });
        }
      }
      return matches;
    } catch {
      return [];
    }
  }

  if (platform === "win32") {
    try {
      const psScript = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*server.py*' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
      const { stdout } = await runtimeDeps.execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-Command", psScript],
        { timeout: 6000 },
      );
      const raw = stdout.trim();
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      const matches = [];
      for (const row of rows) {
        if (!row || !row.ProcessId || !row.CommandLine) continue;
        const item = matchServerPyProcessLine(`${row.ProcessId} ${row.CommandLine}`, p);
        if (item) {
          let workdir = "";
          if (path.win32.isAbsolute(item.scriptPath)) {
            workdir = path.win32.dirname(item.scriptPath);
          }
          matches.push({ ...item, workdir, viaWsl: false, wslDistro: "" });
        }
      }
      return matches;
    } catch {
      return [];
    }
  }

  // POSIX (Linux / macOS)
  try {
    const { stdout } = await runtimeDeps.execFileAsync("ps", ["-ww", "-eo", "pid=,args="], { timeout: 6000 });
    const matches = [];
    for (const line of stdout.split(/\r?\n/)) {
      const item = matchServerPyProcessLine(line, p);
      if (item) {
        let workdir = "";
        if (item.scriptPath.startsWith("/")) {
          workdir = path.posix.dirname(item.scriptPath);
        } else {
          try {
            const cwdRes = await runtimeDeps.execFileAsync("readlink", ["-f", `/proc/${item.pid}/cwd`], { timeout: 3000 });
            workdir = cwdRes.stdout.trim();
          } catch {
            // Ignore on macOS or non-procfs
          }
        }
        matches.push({ ...item, workdir, viaWsl: false, wslDistro: "" });
      }
    }
    return matches;
  } catch {
    return [];
  }
}

async function sendTermToProcess(proc) {
  if (!proc || !Number.isInteger(proc.pid) || proc.pid <= 0) return;
  if (proc.viaWsl && proc.wslDistro) {
    await runtimeDeps.execFileAsync(
      "wsl.exe",
      ["-d", proc.wslDistro, "--", "kill", "-TERM", String(proc.pid)],
      { timeout: 5000 },
    );
    return;
  }
  if (runtimeDeps.getPlatform() === "win32") {
    await runtimeDeps.execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", `Stop-Process -Id ${proc.pid} -ErrorAction SilentlyContinue`],
      { timeout: 5000 },
    );
    return;
  }
  process.kill(proc.pid, "SIGTERM");
}

function mergeLastServerConfig(existing, detected, meta, config, port) {
  const base = existing && typeof existing === "object" ? existing : {};
  const next = {
    serverWorkdir: detected?.workdir || config.serverWorkdir || base.serverWorkdir || "",
    corePath: detected?.corePath || config.corePath || base.corePath || "",
    homePath: detected?.homePath || config.homePath || base.homePath || "",
    wslDistro: detected?.viaWsl ? (detected.wslDistro || config.wslDistro) : (config.wslDistro || base.wslDistro || ""),
    allowHosts: Array.isArray(detected?.allowHosts) && detected.allowHosts.length > 0
      ? detected.allowHosts
      : (Array.isArray(meta?.allowHosts) && meta.allowHosts.length > 0
        ? meta.allowHosts
        : (base.allowHosts || [])),
    readOnly: detected ? Boolean(detected.readOnly) : (meta ? Boolean(meta.readOnly) : Boolean(base.readOnly)),
    port,
    detectedAt: Date.now(),
  };
  return next;
}

function resolveEffectiveServerConfig(config, remembered) {
  const mem = remembered && typeof remembered === "object" ? remembered : {};
  return {
    serverWorkdir: config.serverWorkdir || mem.serverWorkdir || "",
    corePath: config.corePath || mem.corePath || "",
    homePath: config.homePath || mem.homePath || "",
    wslDistro: config.wslDistro !== undefined ? config.wslDistro : (mem.wslDistro || ""),
    serverAllowHosts: config.serverAllowHosts || (Array.isArray(mem.allowHosts) ? mem.allowHosts.join(", ") : ""),
    serverReadOnly: config.serverReadOnly || Boolean(mem.readOnly),
  };
}

function redactSecret(text, secret) {
  const s = String(text || "");
  if (!secret) return s;
  return s.split(secret).join("***");
}

function appendTail(prev, chunk, maxLen = 2000) {
  const combined = (prev || "") + String(chunk || "");
  return combined.length > maxLen ? combined.slice(-maxLen) : combined;
}

async function stopManagedChild(managed) {
  if (!managed) return;
  const { child, port, wslDistro } = managed;
  try {
    if (wslDistro) {
      const procs = await listMatchingServerProcesses({ wslDistro }, port);
      for (const proc of procs) {
        try {
          await sendTermToProcess(proc);
        } catch {
          // Ignore individual kill errors
        }
      }
    }
    if (child && !managed.exited && typeof child.kill === "function") {
      child.kill("SIGTERM");
    }
  } catch {
    // Ignore stop errors
  }
}

export default function activate(orca) {
  const runtime = {
    connected: false,
    lastError: null,
    lastUpdatedAt: null,
  };

  const serverRuntime = {
    lastError: null,
  };

  const broadcastState = async (configOverride = null) => {
    const config = configOverride || await readConfig(orca);
    const state = toPublicState(config, runtime);
    await syncStatusBar(orca, config);
    orca.panels.post("ttj.state", state);
    return state;
  };

  const computeServerStatus = async ({ configOverride = null, signal, skipProcessInspect = false } = {}) => {
    const config = configOverride || await readConfig(orca);
    const port = extractPortFromUrl(config.serverUrl);
    const [probe, ts, rememberedRaw] = await Promise.all([
      probeServerMeta(config, { signal, timeoutMs: 2200 }),
      getTailscaleStatus(port),
      readStorage(orca, LAST_SERVER_CONFIG_KEY, null),
    ]);

    let remembered = rememberedRaw && typeof rememberedRaw === "object" ? rememberedRaw : null;

    if (probe.running && !skipProcessInspect) {
      const procs = await listMatchingServerProcesses(config, port);
      const detected = procs[0] || null;
      const merged = mergeLastServerConfig(remembered, detected, probe.meta, config, port);
      if (merged.serverWorkdir || merged.corePath || merged.homePath || (merged.allowHosts && merged.allowHosts.length > 0)) {
        remembered = merged;
        await writeStorage(orca, LAST_SERVER_CONFIG_KEY, merged);
      }
    }

    const effectiveConfig = resolveEffectiveServerConfig(config, remembered);
    const mobileUrl = buildMobileUrl({
      configuredMobileUrl: config.mobileUrl,
      tailscaleDnsName: ts.tailscaleDnsName,
      port,
    });

    const managedByPlugin = Boolean(
      activeManagedServer &&
      !activeManagedServer.exited &&
      activeManagedServer.port === port,
    );

    const allowHosts = Array.isArray(probe.meta?.allowHosts)
      ? probe.meta.allowHosts
      : parseAllowHostsList(effectiveConfig.serverAllowHosts);

    return {
      running: probe.running,
      managedByPlugin,
      port,
      serverUrl: config.serverUrl,
      backendMode: config.backendMode,
      meta: probe.meta,
      readOnly: probe.meta ? Boolean(probe.meta.readOnly) : Boolean(effectiveConfig.serverReadOnly),
      authEnabled: probe.meta ? Boolean(probe.meta.authEnabled) : Boolean(config.authToken),
      allowHosts,
      tailscaleAvailable: ts.tailscaleAvailable,
      tailscaleRunning: ts.tailscaleRunning,
      tailscaleDnsName: ts.tailscaleDnsName,
      tailscaleServing: ts.tailscaleServing,
      tailscaleUrl: ts.tailscaleUrl,
      mobileUrl,
      configuredMobileUrl: config.mobileUrl,
      effectiveConfig,
      canStart: Boolean(effectiveConfig.serverWorkdir && effectiveConfig.corePath),
      lastError: serverRuntime.lastError,
    };
  };

  const broadcastServerStatus = async (statusOverride = null) => {
    const status = statusOverride || await computeServerStatus({ skipProcessInspect: true });
    orca.panels.post("ttj.serverStatus", status);
    return status;
  };

  const startServerAction = async (context) => {
    const config = await readConfig(orca);
    const port = extractPortFromUrl(config.serverUrl);
    serverRuntime.lastError = null;

    const initialProbe = await probeServerMeta(config, { signal: context?.signal, timeoutMs: 2000 });
    if (initialProbe.running) {
      const status = await computeServerStatus({ configOverride: config, signal: context?.signal });
      orca.panels.post("ttj.serverStatus", status);
      return { ok: true, running: true, alreadyRunning: true, status };
    }

    const remembered = await readStorage(orca, LAST_SERVER_CONFIG_KEY, null);
    const effective = resolveEffectiveServerConfig(config, remembered);
    if (!effective.serverWorkdir || !effective.corePath) {
      const message = "起動設定で TTJWeb フォルダと ttjcore パスを設定してください。";
      serverRuntime.lastError = message;
      throw new Error(message);
    }

    const ts = await getTailscaleStatus(port);
    let allowHosts = parseAllowHostsList(config.serverAllowHosts);
    if (allowHosts.length === 0 && remembered && Array.isArray(remembered.allowHosts) && remembered.allowHosts.length > 0 && (!remembered.port || remembered.port === port)) {
      allowHosts = parseAllowHostsList(remembered.allowHosts);
    }
    if (allowHosts.length === 0 && ts.tailscaleDnsName) {
      allowHosts = [`${ts.tailscaleDnsName}:${port}`];
    }

    const pyArgs = buildServerStartArgs({
      port,
      corePath: effective.corePath,
      homePath: effective.homePath,
      allowHosts,
      authToken: config.authToken,
      readOnly: config.serverReadOnly,
    });

    const platform = runtimeDeps.getPlatform();
    const useWsl = platform === "win32" && Boolean(config.wslDistro);

    let command;
    let spawnArgs;
    let spawnOpts;

    if (useWsl) {
      command = "wsl.exe";
      spawnArgs = ["-d", config.wslDistro, "--cd", toWslPath(effective.serverWorkdir), "--", "python3", ...pyArgs];
      spawnOpts = {
        detached: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      };
    } else {
      command = platform === "win32" ? "python" : "python3";
      spawnArgs = pyArgs;
      spawnOpts = {
        cwd: effective.serverWorkdir,
        detached: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      };
    }

    let child;
    try {
      child = runtimeDeps.spawnProcess(command, spawnArgs, spawnOpts);
    } catch (error) {
      const msg = `TTJWeb サーバーの起動に失敗しました: ${error?.message || String(error)}`;
      serverRuntime.lastError = msg;
      throw new Error(msg);
    }

    const managed = {
      child,
      port,
      wslDistro: useWsl ? config.wslDistro : "",
      workdir: effective.serverWorkdir,
      corePath: effective.corePath,
      homePath: effective.homePath,
      stdoutTail: "",
      stderrTail: "",
      exited: false,
      exitCode: null,
      spawnError: null,
    };

    child.stdout?.on("data", chunk => {
      managed.stdoutTail = appendTail(managed.stdoutTail, redactSecret(chunk, config.authToken));
    });
    child.stderr?.on("data", chunk => {
      managed.stderrTail = appendTail(managed.stderrTail, redactSecret(chunk, config.authToken));
    });
    child.on("error", err => {
      managed.spawnError = err?.message || String(err);
      managed.exited = true;
    });
    child.on("exit", code => {
      managed.exited = true;
      managed.exitCode = code;
      if (activeManagedServer === managed) {
        activeManagedServer = null;
      }
    });

    activeManagedServer = managed;

    const deadline = Date.now() + runtimeDeps.startTimeoutMs;
    let readyMeta = null;
    while (Date.now() <= deadline) {
      if (managed.exited) {
        break;
      }
      const probe = await probeServerMeta(config, { signal: context?.signal, timeoutMs: 800 });
      if (probe.running) {
        readyMeta = probe.meta;
        break;
      }
      await runtimeDeps.sleep(runtimeDeps.pollIntervalMs);
    }

    if (!readyMeta) {
      await stopManagedChild(managed);
      if (activeManagedServer === managed) {
        activeManagedServer = null;
      }
      const detail = (managed.spawnError || managed.stderrTail || managed.stdoutTail || "").trim();
      const suffix = detail ? ` (${detail.slice(-300)})` : "";
      const msg = `TTJWeb サーバー (${config.serverUrl}) の起動確認がタイムアウトまたは失敗しました${suffix}`;
      serverRuntime.lastError = msg;
      throw new Error(msg);
    }

    const saved = {
      serverWorkdir: effective.serverWorkdir,
      corePath: effective.corePath,
      homePath: effective.homePath,
      wslDistro: useWsl ? config.wslDistro : "",
      allowHosts,
      readOnly: Boolean(config.serverReadOnly),
      port,
      detectedAt: Date.now(),
    };
    await writeStorage(orca, LAST_SERVER_CONFIG_KEY, saved);

    const status = await computeServerStatus({ configOverride: config, signal: context?.signal, skipProcessInspect: true });
    orca.panels.post("ttj.serverStatus", status);
    if (config.enabled) {
      orca.panels.post("ttj.refresh", { requestedAt: Date.now(), reason: "serverStart" });
    }
    return { ok: true, running: true, alreadyRunning: false, status };
  };

  const stopServerAction = async (context) => {
    const config = await readConfig(orca);
    const port = extractPortFromUrl(config.serverUrl);
    serverRuntime.lastError = null;

    const initialProbe = await probeServerMeta(config, { signal: context?.signal, timeoutMs: 2000 });
    const hasManagedForPort = Boolean(
      activeManagedServer &&
      !activeManagedServer.exited &&
      activeManagedServer.port === port,
    );

    if (!initialProbe.running && !hasManagedForPort) {
      const status = await computeServerStatus({ configOverride: config, signal: context?.signal, skipProcessInspect: true });
      orca.panels.post("ttj.serverStatus", status);
      return { ok: true, running: false, alreadyStopped: true, status };
    }

    // Remember current running config before stopping so the user can restart without re-entering paths
    if (initialProbe.running) {
      const procs = await listMatchingServerProcesses(config, port);
      const existingMem = await readStorage(orca, LAST_SERVER_CONFIG_KEY, null);
      const merged = mergeLastServerConfig(existingMem, procs[0] || null, initialProbe.meta, config, port);
      if (merged.serverWorkdir || merged.corePath || merged.homePath) {
        await writeStorage(orca, LAST_SERVER_CONFIG_KEY, merged);
      }

      if (hasManagedForPort) {
        const managed = activeManagedServer;
        activeManagedServer = null;
        await stopManagedChild(managed);
      } else {
        const looksLikeTtj = Boolean(
          initialProbe.meta &&
          typeof initialProbe.meta === "object" &&
          (initialProbe.meta.protocol || initialProbe.meta.actor || initialProbe.meta.watch_prefix),
        );
        if (!looksLikeTtj) {
          throw new Error(`ポート ${port} のサーバーは TTJWeb と確認できなかったため停止を中止しました。`);
        }
        if (procs.length === 0) {
          throw new Error(`ポート ${port} に一致する server.py プロセスを特定できませんでした。`);
        }
        for (const proc of procs) {
          await sendTermToProcess(proc);
        }
      }
    } else if (hasManagedForPort) {
      const managed = activeManagedServer;
      activeManagedServer = null;
      await stopManagedChild(managed);
    }

    const deadline = Date.now() + runtimeDeps.stopTimeoutMs;
    let stillRunning = true;
    while (Date.now() <= deadline) {
      const probe = await probeServerMeta(config, { signal: context?.signal, timeoutMs: 700 });
      if (!probe.running) {
        stillRunning = false;
        break;
      }
      await runtimeDeps.sleep(runtimeDeps.pollIntervalMs);
    }

    if (stillRunning) {
      const msg = `TTJWeb サーバー (ポート ${port}) の停止完了を確認できませんでした。`;
      serverRuntime.lastError = msg;
      throw new Error(msg);
    }

    runtime.connected = false;
    const status = await computeServerStatus({ configOverride: config, signal: context?.signal, skipProcessInspect: true });
    orca.panels.post("ttj.serverStatus", status);
    return { ok: true, running: false, alreadyStopped: false, status };
  };

  const toggleTailscaleAction = async (input, context) => {
    const config = await readConfig(orca);
    const port = extractPortFromUrl(config.serverUrl);
    let enable;
    if (typeof input?.enable === "boolean") {
      enable = input.enable;
    } else {
      const currentTs = await getTailscaleStatus(port);
      enable = !currentTs.tailscaleServing;
    }
    await toggleTailscaleServe(port, enable);
    const status = await computeServerStatus({ configOverride: config, signal: context?.signal, skipProcessInspect: true });
    orca.panels.post("ttj.serverStatus", status);
    return { ok: true, enabled: enable, status };
  };

  // Sync status bar at worker startup
  void readConfig(orca).then(config => syncStatusBar(orca, config)).catch(() => {});

  const disposables = [];

  disposables.push(
    orca.panels.handle("ttj.state", async () => {
      const config = await readConfig(orca);
      return toPublicState(config, runtime);
    }),
  );

  disposables.push(
    orca.panels.handle("ttj.setEnabled", async (input) => {
      const nextEnabled = Boolean(input?.enabled);
      await writeSetting(orca, "enabled", nextEnabled);
      if (!nextEnabled) {
        // Deliberately do NOT stop any running TTJWeb server so mobile users stay connected.
        runtime.connected = false;
        runtime.lastError = null;
      }
      const config = await readConfig(orca);
      config.enabled = nextEnabled;
      return await broadcastState(config);
    }),
  );

  disposables.push(
    orca.panels.handle("ttj.serverStatus", async (_input, context) => {
      return await computeServerStatus({ signal: context?.signal });
    }),
  );

  disposables.push(
    orca.panels.handle("ttj.serverStart", async (_input, context) => {
      return await startServerAction(context);
    }),
  );

  disposables.push(
    orca.panels.handle("ttj.serverStop", async (_input, context) => {
      return await stopServerAction(context);
    }),
  );

  disposables.push(
    orca.panels.handle("ttj.tailscaleToggle", async (input, context) => {
      return await toggleTailscaleAction(input || {}, context);
    }),
  );

  disposables.push(
    orca.panels.handle("ttj.saveServerConfig", async (input, context) => {
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("保存する設定オブジェクトが必要です。");
      }
      if (Object.hasOwn(input, "serverUrl") && String(input.serverUrl || "").trim()) {
        normalizeUrl(input.serverUrl);
      }
      if (Object.hasOwn(input, "mobileUrl") && String(input.mobileUrl || "").trim()) {
        normalizeUrl(input.mobileUrl);
      }

      for (const [key, rawValue] of Object.entries(input)) {
        if (!EDITABLE_SERVER_CONFIG_KEYS.has(key)) continue;
        const value = key === "serverReadOnly" ? Boolean(rawValue) : String(rawValue ?? "").trim();
        await writeSetting(orca, key, value);
      }

      const config = await readConfig(orca);
      const state = await broadcastState(config);
      const status = await computeServerStatus({ configOverride: config, signal: context?.signal, skipProcessInspect: true });
      orca.panels.post("ttj.serverStatus", status);
      return { ok: true, state, status };
    }),
  );

  disposables.push(
    orca.panels.handle("ttj.meta", async (_input, context) => {
      const config = await readConfig(orca);
      if (!config.enabled) {
        return { disabled: true };
      }
      try {
        let meta;
        if (config.backendMode === "ttjcore") {
          const discover = await execTtjCoreRpc(config, "rpc.discover", {}, { signal: context?.signal });
          const names = new Set((discover?.methods || []).map(entry => entry.name));
          if (!names.has("run.progress") || !names.has("ticket.snapshot")) {
            throw new Error("進捗 API 対応版の ttjcore が必要です。設定の corePath と homePath を確認してください。");
          }
          meta = {
            actor: DEFAULT_ACTOR,
            protocol: "TTJ/1.1.0",
            watch_prefix: buildWatchPrefix(config),
            allowHosts: [],
            readOnly: false,
            authEnabled: false,
            backendMode: "ttjcore",
          };
        } else {
          try {
            meta = await fetchJsonFromServer(config, "/api/meta", { signal: context?.signal });
          } catch (error) {
            if (error?.status === 404) {
              meta = await fetchJsonFromServer(config, "/api/config", { signal: context?.signal });
            } else {
              throw error;
            }
          }
          meta = {
            actor: meta.actor || DEFAULT_ACTOR,
            protocol: meta.protocol || "TTJ/1.1.0",
            watch_prefix: meta.watch_prefix || "ttjcore",
            allowHosts: Array.isArray(meta.allowHosts) ? meta.allowHosts : [],
            readOnly: Boolean(meta.readOnly),
            authEnabled: Boolean(meta.authEnabled),
            backendMode: "server",
          };
        }
        runtime.connected = true;
        runtime.lastError = null;
        runtime.lastUpdatedAt = Date.now();
        return meta;
      } catch (error) {
        runtime.connected = false;
        runtime.lastError = error?.message || String(error);
        throw error;
      }
    }),
  );

  disposables.push(
    orca.panels.handle("ttj.call", async (input, context) => {
      const config = await readConfig(orca);
      if (!config.enabled) {
        throw new Error("TTJWeb 常駐は現在 OFF です。ON に切り替えてから操作してください。");
      }
      const method = typeof input?.method === "string" ? input.method : "";
      const params = input?.params && typeof input.params === "object" && !Array.isArray(input.params)
        ? input.params
        : {};
      if (!READ.has(method) && !MANAGE.has(method) && !EXECUTE.has(method)) {
        throw new Error(`許可されていないメソッドです: ${method || "(empty)"}`);
      }

      const sanitizedParams = { ...params };
      delete sanitizedParams.actor;
      delete sanitizedParams.mode;

      try {
        let result;
        if (config.backendMode === "ttjcore") {
          result = await callTtjCoreWhitelisted(config, method, sanitizedParams, { signal: context?.signal });
        } else {
          const response = await fetchJsonFromServer(config, "/api/call", {
            method: "POST",
            body: { method, params: sanitizedParams },
            signal: context?.signal,
          });
          result = response.result;
        }
        runtime.connected = true;
        runtime.lastError = null;
        runtime.lastUpdatedAt = Date.now();
        return result;
      } catch (error) {
        runtime.lastError = error?.message || String(error);
        throw error;
      }
    }),
  );

  disposables.push(
    orca.commands.register("ttjweb.toggleEnabled", async () => {
      const current = await readConfig(orca);
      const nextEnabled = !current.enabled;
      await writeSetting(orca, "enabled", nextEnabled);
      if (!nextEnabled) {
        // Never stop running TTJWeb server when toggling sidebar resident mode OFF.
        runtime.connected = false;
        runtime.lastError = null;
      }
      current.enabled = nextEnabled;
      await broadcastState(current);
      return nextEnabled ? "TTJWeb 常駐を ON にしました" : "TTJWeb 常駐を OFF にしました";
    }),
  );

  disposables.push(
    orca.commands.register("ttjweb.refresh", async () => {
      const current = await readConfig(orca);
      if (!current.enabled) {
        return "TTJWeb 常駐は現在 OFF です";
      }
      orca.panels.post("ttj.refresh", { requestedAt: Date.now() });
      return "TTJWeb の再読み込みを要求しました";
    }),
  );

  disposables.push(
    orca.commands.register("ttjweb.serverStart", async (_args, context) => {
      const res = await startServerAction(context);
      return res.alreadyRunning
        ? `TTJWeb サーバーは既に起動中です (${res.status.serverUrl})`
        : `TTJWeb サーバーを起動しました (${res.status.serverUrl})`;
    }),
  );

  disposables.push(
    orca.commands.register("ttjweb.serverStop", async (_args, context) => {
      const res = await stopServerAction(context);
      return res.alreadyStopped
        ? "TTJWeb サーバーは既に停止しています"
        : `TTJWeb サーバーを停止しました (ポート ${res.status.port})`;
    }),
  );

  disposables.push(
    orca.commands.register("ttjweb.toggleTailscale", async (_args, context) => {
      const res = await toggleTailscaleAction({}, context);
      return res.enabled
        ? `Tailscale スマホ公開を ON にしました (ポート ${res.status.port})`
        : `Tailscale スマホ公開を OFF にしました (ポート ${res.status.port})`;
    }),
  );

  if (orca.settings && typeof orca.settings.onDidChange === "function") {
    const sub = orca.settings.onDidChange(async () => {
      try {
        await broadcastState();
        await broadcastServerStatus();
      } catch (error) {
        orca.log?.(`settings change sync failed: ${error?.message || String(error)}`);
      }
    });
    if (sub) disposables.push(sub);
  }

  activeDisposables = disposables;
}

export async function deactivate() {
  for (const item of activeDisposables) {
    try {
      if (typeof item === "function") item();
      else item?.dispose?.();
    } catch {
      // Ignore cleanup errors
    }
  }
  activeDisposables = [];

  if (activeManagedServer) {
    const managed = activeManagedServer;
    activeManagedServer = null;
    await stopManagedChild(managed);
  }
}
