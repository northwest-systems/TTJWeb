export const VIEWS = {
  timeline: "タイムライン",
  tree: "ツリー",
  kanban: "カンバン",
  list: "リスト",
};

export const VIEW_META = {
  timeline: { label: "タイムライン", title: "タイムライン", description: "実行と状態変更の履歴" },
  tree: { label: "ツリー", title: "ツリー", description: "Project → Task → Ticket → Job（ドラッグ移動・拡大縮小）" },
  kanban: { label: "カンバン", title: "カンバン", description: "作業状態ごとのTicketボード" },
  list: { label: "リスト", title: "リスト", description: "TaskとTicketの一覧" },
};

export const WORK_STATUSES = [
  "todo",
  "doing",
  "waiting",
  "paused",
  "blocked",
  "completed",
  "canceled",
];

export const STATUS_LABELS = {
  todo: "未着手",
  doing: "作業中",
  waiting: "待機",
  paused: "保留",
  blocked: "障害",
  completed: "完了",
  canceled: "中止",
};

export const KNOWLEDGE_STATUS_LABELS = {
  active: "採用中",
  supersed: "過去",
};

export const TIME_ZONES = {
  JST: "JST（UTC+09:00）",
  UTC: "UTC",
  local: "端末の設定",
};

export const JOB_COLORS = {
  todo: "#64748b",
  doing: "#2563eb",
  waiting: "#b45309",
  paused: "#7c3aed",
  blocked: "#dc2626",
  completed: "#16803c",
  canceled: "#9d174d",
};

export const JOB_COLORS_DARK = {
  todo: "#94a3b8",
  doing: "#60a5fa",
  waiting: "#fbbf24",
  paused: "#c4b5fd",
  blocked: "#f87171",
  completed: "#86efac",
  canceled: "#f9a8d4",
};

export const THEME_COLORS = {
  light: {
    background: "#f3f6f3",
    surface: "#ffffff",
    raised: "#e8eee8",
    hover: "#dcebdc",
    foreground: "#202a22",
    muted: "#59665b",
    border: "#d1dbd2",
    accent: "#166534",
  },
  dark: {
    background: "#141819",
    surface: "#1c2222",
    raised: "#293131",
    hover: "#333e35",
    foreground: "#e6eae6",
    muted: "#a5afa6",
    border: "#3b453e",
    accent: "#a3e635",
  },
};

export const DEFAULT_ICONS = {
  job: "/assets/octicons/checklist-16.svg",
  search: "/icons/search.svg",
  edit: "/icons/edit.svg",
  execute: "/icons/execute.svg",
  test: "/assets/octicons/checklist-16.svg",
  review: "/icons/review.svg",
  book: "/icons/book.svg",
  github: "/assets/octicons/mark-github-16.svg",
  "custom.star": "/assets/octicons/star-16.svg",
  "id.copy": "/assets/octicons/tag-16.svg",
};

export const PRESET_ICON_ASSETS = [
  { path: "/assets/octicons/checklist-16.svg", label: "checklist-16.svg" },
  { path: "/assets/octicons/star-16.svg", label: "star-16.svg" },
  { path: "/assets/octicons/mark-github-16.svg", label: "mark-github-16.svg" },
  { path: "/assets/octicons/tag-16.svg", label: "tag-16.svg" },
  { path: "/icons/search.svg", label: "search.svg" },
  { path: "/icons/edit.svg", label: "edit.svg" },
  { path: "/icons/execute.svg", label: "execute.svg" },
  { path: "/icons/review.svg", label: "review.svg" },
  { path: "/icons/book.svg", label: "book.svg" },
  { path: "/icons/task.svg", label: "task.svg" },
  { path: "/icons/ticket.svg", label: "ticket.svg" },
  { path: "/icons/folder.svg", label: "folder.svg" },
];

export const CUSTOM_ICON_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const MAX_CUSTOM_ICON_BYTES = 128 * 1024;

export const JOB_ICON_OPTIONS = [
  { value: "job", label: "job — 標準（チェックリスト）" },
  { value: "search", label: "search — 調査・確認" },
  { value: "edit", label: "edit — 編集・実装" },
  { value: "execute", label: "execute — コマンド実行" },
  { value: "test", label: "test — テスト・検証" },
  { value: "review", label: "review — レビュー" },
  { value: "book", label: "book — 文書・記録" },
  { value: "github", label: "github — GitHub関連" },
  { value: "custom.star", label: "custom.star — 重要・スター" },
];

export const KANBAN_COLUMNS = [
  { key: "todo", label: "未着手", statuses: ["todo"] },
  { key: "doing", label: "作業中", statuses: ["doing"] },
  { key: "waiting", label: "待機", statuses: ["waiting"] },
  { key: "held", label: "保留・障害", statuses: ["paused", "blocked"] },
  { key: "completed", label: "完了", statuses: ["completed"] },
  { key: "canceled", label: "中止", statuses: ["canceled"], collapsible: true },
];

export const KIND_LABELS = {
  project: "Project",
  task: "Task",
  ticket: "Ticket",
  job: "Job",
  run: "Run",
  knowledge: "Knowledge",
  record: "記録",
};

export const EVENT_LABELS = {
  "record.created": "作成",
  "record.updated": "更新",
  "record.deleted": "削除",
  "status.changed": "状態変更",
  "run.started": "Run開始",
  "run.finished": "Run終了",
  "run.progress_changed": "進捗報告",
  "execution.stop_requested": "停止要求",
  "knowledge.superseded": "Knowledgeの置換",
};

// Fixed uniform card dimensions for both Task and Ticket cards, plus doubled routing clearances.
// Horizontal arrows exit/enter at vertical center (cardHeight / 2 = 54px);
// Vertical arrows exit/enter at horizontal center (cardWidth / 2 = 124px).
export const TREE_DIRECTIONS = ["horizontal", "vertical"];

export function normalizeTreeDirection(value, fallback = "horizontal") {
  if (value === "horizontal" || value === "vertical") return value;
  return fallback === "vertical" ? "vertical" : "horizontal";
}

export const TREE_METRICS = {
  paddingX: 28,
  paddingY: 28,
  cardWidth: 248,
  cardHeight: 108,
  taskWidth: 248,
  ticketWidth: 248,
  nodeHeight: 108,
  minColGap: 84,
  laneStep: 24,
  startStub: 28,
  endStub: 28,
  entryOffsetY: 54,
  branchExitOffsetY: 54,
  entryOffsetX: 124,
  branchExitOffsetX: 124,
  gutterMarginTop: 24,
  gutterMarginBottom: 24,
  gutterStep: 24,
  baseRowGap: 48,
  taskGroupGap: 32,
  minClearance: 20,
  bridgeRadius: 7,
};

const SAFE_LOCAL_ICON_RE = /^\/(?:icons|assets)\/[A-Za-z0-9._/-]+\.(?:svg|png)$/i;
const SAFE_DATA_PNG_RE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const SAFE_DATA_SVG_RE = /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/;

export function isStandardIconKey(key) {
  return typeof key === "string" && Object.hasOwn(DEFAULT_ICONS, key);
}

export function isValidIconKey(key) {
  return typeof key === "string"
    && CUSTOM_ICON_KEY_PATTERN.test(key)
    && key !== "id.copy";
}

export function iconSourceOf(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && typeof entry.src === "string") return entry.src;
  return "";
}

export function isSafeIconSource(src) {
  if (typeof src !== "string" || !src) return false;
  if (src.includes("..")) return false;
  return SAFE_LOCAL_ICON_RE.test(src) || SAFE_DATA_PNG_RE.test(src) || SAFE_DATA_SVG_RE.test(src);
}

export function sanitizeSvgMarkup(rawSvg) {
  if (typeof rawSvg !== "string") {
    throw new Error("SVGの内容を読み取れません。");
  }
  const byteLength = new TextEncoder().encode(rawSvg).length;
  if (byteLength === 0) {
    throw new Error("SVGファイルが空です。");
  }
  if (byteLength > MAX_CUSTOM_ICON_BYTES) {
    throw new Error("アイコンファイルは128KB以内で指定してください。");
  }

  let cleaned = rawSvg
    .replace(/^\uFEFF/, "")
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<!ENTITY[\s\S]*?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();

  // Remove dangerous elements (paired and self-closing)
  const blockedTags = [
    "script",
    "foreignObject",
    "iframe",
    "object",
    "embed",
    "applet",
    "audio",
    "video",
    "handler",
    "link",
    "meta",
    "use",
    "image",
    "animate",
    "animateTransform",
    "animateMotion",
    "set",
  ];
  for (const tag of blockedTags) {
    const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
    const single = new RegExp(`<${tag}\\b[^>]*/?>`, "gi");
    cleaned = cleaned.replace(paired, "").replace(single, "");
  }

  // Sanitize <style> blocks that contain external refs or scriptable constructs
  cleaned = cleaned.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (match, css) => {
    if (/@import|javascript:|vbscript:|expression\s*\(|url\s*\(\s*['"]?\s*(?:https?:|\/\/|data:)/i.test(css)) {
      return "";
    }
    return match;
  });

  // Remove inline event handlers (on*="...", on*='...', on*=...)
  cleaned = cleaned.replace(/\s+on[a-zA-Z0-9_-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  // Remove href / xlink:href / src attributes with external or scriptable URLs
  cleaned = cleaned.replace(
    /\s+(?:xlink:)?(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (match, dq, sq, bare) => {
      const val = (dq ?? sq ?? bare ?? "").trim();
      if (/^(?:javascript:|vbscript:|data:|https?:|\/\/)/i.test(val)) return "";
      return match;
    },
  );

  // Remove external url(...) references inside style or presentation attributes
  cleaned = cleaned.replace(/url\s*\(\s*['"]?\s*(?:https?:|\/\/|javascript:|vbscript:|data:)[^)]*\)/gi, "none");

  const startIdx = cleaned.search(/<svg\b/i);
  const endMatch = /<\/svg\s*>/i.exec(cleaned);
  if (startIdx < 0 || !endMatch) {
    throw new Error("有効なSVG要素（<svg>...</svg>）が見つかりません。");
  }
  cleaned = cleaned.slice(startIdx, endMatch.index + endMatch[0].length).trim();

  if (
    /<script\b/i.test(cleaned)
    || /javascript\s*:/i.test(cleaned)
    || /vbscript\s*:/i.test(cleaned)
    || /\son[a-z]+\s*=/i.test(cleaned)
  ) {
    throw new Error("安全ではない要素または属性がSVGに含まれているため登録できません。");
  }

  return cleaned;
}

function svgHasExplicitColors(svgText) {
  const matches = svgText.matchAll(/\b(?:fill|stroke)\s*[:=]\s*['"]?\s*([^'";\s>]+)/gi);
  for (const match of matches) {
    const val = (match[1] || "").trim().toLowerCase();
    if (!val || val === "none" || val === "currentcolor" || val === "transparent" || val === "inherit") continue;
    if (val === "#000" || val === "#000000" || val === "black") continue;
    return true;
  }
  return false;
}

export function sanitizeCustomIconsMap(raw) {
  const result = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  for (const [key, entry] of Object.entries(raw)) {
    if (!isValidIconKey(key) || isStandardIconKey(key)) continue;
    const src = iconSourceOf(entry);
    if (!isSafeIconSource(src)) continue;
    if (typeof entry === "string") {
      result[key] = {
        label: "",
        src,
        kind: src.startsWith("data:") ? "upload" : "preset",
        sourceName: src.startsWith("data:") ? (SAFE_DATA_PNG_RE.test(src) ? "upload.png" : "upload.svg") : src.split("/").pop(),
      };
    } else {
      result[key] = {
        label: typeof entry.label === "string" ? entry.label.trim().slice(0, 80) : "",
        src,
        kind: entry.kind === "upload" || src.startsWith("data:") ? "upload" : "preset",
        sourceName: typeof entry.sourceName === "string"
          ? entry.sourceName.trim().slice(0, 80)
          : src.startsWith("data:")
            ? (SAFE_DATA_PNG_RE.test(src) ? "upload.png" : "upload.svg")
            : src.split("/").pop(),
      };
    }
  }
  return result;
}

export function jobIcon(input, customIcons = {}) {
  const key = typeof input === "string"
    ? input
    : input?.display?.icon ?? input?.record?.display?.icon;
  if (!key || key === "id.copy") return "job";
  const raw = Object.hasOwn(customIcons, key) ? iconSourceOf(customIcons[key]) : DEFAULT_ICONS[key];
  return isSafeIconSource(raw) ? key : "job";
}

export function jobIconPath(input, customIcons = {}) {
  const key = input === "id.copy" ? "id.copy" : jobIcon(input, customIcons);
  const raw = Object.hasOwn(customIcons, key) ? iconSourceOf(customIcons[key]) : DEFAULT_ICONS[key];
  return isSafeIconSource(raw) ? raw : DEFAULT_ICONS.job;
}

export function jobIconAsset(input, customIcons = {}) {
  const key = input === "id.copy" ? "id.copy" : jobIcon(input, customIcons);
  const src = jobIconPath(key, customIcons);
  const isDataUri = src.startsWith("data:");
  const isPng = SAFE_DATA_PNG_RE.test(src) || /\.png$/i.test(src);
  if (isPng) {
    return { key, src, format: "png", isDataUri, renderMode: "img" };
  }
  if (SAFE_DATA_SVG_RE.test(src)) {
    let colored = false;
    try {
      const b64 = src.slice("data:image/svg+xml;base64,".length);
      const decoded = atob(b64);
      colored = svgHasExplicitColors(decoded);
    } catch {
      colored = true;
    }
    return { key, src, format: "svg", isDataUri: true, renderMode: colored ? "img" : "mask" };
  }
  return { key, src, format: "svg", isDataUri, renderMode: "mask" };
}

export function allJobIconOptions(customIcons = {}) {
  const standard = JOB_ICON_OPTIONS.map(opt => ({ ...opt, isCustom: false }));
  const custom = Object.entries(customIcons || {})
    .filter(([key, entry]) => isValidIconKey(key) && !isStandardIconKey(key) && isSafeIconSource(iconSourceOf(entry)))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => {
      const desc = typeof entry === "object" && entry?.label ? entry.label : "";
      return {
        value: key,
        label: desc ? `${key} — ${desc}（カスタム）` : `${key}（カスタム）`,
        desc,
        isCustom: true,
      };
    });
  return [...standard, ...custom];
}

export function projectIconKeys(snapshot, customIcons = {}) {
  const ordered = [];
  const seen = new Set();
  const push = key => {
    if (!key || key === "id.copy" || seen.has(key)) return;
    seen.add(key);
    ordered.push(key);
  };
  for (const opt of JOB_ICON_OPTIONS) push(opt.value);
  for (const key of Object.keys(customIcons || {}).sort()) {
    if (isValidIconKey(key) && !isStandardIconKey(key) && isSafeIconSource(iconSourceOf(customIcons[key]))) {
      push(key);
    }
  }
  for (const entry of snapshot?.tasks ?? []) {
    for (const item of entry.tickets ?? []) {
      for (const job of item.jobs ?? []) {
        const rawKey = job?.display?.icon ?? job?.record?.display?.icon;
        if (typeof rawKey === "string" && rawKey.trim()) push(rawKey.trim());
      }
    }
  }
  return ordered;
}

export function parseDependsInput(raw) {
  if (Array.isArray(raw)) {
    return [...new Set(raw.map(v => String(v || "").trim()).filter(Boolean))];
  }
  return [...new Set(
    String(raw || "")
      .split(/[\s,、，\r\n]+/)
      .map(token => token.trim())
      .filter(Boolean),
  )];
}

export function visibleJobs(jobs = []) {
  if (jobs.length <= 8) return jobs;
  let current = jobs.findIndex(job => job.record?.status === "doing");
  if (current < 0) current = jobs.findIndex(job => !["completed", "canceled"].includes(job.record?.status));
  if (current < 0) current = jobs.length - 1;
  return jobs.slice(Math.max(0, current - 6), Math.min(jobs.length, current + 2));
}

export function visibleWork(snapshot, { workOnly = false } = {}) {
  const tasks = snapshot?.tasks ?? [];
  const items = tasks.flatMap(entry =>
    (entry.tickets ?? []).map(item => ({
      ...item,
      task: entry.task,
      taskId: entry.task.record.id,
    })),
  );
  const byId = new Map(items.map(item => [item.ticket.record.id, item]));
  const visible = new Set();

  if (!workOnly) {
    for (const entry of tasks) visible.add(entry.task.record.id);
    for (const id of byId.keys()) visible.add(id);
    return visible;
  }

  const ended = record => record.status === "completed" || record.status === "canceled";
  const target = record => !ended(record) && record.status !== "waiting";

  const children = new Map();
  for (const item of items) {
    for (const parent of item.ticket.record.depends ?? []) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(item.ticket.record.id);
    }
  }

  const descendants = predicate => {
    const memo = new Map();
    const visiting = new Set();
    const has = id => {
      if (memo.has(id)) return memo.get(id);
      if (visiting.has(id)) return false;
      visiting.add(id);
      const found = (children.get(id) ?? []).some(childId => {
        const child = byId.get(childId);
        return Boolean(child) && (predicate(child) || has(childId));
      });
      visiting.delete(id);
      memo.set(id, found);
      return found;
    };
    return has;
  };

  const hasLaterTarget = descendants(child => target(child.ticket.record));

  function retain(id) {
    if (visible.has(id) || !byId.has(id)) return;
    const item = byId.get(id);
    visible.add(id);
    visible.add(item.taskId);
    for (const parent of item.ticket.record.depends ?? []) retain(parent);
  }

  for (const item of items) {
    const record = item.ticket.record;
    if (target(record) && record.status !== "paused" && !hasLaterTarget(record.id)) {
      retain(record.id);
    }
  }

  for (const entry of tasks) {
    const id = entry.task.record.id;
    const taskTickets = entry.tickets ?? [];
    const remaining = taskTickets.filter(item => !ended(item.ticket.record));
    const hasLaterUnfinished = descendants(child => child.taskId === id && !ended(child.ticket.record));
    const frontier = remaining.filter(item => !hasLaterUnfinished(item.ticket.record.id));
    const allPaused = frontier.length > 0 && frontier.every(item => item.ticket.record.status === "paused");
    if (
      (remaining.length && !allPaused)
      || (!taskTickets.length && !ended(entry.task.record) && entry.task.record.status !== "paused")
    ) {
      visible.add(id);
    }
  }

  return visible;
}

export function normalizeFilters(filters = {}) {
  const rawStatuses = filters?.statuses instanceof Set
    ? [...filters.statuses]
    : Array.isArray(filters?.statuses)
      ? filters.statuses
      : [];
  const statuses = [...new Set(rawStatuses.filter(s => WORK_STATUSES.includes(s)))];
  const rawIconKeys = filters?.iconKeys instanceof Set
    ? [...filters.iconKeys]
    : Array.isArray(filters?.iconKeys)
      ? filters.iconKeys
      : [];
  const iconKeys = [...new Set(rawIconKeys.map(k => (typeof k === "string" ? k.trim() : "")).filter(Boolean))];
  return {
    workOnly: Boolean(filters?.workOnly),
    statuses,
    iconKeys,
    workerId: typeof filters?.workerId === "string" ? filters.workerId.trim() : "",
    query: typeof filters?.query === "string" ? filters.query.trim() : "",
  };
}

export function activeFilterCount(filters = {}) {
  const f = normalizeFilters(filters);
  let count = 0;
  if (f.workOnly) count += 1;
  if (f.statuses.length) count += 1;
  if (f.iconKeys.length) count += 1;
  if (f.workerId) count += 1;
  if (f.query) count += 1;
  return count;
}

export function hasActiveFilters(filters = {}) {
  return activeFilterCount(filters) > 0;
}

function matchesSearch(record, display, q) {
  if (!q) return true;
  const haystacks = [
    record?.id,
    record?.objective,
    record?.name,
    display?.summary,
  ];
  return haystacks.some(val => typeof val === "string" && val.toLowerCase().includes(q));
}

export function filterWork(snapshot, filters = {}, customIcons = filters?.customIcons || {}) {
  const f = normalizeFilters(filters);
  const base = visibleWork(snapshot, { workOnly: f.workOnly });
  if (!f.statuses.length && !f.iconKeys.length && !f.workerId && !f.query) {
    return base;
  }

  const statusSet = new Set(f.statuses);
  const iconKeySet = new Set(f.iconKeys);
  const q = f.query.toLowerCase();
  const visible = new Set();

  for (const entry of snapshot?.tasks ?? []) {
    const taskId = entry.task.record.id;
    let hasMatchedTicket = false;

    for (const item of entry.tickets ?? []) {
      const ticket = item.ticket;
      const ticketId = ticket.record.id;
      if (!base.has(ticketId)) continue;
      if (statusSet.size && !statusSet.has(ticket.record.status)) continue;
      if (f.workerId && ticket.record.worker_id !== f.workerId) continue;
      if (iconKeySet.size) {
        const iconMatch = (item.jobs ?? []).some(job => {
          const resolved = jobIcon(job, customIcons);
          if (iconKeySet.has(resolved)) return true;
          const rawKey = job?.display?.icon ?? job?.record?.display?.icon;
          return typeof rawKey === "string" && rawKey !== "id.copy" && iconKeySet.has(rawKey.trim());
        });
        if (!iconMatch) continue;
      }
      if (q) {
        const ticketMatch = matchesSearch(ticket.record, ticket.display, q);
        const jobMatch = (item.jobs ?? []).some(job => matchesSearch(job.record, job.display, q));
        if (!ticketMatch && !jobMatch) continue;
      }
      visible.add(ticketId);
      visible.add(taskId);
      hasMatchedTicket = true;
    }

    if (!hasMatchedTicket && !f.workerId && !iconKeySet.size && base.has(taskId)) {
      const statusOk = !statusSet.size || statusSet.has(entry.task.record.status);
      const queryOk = !q || matchesSearch(entry.task.record, entry.task.display, q);
      if (statusOk && queryOk) {
        visible.add(taskId);
      }
    }
  }

  return visible;
}

export function isTerminalRow(wrapper) {
  return ["completed", "canceled"].includes(wrapper?.record?.status);
}

export function canDeleteTask(snapshot, entry) {
  if (!isTerminalRow(entry)) return false;
  const taskEntry = snapshot?.tasks?.find(item => item.task.record.id === entry.record.id);
  if (!taskEntry) return false;
  return (taskEntry.tickets ?? []).every(item =>
    isTerminalRow(item.ticket) && (item.jobs ?? []).every(isTerminalRow),
  );
}

export function canPurgeTask(snapshot, entry) {
  if (!canDeleteTask(snapshot, entry) || entry.active) return false;
  const taskEntry = snapshot?.tasks?.find(item => item.task.record.id === entry.record.id);
  if (!taskEntry) return false;
  const taskTicketIds = new Set();
  for (const item of taskEntry.tickets ?? []) {
    if (item.ticket.active) return false;
    taskTicketIds.add(item.ticket.record.id);
    for (const job of item.jobs ?? []) {
      if (job.active) return false;
      if ((job.record.runs ?? []).some(run => run.active || (!run.ended && !run.finished_at && !run.result))) {
        return false;
      }
    }
  }
  for (const otherTask of snapshot?.tasks ?? []) {
    if (otherTask.task.record.id === entry.record.id) continue;
    for (const otherTicket of otherTask.tickets ?? []) {
      const rec = otherTicket.ticket.record;
      if ((rec.depends ?? []).some(id => taskTicketIds.has(id))) return false;
      if ((rec.refs ?? []).some(ref => taskTicketIds.has(ref?.ticket_id))) return false;
    }
  }
  return true;
}

export function canDeleteProject(snapshot) {
  if (!snapshot?.project) return false;
  return (snapshot.tasks ?? []).every(entry => canDeleteTask(snapshot, entry.task));
}

export const MODALS = ["task", "ticket", "job", "knowledge", "settings", "people"];

export function parseRoute(address) {
  const url = new URL(address, "http://localhost");
  const queryView = url.searchParams.get("view");
  const pathView = url.pathname.replace(/^\/+|\/+$/g, "");
  const view = Object.hasOwn(VIEWS, queryView)
    ? queryView
    : Object.hasOwn(VIEWS, pathView)
      ? pathView
      : "tree";
  const rawModal = url.searchParams.get("modal");
  const isSettingsAlias = pathView === "settings" || queryView === "settings";
  const modal = rawModal && MODALS.includes(rawModal)
    ? rawModal
    : isSettingsAlias
      ? "settings"
      : null;
  const rawDir = url.searchParams.get("dir") || url.searchParams.get("layout");
  const dir = rawDir === "horizontal" || rawDir === "vertical" ? rawDir : null;
  const result = {
    view,
    projectId: url.searchParams.get("project") || null,
    taskId: url.searchParams.get("task") || null,
    ticketId: url.searchParams.get("ticket") || null,
    modal,
    jobId: modal === "job" ? (url.searchParams.get("job") || null) : null,
    knowledgeId: modal === "knowledge" ? (url.searchParams.get("knowledge") || null) : null,
  };
  if (dir) result.dir = dir;
  return result;
}

export function routeUrl(route = {}) {
  const query = new URLSearchParams();
  const view = Object.hasOwn(VIEWS, route.view) ? route.view : "tree";
  query.set("view", view);
  if (route.dir === "horizontal" || route.dir === "vertical") query.set("dir", route.dir);
  if (route.projectId) query.set("project", route.projectId);
  const modal = typeof route.modal === "string" && MODALS.includes(route.modal) ? route.modal : null;
  if (modal) query.set("modal", modal);
  if (route.taskId) query.set("task", route.taskId);
  if (route.ticketId) query.set("ticket", route.ticketId);
  if (modal === "job" && route.jobId) query.set("job", route.jobId);
  if (modal === "knowledge" && route.knowledgeId) query.set("knowledge", route.knowledgeId);
  return "/?" + query.toString();
}

export function workRows(snapshot, options = {}) {
  const visible = hasActiveFilters(options) ? filterWork(snapshot, options) : null;
  const rows = [];
  for (const entry of snapshot?.tasks || []) {
    const taskId = entry.task.record.id;
    const taskTickets = entry.tickets || [];
    if (!visible || visible.has(taskId)) {
      rows.push({
        kind: "task",
        row: entry.task,
        taskId,
        ticketId: null,
        ticketCount: taskTickets.length,
        jobs: [],
      });
    }
    for (const item of taskTickets) {
      const ticketId = item.ticket.record.id;
      if (visible && !visible.has(ticketId)) continue;
      rows.push({
        kind: "ticket",
        row: item.ticket,
        taskId,
        ticketId,
        jobs: item.jobs || [],
      });
    }
  }
  return rows;
}

export function projectSummary(snapshot) {
  const tasks = snapshot?.tasks || [];
  let tickets = 0;
  let doing = 0;
  let completed = 0;
  for (const entry of tasks) {
    for (const item of entry.tickets || []) {
      tickets += 1;
      const status = item.ticket.record.status;
      if (status === "doing") doing += 1;
      if (status === "completed") completed += 1;
    }
  }
  return { tasks: tasks.length, tickets, doing, completed };
}

export function entityIndex(snapshot) {
  const index = new Map();
  for (const item of workRows(snapshot)) {
    index.set(item.row.record.id, item);
    for (const job of item.jobs) {
      index.set(job.record.id, {
        ...item,
        kind: "job",
        row: job,
        jobId: job.record.id,
        ticketTitle: item.row.record.objective,
      });
      for (const run of job.record.runs || []) {
        index.set(run.id, {
          ...item,
          kind: "run",
          row: { record: run },
          jobId: job.record.id,
          jobTitle: job.record.objective,
          ticketTitle: item.row.record.objective,
        });
      }
    }
  }
  if (snapshot?.project) {
    index.set(snapshot.project.record.id, { kind: "project", row: snapshot.project });
  }
  for (const knowledge of snapshot?.knowledge || []) {
    index.set(knowledge.record.id, { kind: "knowledge", row: knowledge });
  }
  return index;
}

export function formatTimestamp(value, timeZone = "JST") {
  if (value === undefined || value === null || value === "") return "";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return String(value);
  const zone = Object.hasOwn(TIME_ZONES, timeZone) ? timeZone : "JST";
  const offset = zone === "local" ? -new Date(parsed).getTimezoneOffset() : zone === "UTC" ? 0 : 540;
  const date = new Date(parsed + offset * 60000);
  if (!Number.isFinite(date.getTime())) return String(value);
  const pad = number => String(number).padStart(2, "0");
  const abs = Math.abs(offset);
  const zoneLabel = zone === "local"
    ? `UTC${offset < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
    : zone;
  return `${date.toISOString().slice(0, 19).replace("T", " ")} ${zoneLabel}`;
}

export function formatEventTime(value, timeZone = "JST") {
  if (!value) return { dateLabel: "日時不明", timeLabel: "--:--", fullLabel: "日時不明", zoneLabel: "" };
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return { dateLabel: String(value), timeLabel: "--:--", fullLabel: String(value), zoneLabel: "" };
  }
  const zone = Object.hasOwn(TIME_ZONES, timeZone) ? timeZone : "JST";
  const offset = zone === "local" ? -new Date(parsed).getTimezoneOffset() : zone === "UTC" ? 0 : 540;
  const date = new Date(parsed + offset * 60000);
  const iso = date.toISOString();
  const pad = number => String(number).padStart(2, "0");
  const abs = Math.abs(offset);
  const zoneLabel = zone === "local"
    ? `UTC${offset < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
    : zone;
  const dateLabel = iso.slice(0, 10);
  const timeLabel = iso.slice(11, 16);
  return {
    dateLabel,
    timeLabel,
    zoneLabel,
    fullLabel: `${dateLabel} ${iso.slice(11, 19)} ${zoneLabel}`,
  };
}

export function timelineRows(snapshot, { timeZone = "JST" } = {}) {
  const index = entityIndex(snapshot);
  return [...(snapshot?.timeline || [])]
    .sort((a, b) => {
      const left = Date.parse(a.timestamp);
      const right = Date.parse(b.timestamp);
      return (Number.isFinite(left) && Number.isFinite(right) ? right - left : 0) || Number(b.id) - Number(a.id);
    })
    .map(event => {
      const target = index.get(event.target);
      const before = event.from?.record;
      const after = event.to?.record;
      const jobRef = index.get(after?.job || before?.job);
      const owner = target || jobRef;
      const kind = event.kind
        || target?.kind
        || (typeof event.event === "string" && event.event.startsWith("knowledge.") ? "knowledge" : null)
        || (typeof event.target === "string" && event.target.startsWith("knw-") ? "knowledge" : null)
        || "record";
      const beforeStatus = before?.status;
      const afterStatus = after?.status;
      const transition = beforeStatus !== afterStatus && afterStatus
        ? (beforeStatus ? `${STATUS_LABELS[beforeStatus] || beforeStatus} → ` : "") + (STATUS_LABELS[afterStatus] || afterStatus)
        : "";
      const { dateLabel, timeLabel, zoneLabel, fullLabel } = formatEventTime(event.timestamp, timeZone);
      return {
        ...event,
        owner,
        kind,
        kindLabel: KIND_LABELS[kind] || kind,
        title: after?.objective || after?.name || after?.content
          || before?.objective || before?.name || before?.content
          || target?.row?.record?.objective || target?.row?.record?.name || target?.row?.record?.content
          || jobRef?.row?.record?.objective || target?.jobTitle || target?.ticketTitle
          || owner?.row?.record?.objective || owner?.row?.record?.name || owner?.row?.record?.content
          || event.target,
        label: EVENT_LABELS[event.event] || event.event,
        beforeStatus,
        afterStatus,
        transition,
        actorLabel: Array.isArray(event.actor) ? event.actor.join(" · ") : "",
        progress: event.to?.progress,
        dateLabel,
        timeLabel,
        zoneLabel,
        fullLabel,
      };
    });
}

export function filterTimelineRows(events, snapshot, filters = {}, customIcons = filters?.customIcons || {}) {
  const list = Array.isArray(events) ? events : [];
  const f = normalizeFilters(filters);
  if (!hasActiveFilters(f)) {
    return list;
  }

  const workVisible = f.workOnly ? visibleWork(snapshot, { workOnly: true }) : null;
  const statusSet = new Set(f.statuses);
  const iconKeySet = new Set(f.iconKeys);
  const q = f.query.toLowerCase();

  const taskById = new Map();
  const ticketById = new Map();
  const jobById = new Map();
  const runById = new Map();

  for (const entry of snapshot?.tasks ?? []) {
    const taskId = entry.task.record.id;
    taskById.set(taskId, entry.task);
    for (const item of entry.tickets ?? []) {
      const ticketId = item.ticket.record.id;
      const jobs = item.jobs ?? [];
      ticketById.set(ticketId, { taskId, ticket: item.ticket, jobs });
      for (const job of jobs) {
        const jobId = job.record.id;
        jobById.set(jobId, { taskId, ticketId, ticket: item.ticket, job });
        for (const run of job.record.runs ?? []) {
          if (run?.id) {
            runById.set(run.id, { taskId, ticketId, jobId, ticket: item.ticket, job });
          }
        }
      }
    }
  }

  const jobMatchesIcons = job => {
    if (!job) return false;
    const resolved = jobIcon(job, customIcons);
    if (iconKeySet.has(resolved)) return true;
    const rawKey = job?.display?.icon ?? job?.record?.display?.icon;
    return typeof rawKey === "string" && rawKey !== "id.copy" && iconKeySet.has(rawKey.trim());
  };

  return list.filter(event => {
    const targetId = event.target;
    const owner = event.owner;
    const runInfo = runById.get(targetId) || null;
    const jobId = owner?.jobId
      || runInfo?.jobId
      || (jobById.has(targetId) ? targetId : null)
      || event.to?.record?.job
      || event.from?.record?.job
      || null;
    const jobInfo = jobId ? jobById.get(jobId) : null;
    const ticketId = owner?.ticketId
      || jobInfo?.ticketId
      || runInfo?.ticketId
      || (ticketById.has(targetId) ? targetId : null)
      || event.to?.record?.ticket_id
      || event.from?.record?.ticket_id
      || null;
    const ticketInfo = ticketId ? ticketById.get(ticketId) : null;
    const taskId = owner?.taskId
      || ticketInfo?.taskId
      || jobInfo?.taskId
      || (taskById.has(targetId) ? targetId : null)
      || event.to?.record?.task_id
      || event.from?.record?.task_id
      || null;
    const taskRow = taskId ? taskById.get(taskId) : null;

    if (workVisible) {
      if (ticketId) {
        if (!workVisible.has(ticketId)) return false;
      } else if (taskId) {
        if (!workVisible.has(taskId)) return false;
      } else {
        return false;
      }
    }

    if (statusSet.size) {
      const eventStatus = event.afterStatus
        || event.to?.record?.status
        || owner?.row?.record?.status
        || jobInfo?.job?.record?.status
        || ticketInfo?.ticket?.record?.status
        || taskRow?.record?.status
        || null;
      if (!eventStatus || !statusSet.has(eventStatus)) return false;
    }

    if (f.workerId) {
      const ticketWorkerId = ticketInfo?.ticket?.record?.worker_id
        || event.to?.record?.worker_id
        || event.from?.record?.worker_id
        || null;
      const actorMatch = Array.isArray(event.actor)
        ? event.actor.includes(f.workerId)
        : event.actor === f.workerId;
      if (ticketWorkerId !== f.workerId && !actorMatch) return false;
    }

    if (iconKeySet.size) {
      const isJobOrRun = Boolean(jobInfo) || event.kind === "job" || event.kind === "run";
      if (isJobOrRun) {
        const matched = jobMatchesIcons(jobInfo?.job)
          || jobMatchesIcons(event.to)
          || jobMatchesIcons(event.from);
        if (!matched) return false;
      } else if (ticketInfo) {
        if (!(ticketInfo.jobs ?? []).some(jobMatchesIcons)) return false;
      } else {
        return false;
      }
    }

    if (q) {
      const haystacks = [
        event.title,
        event.kind,
        event.kindLabel,
        event.event,
        event.label,
        event.actorLabel,
        ...(Array.isArray(event.actor) ? event.actor : typeof event.actor === "string" ? [event.actor] : []),
        event.reason,
        event.progress?.message,
        event.target,
        event.transition,
        event.to?.record?.content,
        event.to?.record?.basis,
        event.from?.record?.content,
      ];
      if (!haystacks.some(val => typeof val === "string" && val.toLowerCase().includes(q))) {
        return false;
      }
    }

    return true;
  });
}

function latestTicketProgress(snapshot) {
  const progressByTicket = new Map();
  const events = timelineRows(snapshot);
  for (const event of events) {
    if (event.event !== "run.progress_changed") continue;
    const ticketId = event.owner?.ticketId;
    if (!ticketId || progressByTicket.has(ticketId)) continue;
    const hasProgress = Boolean(
      event.progress
      && (
        (event.progress.percent !== undefined && event.progress.percent !== null)
        || Boolean(event.progress.message)
      ),
    );
    progressByTicket.set(ticketId, hasProgress ? event.progress : null);
  }
  return progressByTicket;
}

export function kanbanColumns(snapshot, activeDetail = null, options = {}) {
  const tasks = snapshot?.tasks || [];
  const filters = normalizeFilters(options);
  const selectedStatuses = new Set(filters.statuses);
  const visible = hasActiveFilters(filters) ? filterWork(snapshot, options) : null;
  const allTickets = new Map();
  for (const entry of tasks) {
    for (const item of entry.tickets || []) {
      allTickets.set(item.ticket.record.id, item.ticket.record.objective);
    }
  }
  const timelineProgress = latestTicketProgress(snapshot);
  const activeColumnDefs = selectedStatuses.size
    ? KANBAN_COLUMNS.filter(col => col.statuses.some(status => selectedStatuses.has(status)))
    : KANBAN_COLUMNS;
  const columns = activeColumnDefs.map(col => ({
    ...col,
    cards: [],
  }));
  const columnByStatus = new Map();
  for (const col of columns) {
    for (const status of col.statuses) columnByStatus.set(status, col);
  }

  for (const entry of tasks) {
    const taskId = entry.task.record.id;
    const taskObjective = entry.task.record.objective;
    for (const item of entry.tickets || []) {
      const record = item.ticket.record;
      const ticketId = record.id;
      if (visible && !visible.has(ticketId)) continue;
      const jobs = item.jobs || [];
      const jobsCompleted = jobs.filter(job => job.record.status === "completed").length;
      const activeJob = jobs.find(job => job.record.status === "doing")
        || jobs.find(job => !["completed", "canceled"].includes(job.record.status))
        || null;

      let progress = null;
      if (activeDetail?.ticket?.record?.id === ticketId && activeDetail.run?.active) {
        progress = activeDetail.run.progress || { percent: null, message: "" };
      } else if (item.run?.active) {
        progress = item.run.progress || { percent: null, message: "" };
      } else if (record.status === "doing") {
        const activeRun = (activeJob?.record?.runs || []).find(run => run.active || !run.finished_at);
        if (activeRun?.progress) progress = activeRun.progress;
        else if (timelineProgress.has(ticketId)) progress = timelineProgress.get(ticketId);
      }

      const dependsIds = record.depends || [];
      const dependsTitles = dependsIds.map(id => allTickets.get(id) || id);
      const targetColumn = columnByStatus.get(record.status) || (selectedStatuses.size ? null : columns[0]);
      if (!targetColumn) continue;
      targetColumn.cards.push({
        kind: "ticket",
        ticketId,
        taskId,
        taskObjective,
        row: item.ticket,
        status: record.status,
        objective: record.objective,
        summary: item.ticket.display?.summary || "",
        workerId: record.worker_id,
        sessionId: record.session_id,
        jobs,
        jobsCompleted,
        jobsTotal: jobs.length,
        activeJob,
        progress,
        dependsIds,
        dependsTitles,
        hasDependencies: dependsIds.length > 0,
      });
    }
  }

  return columns;
}

function simplifyPoints(rawPoints) {
  const deduped = [];
  for (const point of rawPoints) {
    const prev = deduped[deduped.length - 1];
    if (!prev || prev[0] !== point[0] || prev[1] !== point[1]) {
      deduped.push([point[0], point[1]]);
    }
  }
  const result = [];
  for (const point of deduped) {
    while (result.length >= 2) {
      const a = result[result.length - 2];
      const b = result[result.length - 1];
      const sameX = a[0] === b[0] && b[0] === point[0];
      const sameY = a[1] === b[1] && b[1] === point[1];
      if (sameX || sameY) result.pop();
      else break;
    }
    result.push(point);
  }
  return result;
}

function edgeSegments(edges) {
  const horizontal = [];
  const vertical = [];
  for (const edge of edges) {
    const pts = edge.points || [];
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1];
      const [x2, y2] = pts[i];
      if (y1 === y2 && x1 !== x2) {
        horizontal.push({ edge, y: y1, x1: Math.min(x1, x2), x2: Math.max(x1, x2) });
      } else if (x1 === x2 && y1 !== y2) {
        vertical.push({ edge, x: x1, y1: Math.min(y1, y2), y2: Math.max(y1, y2) });
      }
    }
  }
  return { horizontal, vertical };
}

function edgesConnected(a, b) {
  return a === b || (Boolean(a.from) && a.from === b.from) || (Boolean(a.to) && a.to === b.to);
}

export function edgeBridges(edges, radius = TREE_METRICS.bridgeRadius) {
  const { horizontal, vertical } = edgeSegments(edges);
  const byPoint = new Map();

  for (const h of horizontal) {
    for (const v of vertical) {
      if (edgesConnected(h.edge, v.edge)) continue;
      if (v.x > h.x1 && v.x < h.x2 && h.y > v.y1 && h.y < v.y2) {
        const key = `${v.x}:${h.y}`;
        if (!byPoint.has(key)) {
          byPoint.set(key, {
            x: v.x,
            y: h.y,
            radius,
            orientation: "horizontal",
            over: { from: h.edge.from, to: h.edge.to },
            under: { from: v.edge.from, to: v.edge.to },
          });
        }
      }
    }
  }
  return [...byPoint.values()].sort((a, b) => a.y - b.y || a.x - b.x);
}

export function edgeJunctions(edges, nodesById = new Map(), direction = "horizontal") {
  const isVertical = direction === "vertical";
  const groups = [];
  const byFrom = new Map();
  const byTo = new Map();
  for (const edge of edges) {
    if (!byFrom.has(edge.from)) byFrom.set(edge.from, []);
    byFrom.get(edge.from).push(edge);
    if (!byTo.has(edge.to)) byTo.set(edge.to, []);
    byTo.get(edge.to).push(edge);
  }
  for (const [nodeId, groupEdges] of byFrom) {
    if (groupEdges.length >= 2) groups.push({ kind: "branch", nodeId, edges: groupEdges });
  }
  for (const [nodeId, groupEdges] of byTo) {
    if (groupEdges.length >= 2) groups.push({ kind: "merge", nodeId, edges: groupEdges });
  }

  const isPortPoint = (x, y, edge) => {
    const first = edge.points[0];
    const last = edge.points[edge.points.length - 1];
    if (first && first[0] === x && first[1] === y) return true;
    if (last && last[0] === x && last[1] === y) return true;
    const fromNode = nodesById.get(edge.from);
    const toNode = nodesById.get(edge.to);
    if (isVertical) {
      if (fromNode && y === fromNode.y + fromNode.height) return true;
      if (toNode && y === toNode.y) return true;
    } else {
      if (fromNode && x === fromNode.x + fromNode.width) return true;
      if (toNode && x === toNode.x) return true;
    }
    return false;
  };

  const found = new Map();
  for (const group of groups) {
    const { horizontal, vertical } = edgeSegments(group.edges);
    const candidates = new Map();
    for (const edge of group.edges) {
      for (const [x, y] of edge.points) {
        if (!isPortPoint(x, y, edge)) candidates.set(`${x}:${y}`, [x, y]);
      }
    }

    for (const [key, [x, y]] of candidates) {
      const directions = new Set();
      for (const h of horizontal) {
        if (h.y === y && h.x1 <= x && x <= h.x2) {
          if (h.x1 < x) directions.add("L");
          if (h.x2 > x) directions.add("R");
        }
      }
      for (const v of vertical) {
        if (v.x === x && v.y1 <= y && y <= v.y2) {
          if (v.y1 < y) directions.add("U");
          if (v.y2 > y) directions.add("D");
        }
      }
      if (directions.size >= 3 && !found.has(key)) {
        found.set(key, {
          x,
          y,
          kind: group.kind,
          nodeId: group.nodeId,
        });
      }
    }
  }
  return [...found.values()].sort((a, b) => a.y - b.y || a.x - b.x);
}

export function edgePathD(edge, bridges = []) {
  const pts = edge.points || [];
  if (!pts.length) return "";
  const commands = [`M ${pts[0][0]} ${pts[0][1]}`];

  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    if (ay === by && ax !== bx) {
      const left = Math.min(ax, bx);
      const right = Math.max(ax, bx);
      const matching = bridges.filter(b =>
        b.y === ay
        && b.x > left + b.radius
        && b.x < right - b.radius
        && b.under.from !== edge.from
        && b.under.to !== edge.to,
      );
      if (matching.length) {
        const dir = bx > ax ? 1 : -1;
        matching.sort((u, v) => (u.x - v.x) * dir);
        for (const b of matching) {
          const r = b.radius;
          if (dir > 0) {
            commands.push(`L ${b.x - r} ${ay}`, `A ${r} ${r} 0 0 1 ${b.x + r} ${ay}`);
          } else {
            commands.push(`L ${b.x + r} ${ay}`, `A ${r} ${r} 0 0 0 ${b.x - r} ${ay}`);
          }
        }
      }
    }
    commands.push(`L ${bx} ${by}`);
  }
  return commands.join(" ");
}

export function treeScene(snapshot, options = {}) {
  const m = TREE_METRICS;
  const direction = normalizeTreeDirection(options?.direction, "horizontal");
  const isVertical = direction === "vertical";
  const visible = hasActiveFilters(options) ? filterWork(snapshot, options) : null;
  const rows = workRows(snapshot);
  const allTicketRows = new Map(rows.filter(item => item.kind === "ticket").map(item => [item.ticketId, item]));
  const visibleTickets = new Map(
    [...allTicketRows.entries()].filter(([id]) => !visible || visible.has(id)),
  );
  const depths = new Map();
  const visiting = new Set();

  function depth(id) {
    if (depths.has(id)) return depths.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const parents = (visibleTickets.get(id)?.row.record.depends || []).filter(parent => visibleTickets.has(parent));
    const value = parents.length ? 1 + Math.max(...parents.map(depth)) : 0;
    visiting.delete(id);
    depths.set(id, value);
    return value;
  }

  const taskNodes = [];
  const ticketNodes = [];
  let orderCounter = 0;

  for (const [taskOrder, entry] of (snapshot?.tasks || []).entries()) {
    const taskId = entry.task.record.id;
    if (visible && !visible.has(taskId)) continue;
    const task = rows.find(item => item.kind === "task" && item.taskId === taskId);
    const taskTickets = (entry.tickets || []).filter(t => !visible || visible.has(t.ticket.record.id));

    taskNodes.push({
      ...task,
      x: m.paddingX,
      y: m.paddingY,
      width: m.cardWidth,
      height: m.cardHeight,
      depth: 0,
      column: 0,
      rowIndex: 0,
      taskOrder,
      orderIndex: orderCounter++,
    });

    for (const ticket of taskTickets) {
      const item = visibleTickets.get(ticket.ticket.record.id);
      const level = depth(item.ticketId);
      const dependsIds = item.row.record.depends || [];
      const dependsTitles = dependsIds.map(id => allTicketRows.get(id)?.row.record.objective || id);
      ticketNodes.push({
        ...item,
        x: m.paddingX,
        y: m.paddingY,
        width: m.cardWidth,
        height: m.cardHeight,
        depth: level,
        column: level + 1,
        rowIndex: 0,
        taskOrder,
        orderIndex: orderCounter++,
        dependsTitles,
      });
    }
  }

  const nodes = [...taskNodes, ...ticketNodes];

  if (!nodes.length) {
    return {
      direction,
      nodes: [],
      edges: [],
      junctions: [],
      bridges: [],
      metrics: { ...m },
      width: isVertical ? 320 : 600,
      height: 200,
    };
  }

  const byId = new Map(nodes.map(item => [item.row.record.id, item]));

  // Unified single-type edges:
  // Tickets with visible prerequisite (blocker) tickets connect ONLY from those tickets;
  // root tickets without visible prerequisites connect from their parent Task.
  const edges = [];
  for (const ticketNode of ticketNodes) {
    const visibleDeps = (ticketNode.row.record.depends || []).filter(id => byId.has(id));
    if (visibleDeps.length) {
      for (const depId of visibleDeps) {
        edges.push({ from: depId, to: ticketNode.ticketId });
      }
    } else if (byId.has(ticketNode.taskId)) {
      edges.push({ from: ticketNode.taskId, to: ticketNode.ticketId });
    }
  }

  // Topological placement so children align directly along the primary flow axis.
  const incoming = new Map();
  const outgoing = new Map();
  for (const edge of edges) {
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    incoming.get(edge.to).push(byId.get(edge.from));
    outgoing.get(edge.from).push(byId.get(edge.to));
  }
  for (const [fromId, children] of outgoing) {
    const parentTaskOrder = byId.get(fromId)?.taskOrder ?? 0;
    children.sort((a, b) =>
      Number(a.taskOrder !== parentTaskOrder) - Number(b.taskOrder !== parentTaskOrder)
      || a.taskOrder - b.taskOrder
      || a.orderIndex - b.orderIndex,
    );
  }

  const placedCells = new Set();
  const visited = new Set();
  let nextSlot = 0;

  function place(node, preferredSlot = nextSlot) {
    if (visited.has(node)) return false;
    const parents = incoming.get(node.row.record.id) || [];
    if (parents.some(parent => !visited.has(parent))) return false;
    let slot = preferredSlot;
    while (placedCells.has(`${node.column}:${slot}`)) {
      slot = nextSlot++;
    }
    visited.add(node);
    placedCells.add(`${node.column}:${slot}`);
    node.rowIndex = slot;
    nextSlot = Math.max(nextSlot, slot + 1);
    let first = true;
    for (const child of outgoing.get(node.row.record.id) || []) {
      if (place(child, first ? slot : nextSlot)) first = false;
    }
    return true;
  }

  for (const taskNode of taskNodes) place(taskNode);
  for (const ticketNode of ticketNodes) place(ticketNode);
  for (const node of nodes) {
    if (!visited.has(node)) {
      let slot = nextSlot;
      while (placedCells.has(`${node.column}:${slot}`)) slot = nextSlot++;
      visited.add(node);
      placedCells.add(`${node.column}:${slot}`);
      node.rowIndex = slot;
      nextSlot = Math.max(nextSlot, slot + 1);
    }
  }

  const totalSlots = nextSlot;
  const maxTier = Math.max(0, ...nodes.map(item => item.column));

  if (isVertical) {
    // Vertical (Top -> Bottom) layout: 90-degree rotation of horizontal layout.
    // Hierarchy depth (tier) runs top-to-bottom along Y (rowIndex = tier).
    // Parallel sibling tracks run left-to-right along X (column = trackIndex).
    for (const item of nodes) {
      const tier = item.column;
      const track = item.rowIndex;
      item.rowIndex = tier;
      item.column = track;
    }

    const guttersByTrack = new Map();
    for (const edge of edges) {
      const fromNode = byId.get(edge.from);
      const toNode = byId.get(edge.to);
      if (!fromNode || !toNode) continue;
      edge.fromTier = fromNode.rowIndex;
      edge.toTier = toNode.rowIndex;
      edge.skipsTier = toNode.rowIndex > fromNode.rowIndex + 1 || toNode.rowIndex <= fromNode.rowIndex;
      if (edge.skipsTier) {
        const track = toNode.column;
        if (!guttersByTrack.has(track)) guttersByTrack.set(track, new Set());
        guttersByTrack.get(track).add(edge.to);
      }
    }

    const gutterOrderByTrack = new Map(
      [...guttersByTrack].map(([track, ids]) => [track, [...ids].sort()]),
    );

    const trackLefts = [];
    let cursorX = m.paddingX;
    for (let track = 0; track < totalSlots; track++) {
      trackLefts.push(cursorX);
      const gutterCount = gutterOrderByTrack.get(track)?.length || 0;
      const corridor = gutterCount > 0
        ? m.gutterMarginTop + (gutterCount - 1) * m.gutterStep + m.gutterMarginBottom
        : m.baseRowGap;
      cursorX += m.cardWidth + Math.max(m.baseRowGap, corridor);
    }

    for (const item of nodes) {
      item.x = trackLefts[item.column];
    }

    const outgoingByNode = new Map();
    for (const edge of edges) {
      if (!outgoingByNode.has(edge.from)) outgoingByNode.set(edge.from, []);
      outgoingByNode.get(edge.from).push(edge);
    }

    const centerOffsetX = m.cardWidth / 2;
    for (const [nodeId, outputs] of outgoingByNode) {
      const fromNode = byId.get(nodeId);
      const straightOnly = outputs.every(edge => {
        const toNode = byId.get(edge.to);
        return toNode && toNode.column === fromNode.column && toNode.rowIndex === fromNode.rowIndex + 1;
      });
      const startX = fromNode.x + centerOffsetX;
      for (const edge of outputs) {
        const toNode = byId.get(edge.to);
        edge.startX = startX;
        edge.endX = toNode.x + centerOffsetX;
        edge.straight = straightOnly;
        if (edge.skipsTier) {
          const slot = gutterOrderByTrack.get(toNode.column).indexOf(edge.to);
          edge.gutterX = toNode.x + m.cardWidth + m.gutterMarginTop + slot * m.gutterStep;
        } else {
          edge.gutterX = edge.endX;
        }
      }
    }

    const departLaneCountByGap = new Map();
    const branchesByGap = new Map();
    for (const [nodeId, outputs] of outgoingByNode) {
      const nonStraight = outputs.filter(edge => !edge.straight);
      if (!nonStraight.length) continue;
      const gap = byId.get(nodeId).rowIndex;
      if (!branchesByGap.has(gap)) branchesByGap.set(gap, []);
      branchesByGap.get(gap).push({ nodeId, edges: nonStraight });
    }

    const spanOfX = group => {
      const xs = group.edges.flatMap(e => [e.startX, e.gutterX]);
      return Math.max(...xs) - Math.min(...xs);
    };

    for (const [gap, groups] of branchesByGap) {
      groups.sort((a, b) => spanOfX(b) - spanOfX(a) || a.nodeId.localeCompare(b.nodeId));
      const slots = [];
      for (const group of groups) {
        const routes = group.edges.map(e => ({
          left: Math.min(e.startX, e.gutterX),
          right: Math.max(e.startX, e.gutterX),
          to: e.to,
        }));
        let lane = slots.findIndex(existing =>
          routes.every(route =>
            existing.every(other =>
              route.right + m.laneStep * 2 < other.left || route.left > other.right + m.laneStep * 2,
            ),
          ),
        );
        if (lane < 0) {
          lane = slots.length;
          slots.push([]);
        }
        slots[lane].push(...routes);
        for (const edge of group.edges) edge.departLane = lane;
      }
      departLaneCountByGap.set(gap, slots.length);
    }

    const arriveGroupsByGap = new Map();
    for (const edge of edges) {
      if (!edge.skipsTier) continue;
      const gap = Math.max(0, edge.toTier - 1);
      if (!arriveGroupsByGap.has(gap)) arriveGroupsByGap.set(gap, new Map());
      const map = arriveGroupsByGap.get(gap);
      if (!map.has(edge.to)) map.set(edge.to, []);
      map.get(edge.to).push(edge);
    }

    const totalLanesByGap = new Map();
    for (let gap = 0; gap < maxTier; gap++) {
      const departCount = departLaneCountByGap.get(gap) || 0;
      const arriveMap = arriveGroupsByGap.get(gap);
      const arriveSlots = [];
      if (arriveMap) {
        const sortedTargets = [...arriveMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        for (const [, targetEdges] of sortedTargets) {
          const routes = targetEdges.map(e => ({
            left: Math.min(e.endX, e.gutterX),
            right: Math.max(e.endX, e.gutterX),
          }));
          let lane = arriveSlots.findIndex(existing =>
            routes.every(route =>
              existing.every(other =>
                route.right + m.laneStep * 2 < other.left || route.left > other.right + m.laneStep * 2,
              ),
            ),
          );
          if (lane < 0) {
            lane = arriveSlots.length;
            arriveSlots.push([]);
          }
          arriveSlots[lane].push(...routes);
          for (const edge of targetEdges) edge.arriveLane = departCount + lane;
        }
      }
      totalLanesByGap.set(gap, departCount + arriveSlots.length);
    }

    const tierYs = [m.paddingY];
    for (let gap = 0; gap < maxTier; gap++) {
      const laneCount = totalLanesByGap.get(gap) || 0;
      const requiredGap = laneCount > 0
        ? m.startStub + (laneCount - 1) * m.laneStep + m.endStub
        : m.minColGap;
      const tierGap = Math.max(m.minColGap, requiredGap);
      tierYs.push(tierYs[gap] + m.cardHeight + tierGap);
    }

    for (const item of nodes) {
      item.y = tierYs[item.rowIndex];
    }

    const laneYForGap = (gap, lane) => {
      const gapStartY = tierYs[gap] + m.cardHeight;
      const gapEndY = tierYs[gap + 1] ?? (gapStartY + m.minColGap);
      const laneCount = Math.max(1, totalLanesByGap.get(gap) || 1);
      const midY = Math.round((gapStartY + gapEndY) / 2);
      return Math.round(midY + (lane - (laneCount - 1) / 2) * m.laneStep);
    };

    for (const edge of edges) {
      const fromNode = byId.get(edge.from);
      const toNode = byId.get(edge.to);
      const startY = fromNode.y + fromNode.height;
      const endY = toNode.y;
      edge.startY = startY;
      edge.endY = endY;

      if (edge.straight) {
        edge.points = simplifyPoints([
          [edge.startX, startY],
          [edge.endX, endY],
        ]);
        continue;
      }

      const departY = laneYForGap(fromNode.rowIndex, edge.departLane || 0);
      const raw = [
        [edge.startX, startY],
        [edge.startX, departY],
        [edge.gutterX, departY],
      ];
      if (edge.skipsTier) {
        const arriveGap = Math.max(0, edge.toTier - 1);
        const arriveY = laneYForGap(arriveGap, edge.arriveLane || 0);
        raw.push([edge.gutterX, arriveY], [edge.endX, arriveY]);
      }
      raw.push([edge.endX, endY]);
      edge.points = simplifyPoints(raw);
    }

    const junctions = edgeJunctions(edges, byId, "vertical");
    const junctionKeys = new Set(junctions.map(j => `${j.x}:${j.y}`));
    const bridges = edgeBridges(edges, m.bridgeRadius).filter(b => !junctionKeys.has(`${b.x}:${b.y}`));

    const maxRight = Math.max(
      240,
      ...nodes.map(item => item.x + item.width + m.paddingX),
      ...edges.flatMap(edge => edge.points.map(pt => pt[0] + m.paddingX)),
    );
    const maxBottom = Math.max(
      240,
      ...nodes.map(item => item.y + item.height + m.paddingY),
      ...edges.flatMap(edge => edge.points.map(pt => pt[1] + m.paddingY)),
    );

    return {
      direction,
      nodes,
      edges,
      junctions,
      bridges,
      metrics: { ...m },
      width: maxRight,
      height: maxBottom,
    };
  }

  // Horizontal (Left -> Right) layout
  const totalRows = totalSlots;
  const maxCol = maxTier;

  const guttersByRow = new Map();
  for (const edge of edges) {
    const fromNode = byId.get(edge.from);
    const toNode = byId.get(edge.to);
    if (!fromNode || !toNode) continue;
    edge.fromColumn = fromNode.column;
    edge.toColumn = toNode.column;
    edge.skipsColumn = toNode.column > fromNode.column + 1 || toNode.column <= fromNode.column;
    if (edge.skipsColumn) {
      const r = toNode.rowIndex;
      if (!guttersByRow.has(r)) guttersByRow.set(r, new Set());
      guttersByRow.get(r).add(edge.to);
    }
  }

  const gutterOrderByRow = new Map(
    [...guttersByRow].map(([r, ids]) => [r, [...ids].sort()]),
  );

  const rowTops = [];
  let cursorY = m.paddingY;
  for (let r = 0; r < totalRows; r++) {
    rowTops.push(cursorY);
    const gutterCount = gutterOrderByRow.get(r)?.length || 0;
    const corridor = gutterCount > 0
      ? m.gutterMarginTop + (gutterCount - 1) * m.gutterStep + m.gutterMarginBottom
      : m.baseRowGap;
    cursorY += m.cardHeight + Math.max(m.baseRowGap, corridor);
  }

  for (const item of nodes) {
    item.y = rowTops[item.rowIndex];
  }

  const outgoingByNode = new Map();
  for (const edge of edges) {
    if (!outgoingByNode.has(edge.from)) outgoingByNode.set(edge.from, []);
    outgoingByNode.get(edge.from).push(edge);
  }

  const centerOffsetY = m.cardHeight / 2;
  for (const [nodeId, outputs] of outgoingByNode) {
    const fromNode = byId.get(nodeId);
    const straightOnly = outputs.every(edge => {
      const toNode = byId.get(edge.to);
      return toNode && toNode.rowIndex === fromNode.rowIndex && toNode.column === fromNode.column + 1;
    });
    const startY = fromNode.y + centerOffsetY;
    for (const edge of outputs) {
      const toNode = byId.get(edge.to);
      edge.startY = startY;
      edge.endY = toNode.y + centerOffsetY;
      edge.straight = straightOnly;
      if (edge.skipsColumn) {
        const slot = gutterOrderByRow.get(toNode.rowIndex).indexOf(edge.to);
        edge.gutterY = toNode.y + m.cardHeight + m.gutterMarginTop + slot * m.gutterStep;
      } else {
        edge.gutterY = edge.endY;
      }
    }
  }

  const departLaneCountByGap = new Map();
  const branchesByGap = new Map();
  for (const [nodeId, outputs] of outgoingByNode) {
    const nonStraight = outputs.filter(edge => !edge.straight);
    if (!nonStraight.length) continue;
    const gap = byId.get(nodeId).column;
    if (!branchesByGap.has(gap)) branchesByGap.set(gap, []);
    branchesByGap.get(gap).push({ nodeId, edges: nonStraight });
  }

  const spanOf = group => {
    const ys = group.edges.flatMap(e => [e.startY, e.gutterY]);
    return Math.max(...ys) - Math.min(...ys);
  };

  for (const [gap, groups] of branchesByGap) {
    groups.sort((a, b) => spanOf(b) - spanOf(a) || a.nodeId.localeCompare(b.nodeId));
    const slots = [];
    for (const group of groups) {
      const routes = group.edges.map(e => ({
        top: Math.min(e.startY, e.gutterY),
        bottom: Math.max(e.startY, e.gutterY),
        to: e.to,
      }));
      let lane = slots.findIndex(existing =>
        routes.every(route =>
          existing.every(other =>
            route.bottom + m.laneStep * 2 < other.top || route.top > other.bottom + m.laneStep * 2,
          ),
        ),
      );
      if (lane < 0) {
        lane = slots.length;
        slots.push([]);
      }
      slots[lane].push(...routes);
      for (const edge of group.edges) edge.departLane = lane;
    }
    departLaneCountByGap.set(gap, slots.length);
  }

  const arriveGroupsByGap = new Map();
  for (const edge of edges) {
    if (!edge.skipsColumn) continue;
    const gap = Math.max(0, edge.toColumn - 1);
    if (!arriveGroupsByGap.has(gap)) arriveGroupsByGap.set(gap, new Map());
    const map = arriveGroupsByGap.get(gap);
    if (!map.has(edge.to)) map.set(edge.to, []);
    map.get(edge.to).push(edge);
  }

  const totalLanesByGap = new Map();
  for (let gap = 0; gap < maxCol; gap++) {
    const departCount = departLaneCountByGap.get(gap) || 0;
    const arriveMap = arriveGroupsByGap.get(gap);
    const arriveSlots = [];
    if (arriveMap) {
      const sortedTargets = [...arriveMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      for (const [, targetEdges] of sortedTargets) {
        const routes = targetEdges.map(e => ({
          top: Math.min(e.endY, e.gutterY),
          bottom: Math.max(e.endY, e.gutterY),
        }));
        let lane = arriveSlots.findIndex(existing =>
          routes.every(route =>
            existing.every(other =>
              route.bottom + m.laneStep * 2 < other.top || route.top > other.bottom + m.laneStep * 2,
            ),
          ),
        );
        if (lane < 0) {
          lane = arriveSlots.length;
          arriveSlots.push([]);
        }
        arriveSlots[lane].push(...routes);
        for (const edge of targetEdges) edge.arriveLane = departCount + lane;
      }
    }
    totalLanesByGap.set(gap, departCount + arriveSlots.length);
  }

  const colXs = [m.paddingX];
  for (let gap = 0; gap < maxCol; gap++) {
    const laneCount = totalLanesByGap.get(gap) || 0;
    const requiredGap = laneCount > 0
      ? m.startStub + (laneCount - 1) * m.laneStep + m.endStub
      : m.minColGap;
    const colGap = Math.max(m.minColGap, requiredGap);
    colXs.push(colXs[gap] + m.cardWidth + colGap);
  }

  for (const item of nodes) {
    item.x = colXs[item.column];
  }

  const laneXForGap = (gap, lane) => {
    const gapStartX = colXs[gap] + m.cardWidth;
    const gapEndX = colXs[gap + 1] ?? (gapStartX + m.minColGap);
    const laneCount = Math.max(1, totalLanesByGap.get(gap) || 1);
    const midX = Math.round((gapStartX + gapEndX) / 2);
    return Math.round(midX + (lane - (laneCount - 1) / 2) * m.laneStep);
  };

  for (const edge of edges) {
    const fromNode = byId.get(edge.from);
    const toNode = byId.get(edge.to);
    const startX = fromNode.x + fromNode.width;
    const endX = toNode.x;

    if (edge.straight) {
      edge.points = simplifyPoints([
        [startX, edge.startY],
        [endX, edge.endY],
      ]);
      continue;
    }

    const departX = laneXForGap(fromNode.column, edge.departLane || 0);
    const raw = [
      [startX, edge.startY],
      [departX, edge.startY],
      [departX, edge.gutterY],
    ];
    if (edge.skipsColumn) {
      const arriveGap = Math.max(0, edge.toColumn - 1);
      const arriveX = laneXForGap(arriveGap, edge.arriveLane || 0);
      raw.push([arriveX, edge.gutterY], [arriveX, edge.endY]);
    }
    raw.push([endX, edge.endY]);
    edge.points = simplifyPoints(raw);
  }

  const junctions = edgeJunctions(edges, byId, "horizontal");
  const junctionKeys = new Set(junctions.map(j => `${j.x}:${j.y}`));
  const bridges = edgeBridges(edges, m.bridgeRadius).filter(b => !junctionKeys.has(`${b.x}:${b.y}`));

  const maxRight = Math.max(600, ...nodes.map(item => item.x + item.width + m.paddingX));
  const maxBottom = Math.max(
    240,
    ...nodes.map(item => item.y + item.height + m.paddingY),
    ...edges.flatMap(edge => edge.points.map(pt => pt[1] + m.paddingY)),
  );

  return {
    direction,
    nodes,
    edges,
    junctions,
    bridges,
    metrics: { ...m },
    width: maxRight,
    height: maxBottom,
  };
}
