import {
  VIEWS,
  TREE_DIRECTIONS,
  normalizeTreeDirection,
  WORK_STATUSES,
  STATUS_LABELS,
  KNOWLEDGE_STATUS_LABELS,
  TIME_ZONES,
  DEFAULT_ICONS,
  PRESET_ICON_ASSETS,
  MAX_CUSTOM_ICON_BYTES,
  JOB_ICON_OPTIONS,
  isStandardIconKey,
  isValidIconKey,
  isSafeIconSource,
  sanitizeSvgMarkup,
  sanitizeCustomIconsMap,
  jobIconPath,
  jobIconAsset,
  allJobIconOptions,
  projectIconKeys,
  parseDependsInput,
  visibleJobs,
  activeFilterCount,
  hasActiveFilters,
  canDeleteTask,
  canPurgeTask,
  canDeleteProject,
  formatTimestamp,
  parseRoute,
  routeUrl,
  workRows,
  timelineRows,
  filterTimelineRows,
  kanbanColumns,
  treeScene,
  edgePathD,
} from "./view-model.mjs";

const $ = id => document.getElementById(id);
const terminal = row => ["completed", "canceled"].includes(row?.record?.status);

function getBridge() {
  return typeof window !== "undefined" && window.TTJ_BRIDGE ? window.TTJ_BRIDGE : null;
}

function isOrcaPanelMode() {
  return getBridge()?.mode === "orca-panel";
}

function assetUrl(path) {
  if (typeof path !== "string" || !path) return path;
  const base = typeof getBridge()?.assetBase === "string" ? getBridge().assetBase.replace(/\/+$/, "") : "";
  if (!base || !path.startsWith("/")) return path;
  return base + path;
}

function loadInitialRoute() {
  if (isOrcaPanelMode()) {
    let savedView = null;
    try {
      const stored = localStorage.getItem("ttjweb-orca-view");
      if (stored && Object.hasOwn(VIEWS, stored)) savedView = stored;
    } catch {
      // Ignore
    }
    const fallbackView = Object.hasOwn(VIEWS, getBridge()?.defaultView) ? getBridge().defaultView : "list";
    return {
      view: savedView || fallbackView,
      projectId: null,
      taskId: null,
      ticketId: null,
      modal: null,
      jobId: null,
      knowledgeId: null,
    };
  }
  return parseRoute(location.href);
}

function treeDirectionStorageKey() {
  return isOrcaPanelMode() ? "ttjweb-orca-tree-direction" : "ttjweb-tree-direction";
}

function defaultTreeDirection() {
  if (isOrcaPanelMode()) return "vertical";
  return (typeof window !== "undefined" && window.innerWidth <= 600) ? "vertical" : "horizontal";
}

function loadSavedTreeDirection() {
  try {
    const saved = localStorage.getItem(treeDirectionStorageKey());
    if (saved === "horizontal" || saved === "vertical") return saved;
  } catch {
    // Ignore
  }
  return null;
}

function saveTreeDirection(dir) {
  try {
    localStorage.setItem(treeDirectionStorageKey(), dir);
  } catch {
    // Ignore
  }
}

function loadInitialTreeDirection(route) {
  if (route?.dir === "horizontal" || route?.dir === "vertical") {
    return { direction: route.dir, explicit: true };
  }
  const saved = loadSavedTreeDirection();
  if (saved) {
    return { direction: saved, explicit: true };
  }
  return { direction: defaultTreeDirection(), explicit: false };
}

const initialRoute = loadInitialRoute();
const initialTreeDir = loadInitialTreeDirection(initialRoute);
let externalThemeScheme = null;

const state = {
  projects: [],
  workers: [],
  sessions: [],
  snapshot: null,
  detail: null,
  knowledgeCache: new Map(),
  view: initialRoute.view,
  treeDirection: initialTreeDir.direction,
  treeDirectionExplicit: initialTreeDir.explicit,
  listFilter: "all",
  filters: {
    workOnly: false,
    statuses: [],
    iconKeys: [],
    workerId: "",
    query: "",
  },
  customIcons: {},
  themeMode: "light", // "system" | "light" | "dark"
  resolvedTheme: "light",
  timeZone: "JST", // "JST" | "UTC" | "local"
  projectId: initialRoute.projectId,
  taskId: initialRoute.taskId,
  ticketId: initialRoute.ticketId,
  config: {
    actor: "ttjweb",
    protocol: "TTJ/1.1.0",
    watch_prefix: "ttjcore",
    allowHosts: [],
    readOnly: false,
    authEnabled: false,
  },
};

const isReadOnly = () => Boolean(state.config?.readOnly);
const READ_ONLY_TIP = "読み取り専用モードのため操作できません";

const modalState = {
  open: false,
  kind: null, // "task" | "ticket" | "job"
  id: null,
  taskId: null,
  ticketId: null,
  backStack: [],
};

const panelState = {
  open: false,
  mode: null, // "settings" | "knowledge" | "knowledge-detail" | "people"
  knowledgeId: null,
  knowledgeLoading: false,
  knowledgeFallback: null,
};

let filterPopoverOpen = false;
let generation = 0;
let watchAbort;
let toastTimer;

const progressDraft = {
  runId: null,
  percent: "",
  message: "",
  dirty: false,
};
let progressSubmitting = false;

function resetProgressDraft() {
  progressDraft.runId = null;
  progressDraft.percent = "";
  progressDraft.message = "";
  progressDraft.dirty = false;
}

const CANVAS_MIN_SCALE = 0.25;
const CANVAS_MAX_SCALE = 2.2;
const CANVAS_ZOOM_STEP = 1.2;
const DRAG_THRESHOLD_PX = 5;

const canvasView = {
  projectId: null,
  scale: 1,
  x: 0,
  y: 0,
  initialized: false,
  userControlled: false,
};

let canvasController = null;

const kanbanCollapsed = {
  canceled: false,
};

const systemColorScheme = window.matchMedia?.("(prefers-color-scheme: dark)") || null;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function svgIcon(url, className = "") {
  const span = node("span", "svg-icon" + (className ? " " + className : ""));
  span.style.setProperty("--icon-url", `url('${assetUrl(url)}')`);
  span.setAttribute("aria-hidden", "true");
  return span;
}

function statusBadge(status) {
  const label = STATUS_LABELS[status] || KNOWLEDGE_STATUS_LABELS[status] || status || "";
  return node("span", "status-badge " + (status || ""), label);
}

function setStatusBadge(el, status) {
  el.className = "status-badge " + (status || "");
  el.textContent = STATUS_LABELS[status] || KNOWLEDGE_STATUS_LABELS[status] || status || "";
}

function toastHost() {
  for (const id of ["dialog", "panel-modal", "detail-modal"]) {
    const dlg = $(id);
    if (dlg?.open) return dlg;
  }
  return document.body;
}

function hideToastNow() {
  const toast = $("toast");
  if (!toast) return;
  if (typeof toast.hidePopover === "function") {
    try {
      if (toast.matches(":popover-open")) toast.hidePopover();
    } catch {
      // Ignore
    }
  }
  toast.hidden = true;
}

function restoreToastHost() {
  const toast = $("toast");
  if (!toast) return;
  const target = toastHost();
  if (toast.parentElement !== target) {
    const wasVisible = !toast.hidden;
    if (wasVisible && typeof toast.hidePopover === "function") {
      try {
        if (toast.matches(":popover-open")) toast.hidePopover();
      } catch {
        // Ignore
      }
    }
    target.append(toast);
    if (wasVisible && typeof toast.showPopover === "function") {
      try {
        toast.showPopover();
      } catch {
        // Ignore
      }
    }
  }
}

function showToast(message) {
  const toast = $("toast");
  if (!toast) return;
  const host = toastHost();
  if (toast.parentElement !== host) {
    if (typeof toast.hidePopover === "function") {
      try {
        if (toast.matches(":popover-open")) toast.hidePopover();
      } catch {
        // Ignore
      }
    }
    host.append(toast);
  }
  toast.textContent = message;
  toast.hidden = false;
  if (typeof toast.showPopover === "function") {
    try {
      if (toast.matches(":popover-open")) toast.hidePopover();
      toast.showPopover();
    } catch {
      // Ignore popover errors in unsupported environments
    }
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToastNow, 3200);
}

async function copyText(text, successMessage = "IDをコピーしました") {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch {
    showToast(text);
  }
}

function copyIdButton(id, label = id + " · クリックでIDをコピー") {
  const btn = node("button", "card-copy-btn");
  btn.type = "button";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.append(svgIcon(jobIconPath("id.copy"), "sm"));
  btn.addEventListener("pointerdown", event => event.stopPropagation());
  btn.addEventListener("click", event => {
    event.stopPropagation();
    copyText(id, `IDをコピー: ${id}`);
  });
  return btn;
}

const CUSTOM_ICONS_STORAGE_KEY = "ttjweb.customIcons";

function loadCustomIcons() {
  try {
    const raw = localStorage.getItem(CUSTOM_ICONS_STORAGE_KEY);
    if (!raw) return {};
    return sanitizeCustomIconsMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

function saveCustomIcons() {
  try {
    localStorage.setItem(CUSTOM_ICONS_STORAGE_KEY, JSON.stringify(state.customIcons));
  } catch {
    throw new Error("ブラウザの保存領域が不足しているためカスタムアイコンを保存できませんでした。");
  }
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function sanitizeSvgInBrowser(rawSvg) {
  const preCleaned = sanitizeSvgMarkup(rawSvg);
  const parser = new DOMParser();
  const doc = parser.parseFromString(preCleaned, "image/svg+xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("SVGの構文が正しくないため読み込めませんでした。");
  }
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== "svg") {
    throw new Error("ルート要素が <svg> ではありません。");
  }
  const blocked = new Set([
    "script", "foreignobject", "iframe", "object", "embed", "applet",
    "audio", "video", "handler", "link", "meta", "use", "image",
    "animate", "animatetransform", "animatemotion", "set",
  ]);
  for (const el of [...root.querySelectorAll("*")]) {
    const tag = el.tagName.toLowerCase();
    if (blocked.has(tag)) {
      el.remove();
      continue;
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const val = attr.value.trim();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }
      if ((name === "href" || name === "xlink:href" || name === "src")
        && /^(?:javascript:|vbscript:|data:|https?:|\/\/)/i.test(val)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (/javascript\s*:|vbscript\s*:/i.test(val)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === "style" && /@import|expression\s*\(|url\s*\(\s*['"]?\s*(?:https?:|\/\/|data:|javascript:)/i.test(val)) {
        el.removeAttribute(attr.name);
      }
    }
  }
  for (const attr of [...root.attributes]) {
    if (attr.name.toLowerCase().startsWith("on") || /javascript\s*:|vbscript\s*:/i.test(attr.value)) {
      root.removeAttribute(attr.name);
    }
  }
  if (!root.getAttribute("xmlns")) {
    root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  const serialized = new XMLSerializer().serializeToString(root);
  return sanitizeSvgMarkup(serialized);
}

function renderIconGraphic(input, customIcons = state.customIcons, extraClass = "sm") {
  const asset = jobIconAsset(input, customIcons);
  if (asset.renderMode === "img") {
    const img = node("img", "job-icon-img");
    img.src = assetUrl(asset.src);
    img.alt = "";
    img.width = 12;
    img.height = 12;
    img.decoding = "async";
    img.setAttribute("aria-hidden", "true");
    return img;
  }
  return svgIcon(asset.src, extraClass);
}

function createJobDot(job, { interactive = true, onClick = null, customIcons = state.customIcons } = {}) {
  const status = job.record?.status || "todo";
  const asset = jobIconAsset(job, customIcons);
  const key = asset.key;
  const label = `${job.record?.objective || "Job"} · ${STATUS_LABELS[status] || status}`;
  const cls = `${interactive ? "job-dot-btn" : "job-dot-static"} ${status}${key === "github" ? " icon-github" : ""}`;
  const el = node(interactive ? "button" : "span", cls);
  if (interactive) el.type = "button";
  el.title = label;
  el.dataset.jobId = job.record?.id || "";
  el.dataset.jobIcon = key;
  el.setAttribute("aria-label", label);
  el.append(renderIconGraphic(key, customIcons, "sm"));
  if (interactive && onClick) {
    el.addEventListener("pointerdown", event => event.stopPropagation());
    el.addEventListener("click", event => {
      event.stopPropagation();
      onClick(job);
    });
  }
  return el;
}

function workerName(workerId) {
  return state.workers.find(worker => worker.record.id === workerId)?.record.name || workerId || "未割当";
}

function setDetailError(error) {
  const el = $("detail-error");
  if (!el) return;
  if (!error) {
    el.hidden = true;
    el.textContent = "";
  } else {
    el.textContent = error?.message || String(error);
    el.hidden = false;
  }
}

function showError(error) {
  const message = error?.message || String(error);
  if ($("detail-modal")?.open) {
    setDetailError(message);
    return;
  }
  if ($("panel-modal")?.open) {
    setPanelError(message);
    return;
  }
  const banner = $("error");
  if (banner) {
    banner.textContent = message;
    banner.hidden = false;
  }
}

function clearError() {
  const banner = $("error");
  if (banner) banner.hidden = true;
  setDetailError(null);
  setPanelError(null);
}

function connected(ready) {
  const dot = $("connection-dot");
  dot.classList.toggle("ready", ready);
  dot.title = ready ? "TTJCore 接続中" : "再接続を待っています";
}

/* ================================
   Theme & TimeZone Persistence
   ================================ */
function loadThemeMode() {
  const fallback = isOrcaPanelMode() ? "system" : "light";
  try {
    const saved = localStorage.getItem("ttjweb-theme");
    return ["system", "light", "dark"].includes(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}

function resolveTheme(mode) {
  if (mode === "dark") return "dark";
  if (mode === "light") return "light";
  if (externalThemeScheme === "dark" || externalThemeScheme === "light") {
    return externalThemeScheme;
  }
  return systemColorScheme?.matches ? "dark" : "light";
}

function applyTheme(mode, { persist = true } = {}) {
  state.themeMode = ["system", "light", "dark"].includes(mode) ? mode : "light";
  state.resolvedTheme = resolveTheme(state.themeMode);
  document.documentElement.dataset.theme = state.resolvedTheme;

  const isDark = state.resolvedTheme === "dark";
  const brandSrc = assetUrl(isDark ? "/assets/app-icon.png" : "/assets/app-icon-light.png");
  if (!isOrcaPanelMode()) {
    const favicon = $("favicon");
    if (!favicon || favicon.getAttribute("href") !== brandSrc) {
      const nextFavicon = document.createElement("link");
      nextFavicon.id = "favicon";
      nextFavicon.rel = "icon";
      nextFavicon.type = "image/png";
      nextFavicon.setAttribute("sizes", "512x512");
      nextFavicon.setAttribute("href", brandSrc);
      if (favicon) {
        favicon.replaceWith(nextFavicon);
      } else {
        document.head.append(nextFavicon);
      }
    }
  }
  const brandImg = $("brand-icon");
  if (brandImg) brandImg.src = brandSrc;
  const welcomeImg = $("welcome-icon");
  if (welcomeImg) welcomeImg.src = brandSrc;

  const icon = $("theme-icon");
  const btn = $("theme-toggle");
  if (icon && btn) {
    icon.style.setProperty("--icon-url", `url('${assetUrl(`/icons/${isDark ? "sun" : "moon"}.svg`)}')`);
    const label = isDark ? "ライトテーマへ切替" : "ダークテーマへ切替";
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }
  if (persist) {
    try {
      localStorage.setItem("ttjweb-theme", state.themeMode);
    } catch {
      // Ignore storage quota errors
    }
  }
  if (panelState.open && panelState.mode === "settings") {
    renderPanelModal();
  }
  canvasController?.redraw?.();
}

function loadTimeZone() {
  try {
    const saved = localStorage.getItem("ttjweb-timezone");
    return Object.hasOwn(TIME_ZONES, saved) ? saved : "JST";
  } catch {
    return "JST";
  }
}

function applyTimeZone(tz) {
  state.timeZone = Object.hasOwn(TIME_ZONES, tz) ? tz : "JST";
  try {
    localStorage.setItem("ttjweb-timezone", state.timeZone);
  } catch {
    // Ignore
  }
  render();
  if (panelState.open) renderPanelModal();
}

/* ================================
   Multi-condition Filters
   ================================ */
function filterKey(projectId) {
  return "ttjweb-work-only:" + (projectId || "");
}

function loadWorkOnly(projectId) {
  try {
    return localStorage.getItem(filterKey(projectId)) === "1";
  } catch {
    return false;
  }
}

function saveWorkOnly(projectId, value) {
  try {
    localStorage.setItem(filterKey(projectId), value ? "1" : "0");
  } catch {
    // Ignore
  }
}

function positionFilterPopover() {
  const pop = $("filter-popover");
  const btn = $("filter-btn");
  if (!pop || !btn || pop.hidden) return;
  const rect = btn.getBoundingClientRect();
  const popWidth = Math.min(340, window.innerWidth - 20);
  const left = Math.max(10, Math.min(rect.right - popWidth, window.innerWidth - popWidth - 10));
  const top = Math.min(window.innerHeight - 120, rect.bottom + 6);
  pop.style.left = `${Math.round(left)}px`;
  pop.style.right = "auto";
  pop.style.top = `${Math.round(top)}px`;
}

function currentFilterOptions() {
  return { ...state.filters, customIcons: state.customIcons };
}

function syncFilterControls() {
  const btn = $("filter-btn");
  const badge = $("filter-badge");
  const count = activeFilterCount(state.filters);
  const disabled = !state.projectId;
  btn.disabled = disabled;
  btn.classList.toggle("is-active", (count > 0 || filterPopoverOpen) && !disabled);
  btn.setAttribute("aria-expanded", String(filterPopoverOpen && !disabled));
  if (badge) {
    badge.hidden = disabled || count === 0;
    badge.textContent = String(count);
  }
  const label = count > 0
    ? `フィルタ適用中（${count}条件）· クリックで設定`
    : "フィルタ（進行対象・ステータス・アイコンキー・担当者・検索）";
  btn.title = label;
  btn.setAttribute("aria-label", label);

  if (disabled && filterPopoverOpen) {
    closeFilterPopover();
    return;
  }

  // Sync popover inputs
  const workOnlyCheck = $("filter-work-only-check");
  if (workOnlyCheck) workOnlyCheck.checked = Boolean(state.filters.workOnly);

  const chipWrap = $("filter-status-chips");
  if (chipWrap) {
    const selectedSet = new Set(state.filters.statuses);
    chipWrap.replaceChildren(...WORK_STATUSES.map(status => {
      const selected = selectedSet.has(status);
      const chip = node("button", "filter-chip" + (selected ? " is-selected" : ""));
      chip.type = "button";
      chip.dataset.status = status;
      chip.setAttribute("aria-pressed", String(selected));
      chip.append(node("i", `legend-dot st-${status}`), document.createTextNode(STATUS_LABELS[status]));
      chip.onclick = () => {
        const next = new Set(state.filters.statuses);
        if (next.has(status)) next.delete(status);
        else next.add(status);
        state.filters.statuses = [...next];
        if (!canvasView.userControlled) canvasView.initialized = false;
        render();
      };
      return chip;
    }));
  }

  const iconChipWrap = $("filter-icon-chips");
  if (iconChipWrap) {
    const selectedIcons = new Set(state.filters.iconKeys);
    const availableKeys = projectIconKeys(state.snapshot, state.customIcons);
    iconChipWrap.replaceChildren(...availableKeys.map(iconKey => {
      const selected = selectedIcons.has(iconKey);
      const chip = node("button", "filter-chip" + (selected ? " is-selected" : ""));
      chip.type = "button";
      chip.dataset.iconKey = iconKey;
      chip.setAttribute("aria-pressed", String(selected));
      const customDesc = state.customIcons[iconKey]?.label;
      chip.title = customDesc ? `${iconKey} — ${customDesc}` : iconKey;
      chip.append(
        renderIconGraphic(iconKey, state.customIcons, "sm"),
        node("span", "filter-chip-key", iconKey),
      );
      chip.onclick = () => {
        const next = new Set(state.filters.iconKeys);
        if (next.has(iconKey)) next.delete(iconKey);
        else next.add(iconKey);
        state.filters.iconKeys = [...next];
        if (!canvasView.userControlled) canvasView.initialized = false;
        render();
      };
      return chip;
    }));
  }

  const workerSelect = $("filter-worker-select");
  if (workerSelect) {
    const options = [
      { value: "", label: "すべての担当者" },
      ...state.workers.map(w => ({ value: w.record.id, label: `${w.record.name} (${w.record.id})` })),
    ];
    workerSelect.replaceChildren(...options.map(opt => {
      const el = node("option", "", opt.label);
      el.value = opt.value;
      return el;
    }));
    workerSelect.value = state.filters.workerId || "";
  }

  const queryInput = $("filter-query-input");
  if (queryInput && queryInput !== document.activeElement) {
    queryInput.value = state.filters.query || "";
  }

  const summary = $("filter-summary");
  if (summary) {
    summary.textContent = count > 0 ? `${count}件の条件を適用中` : "フィルタなし";
  }

  const resetBtn = $("filter-reset");
  if (resetBtn) resetBtn.disabled = count === 0;
}

function openFilterPopover() {
  if (!state.projectId) return;
  filterPopoverOpen = true;
  $("filter-popover").hidden = false;
  syncFilterControls();
  positionFilterPopover();
}

function closeFilterPopover() {
  filterPopoverOpen = false;
  $("filter-popover").hidden = true;
  syncFilterControls();
}

function resetFilters() {
  state.filters = { workOnly: false, statuses: [], iconKeys: [], workerId: "", query: "" };
  if (state.projectId) saveWorkOnly(state.projectId, false);
  const queryInput = $("filter-query-input");
  if (queryInput) queryInput.value = "";
  if (!canvasView.userControlled) canvasView.initialized = false;
  render();
}

/* ================================
   Routing & API
   ================================ */
function currentRouteState() {
  const dirPart = (state.view === "tree" || state.treeDirectionExplicit)
    ? { dir: state.treeDirection }
    : {};
  if (modalState.open && modalState.kind) {
    return {
      view: state.view,
      ...dirPart,
      projectId: state.projectId,
      taskId: modalState.taskId,
      ticketId: modalState.kind === "task" ? null : modalState.ticketId,
      modal: modalState.kind,
      jobId: modalState.kind === "job" ? modalState.id : null,
      knowledgeId: null,
    };
  }
  if (panelState.open && panelState.mode) {
    const modal = panelState.mode === "knowledge-detail" ? "knowledge" : panelState.mode;
    return {
      view: state.view,
      ...dirPart,
      projectId: state.projectId,
      taskId: state.taskId,
      ticketId: state.ticketId,
      modal,
      jobId: null,
      knowledgeId: panelState.mode === "knowledge-detail" ? panelState.knowledgeId : null,
    };
  }
  return {
    view: state.view,
    ...dirPart,
    projectId: state.projectId,
    taskId: state.taskId,
    ticketId: state.ticketId,
    modal: null,
    jobId: null,
    knowledgeId: null,
  };
}

function syncUrl(mode = "replace") {
  if (!isOrcaPanelMode()) {
    const next = routeUrl(currentRouteState());
    const current = location.pathname + location.search;
    if (mode !== "none" && next !== current) {
      if (mode === "push") history.pushState({}, "", next);
      else history.replaceState({}, "", next);
    }
  } else {
    try {
      localStorage.setItem("ttjweb-orca-view", state.view);
    } catch {
      // Ignore
    }
  }
  const projectTitle = state.snapshot?.project?.record?.name;
  const viewTitle = VIEWS[state.view] || VIEWS.tree;
  document.title = projectTitle ? `TTJWeb · ${projectTitle} · ${viewTitle}` : `TTJWeb · ${viewTitle}`;
}

async function fetchMeta() {
  const bridge = getBridge();
  if (bridge && typeof bridge.getMeta === "function") {
    return await bridge.getMeta();
  }
  const response = await fetch("/api/meta", { cache: "no-store" });
  if (response.status === 401) {
    location.reload();
    throw new Error("認証が必要です。");
  }
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "接続情報の取得に失敗しました");
  return body;
}

async function api(method, params = {}, signal) {
  if (!method.endsWith(".list") && !method.endsWith(".get") && !method.endsWith(".snapshot") && method !== "events.wait") {
    params = { ...params, operation: crypto.randomUUID() };
  }
  const bridge = getBridge();
  if (bridge && typeof bridge.call === "function") {
    const result = await bridge.call(method, params, { signal });
    connected(true);
    return result;
  }
  const response = await fetch("/api/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
    signal,
  });
  if (response.status === 401) {
    location.reload();
    throw new Error("認証が必要です。");
  }
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "操作に失敗しました");
  connected(true);
  return body.result;
}

function findTaskEntry(taskId = state.taskId) {
  return state.snapshot?.tasks?.find(entry => entry.task.record.id === taskId) || null;
}

function findTicketItem(ticketId = state.ticketId) {
  if (!ticketId || !state.snapshot) return null;
  for (const entry of state.snapshot.tasks || []) {
    const found = (entry.tickets || []).find(item => item.ticket.record.id === ticketId);
    if (found) return { taskEntry: entry, ticketEntry: found };
  }
  return null;
}

function findJobItem(jobId) {
  if (!jobId || !state.snapshot) return null;
  for (const entry of state.snapshot.tasks || []) {
    for (const ticketItem of entry.tickets || []) {
      const found = (ticketItem.jobs || []).find(job => job.record.id === jobId);
      if (found) return { taskEntry: entry, ticketEntry: ticketItem, job: found };
    }
  }
  return null;
}

function allProjectTickets() {
  return (state.snapshot?.tasks || []).flatMap(entry =>
    (entry.tickets || []).map(item => ({ taskEntry: entry, ticketEntry: item })),
  );
}

function nonTerminalTasks() {
  return (state.snapshot?.tasks || []).filter(entry => !terminal(entry.task));
}

function lines(value) {
  return String(value || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function parseDeadlineInput(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  // Already has timezone Z or +HH:MM / -HH:MM
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(trimmed)) return trimmed.replace(" ", "T");
  // Convert YYYY-MM-DD HH:MM(:SS) or datetime-local using active timeZone preference
  const normalized = trimmed.replace(" ", "T");
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized) ? `${normalized}:00` : normalized;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(withSeconds)) {
    if (state.timeZone === "UTC") return `${withSeconds}Z`;
    if (state.timeZone === "JST") return `${withSeconds}+09:00`;
    const offset = -new Date().getTimezoneOffset();
    const sign = offset < 0 ? "-" : "+";
    const abs = Math.abs(offset);
    const pad = n => String(n).padStart(2, "0");
    return `${withSeconds}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  }
  return trimmed;
}

function formatRefsForTextarea(refs = []) {
  return (refs || []).map(ref => {
    const parts = [ref.ticket_id];
    if (ref.kind || ref.note) parts.push(ref.kind || "");
    if (ref.note) parts.push(ref.note);
    return parts.join(" | ");
  }).join("\n");
}

function requireText(value, label) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    throw new Error(`${label}を入力してください。`);
  }
  return trimmed;
}

function requireLines(value, label) {
  const items = lines(value);
  if (!items.length) {
    throw new Error(`${label}を1件以上入力してください。`);
  }
  return items;
}

function parseRefsTextarea(raw) {
  return lines(raw).map(line => {
    const parts = line.split("|").map(part => part.trim());
    if (!parts[0]) {
      throw new Error("関連参照（refs）の各行の先頭には tkt-... ID を入力してください。");
    }
    const ref = { ticket_id: parts[0] };
    if (parts[1]) ref.kind = parts[1];
    if (parts[2]) ref.note = parts[2];
    return ref;
  });
}

async function loadPeople() {
  const [workers, sessions] = await Promise.all([api("worker.list"), api("session.list")]);
  state.workers = workers.items;
  state.sessions = sessions.items;
}

async function loadProjects(selectId, routeSelection = null, historyMode = "replace") {
  state.projects = (await api("project.list")).items;
  const requested = selectId || state.projectId;
  const id = state.projects.some(project => project.record.id === requested)
    ? requested
    : state.projects[0]?.record.id || null;
  if (id) {
    await selectProject(id, routeSelection, historyMode);
  } else {
    state.projectId = null;
    state.taskId = null;
    state.ticketId = null;
    state.snapshot = null;
    state.detail = null;
    state.knowledgeCache.clear();
    state.filters = { workOnly: false, statuses: [], iconKeys: [], workerId: "", query: "" };
    closeDetailModal({ sync: false });
    syncUrl(historyMode);
    render();
  }
}

async function selectProject(id, selection = null, historyMode = "push") {
  generation++;
  watchAbort?.abort();
  if (state.projectId !== id) {
    canvasView.projectId = id;
    canvasView.initialized = false;
    canvasView.userControlled = false;
    state.knowledgeCache.clear();
    closeDetailModal({ sync: false });
    if (panelState.open && (panelState.mode === "knowledge" || panelState.mode === "knowledge-detail")) {
      panelState.mode = "knowledge";
      panelState.knowledgeId = null;
      panelState.knowledgeFallback = null;
      panelState.knowledgeLoading = false;
    }
  }
  state.projectId = id;
  state.filters.workOnly = loadWorkOnly(id);
  state.taskId = selection ? selection.taskId : null;
  state.ticketId = selection ? selection.ticketId : null;
  state.detail = null;
  state.snapshot = null;
  const epoch = generation;
  const cursor = await refresh(epoch, historyMode);
  if (epoch === generation) watch(epoch, cursor);
}

async function refresh(epoch = generation, historyMode = "replace") {
  if (!state.projectId) {
    syncUrl(historyMode);
    render();
    return 0;
  }
  const snapshot = await api("project.snapshot", { id: state.projectId });
  if (epoch !== generation) return snapshot.cursor;
  if (state.snapshot && snapshot.cursor < state.snapshot.cursor) return state.snapshot.cursor;
  state.snapshot = snapshot;
  state.projects = state.projects.map(project => project.record.id === state.projectId ? snapshot.project : project);

  if (state.ticketId && !findTicketItem(state.ticketId)) {
    state.ticketId = null;
    state.detail = null;
  }
  if (state.ticketId) {
    const owner = findTicketItem(state.ticketId);
    if (owner) state.taskId = owner.taskEntry.task.record.id;
  } else if (state.taskId && !findTaskEntry(state.taskId)) {
    state.taskId = snapshot.tasks[0]?.task.record.id || null;
  }

  const activeTicketId = modalState.open && modalState.ticketId
    ? modalState.ticketId
    : state.ticketId;

  if (activeTicketId && findTicketItem(activeTicketId)) {
    const detail = await api("ticket.snapshot", { id: activeTicketId });
    if (epoch !== generation) return snapshot.cursor;
    if (!state.detail || state.detail.ticket?.record?.id !== activeTicketId || detail.cursor >= state.detail.cursor) {
      state.detail = detail;
    }
  } else {
    state.detail = null;
  }

  syncUrl(historyMode);
  render();
  return snapshot.cursor;
}

async function fetchTicketDetail(ticketId) {
  if (!ticketId) return null;
  const epoch = generation;
  const detail = await api("ticket.snapshot", { id: ticketId });
  if (epoch !== generation) return null;
  if (modalState.ticketId === ticketId || state.ticketId === ticketId) {
    state.detail = detail;
    if (modalState.open) renderDetailModal();
    if (state.view === "kanban") renderKanban();
  }
  return detail;
}

function switchView(view, historyMode = "push") {
  if (!Object.hasOwn(VIEWS, view)) return;
  state.view = view;
  syncUrl(historyMode);
  render();
}

async function watch(epoch, cursor) {
  if (getBridge()?.disableWatch) return;
  watchAbort = new AbortController();
  const controller = watchAbort;
  while (epoch === generation) {
    try {
      const events = await api("events.wait", { project: state.projectId, cursor }, controller.signal);
      cursor = events.cursor;
      if (events.events.length) await refresh(epoch, "replace");
    } catch (error) {
      if (error.name === "AbortError" || epoch !== generation) break;
      connected(false);
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
}

async function perform(method, params, ticketIdOverride = null) {
  if (["run.start", "run.finish", "run.progress"].includes(method)) {
    const tid = ticketIdOverride || modalState.ticketId || state.ticketId;
    params = { ...params, ticket_id: tid };
  }
  const result = await api(method, params);
  clearError();
  await refresh(generation, "replace");
  return result;
}

const hscrollUpdaters = [];

function refreshHScrollBars() {
  for (const update of hscrollUpdaters) {
    try {
      update();
    } catch {
      // Ignore layout measurement errors
    }
  }
}

function initHScrollBars() {
  for (const wrap of document.querySelectorAll("[data-hscroll]")) {
    const track = wrap.querySelector("[data-hscroll-track]");
    const prevBtn = wrap.querySelector('[data-hscroll-dir="-1"]');
    const nextBtn = wrap.querySelector('[data-hscroll-dir="1"]');
    if (!track || !prevBtn || !nextBtn) continue;

    const update = () => {
      const btnSpace = (prevBtn.hidden ? 0 : prevBtn.offsetWidth + 2)
        + (nextBtn.hidden ? 0 : nextBtn.offsetWidth + 2);
      const naturalClient = track.clientWidth + btnSpace;
      const overflowing = track.scrollWidth > naturalClient + 1;
      prevBtn.hidden = !overflowing;
      nextBtn.hidden = !overflowing;
      wrap.classList.toggle("is-overflowing", overflowing);
      if (!overflowing) {
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        return;
      }
      const left = track.scrollLeft;
      const maxLeft = Math.max(0, track.scrollWidth - track.clientWidth);
      prevBtn.disabled = left <= 1;
      nextBtn.disabled = left >= maxLeft - 1;
    };

    const scrollStep = dir => {
      const step = Math.max(120, Math.round(track.clientWidth * 0.65));
      if (typeof track.scrollBy === "function") {
        track.scrollBy({ left: dir * step, behavior: "smooth" });
      } else {
        track.scrollLeft += dir * step;
      }
      requestAnimationFrame(update);
      setTimeout(update, 260);
    };

    prevBtn.addEventListener("click", () => scrollStep(-1));
    nextBtn.addEventListener("click", () => scrollStep(1));
    track.addEventListener("scroll", update, { passive: true });

    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(update);
      ro.observe(wrap);
      ro.observe(track);
    }
    if (typeof MutationObserver === "function") {
      const mo = new MutationObserver(() => requestAnimationFrame(update));
      mo.observe(track, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "style", "class"] });
    }

    hscrollUpdaters.push(update);
    requestAnimationFrame(update);
  }
}

/* ================================
   Header & Navigation Rendering
   ================================ */
function renderProjects() {
  const nav = $("projects");
  if (!state.projects.length) {
    nav.replaceChildren(node("span", "project-empty-hint", "＋からProjectを作成"));
    refreshHScrollBars();
    return;
  }
  nav.replaceChildren(...state.projects.map(project => {
    const isActive = project.record.id === state.projectId;
    const button = node("button", "project-tab" + (isActive ? " active" : ""));
    button.type = "button";
    button.title = project.record.name;
    button.setAttribute("aria-current", isActive ? "true" : "false");
    button.append(
      svgIcon("/icons/folder.svg", "sm project-tab-icon"),
      node("span", "project-tab-name", project.record.name),
    );
    button.onclick = () => selectProject(project.record.id, null, "push").catch(showError);
    return button;
  }));
  refreshHScrollBars();
}

function syncTreeDirectionControl() {
  const btn = $("tree-dir-toggle");
  const icon = $("tree-dir-icon");
  const label = $("tree-dir-label");
  if (!btn) return;
  const isVertical = state.treeDirection === "vertical";
  btn.dataset.direction = state.treeDirection;
  btn.setAttribute("aria-pressed", String(isVertical));
  const title = isVertical
    ? "ツリー方向: 縦（上→下）· クリックで横（左→右）に切替"
    : "ツリー方向: 横（左→右）· クリックで縦（上→下）に切替";
  btn.title = title;
  btn.setAttribute("aria-label", title);
  if (label) {
    label.textContent = isVertical ? "縦 ↓" : "横 →";
  }
  if (icon) {
    icon.innerHTML = isVertical
      ? '<rect x="5.5" y="1.5" width="5" height="4" rx="1"/><rect x="2" y="10.5" width="4" height="4" rx="1"/><rect x="10" y="10.5" width="4" height="4" rx="1"/><path d="M8 5.5v2.75M4 8.25h8M4 8.25v2.25M12 8.25v2.25"/>'
      : '<rect x="1.5" y="5.5" width="4" height="5" rx="1"/><rect x="10.5" y="2" width="4" height="4" rx="1"/><rect x="10.5" y="10" width="4" height="4" rx="1"/><path d="M5.5 8h2.75M8.25 4v8M8.25 4h2.25M8.25 12h2.25"/>';
  }
}

function setTreeDirection(nextDir, { persist = true, historyMode = "push", refit = true } = {}) {
  const normalized = normalizeTreeDirection(nextDir, defaultTreeDirection());
  state.treeDirection = normalized;
  state.treeDirectionExplicit = true;
  if (persist) saveTreeDirection(normalized);
  if (refit) {
    canvasView.initialized = false;
    canvasView.userControlled = false;
  }
  syncUrl(historyMode);
  render();
}

function renderHeaderState() {
  for (const link of $("view-tabs").querySelectorAll("[data-view]")) {
    const view = link.dataset.view;
    link.href = routeUrl({
      view,
      ...(view === "tree" || state.treeDirectionExplicit ? { dir: state.treeDirection } : {}),
      projectId: state.projectId,
      taskId: state.taskId,
      ticketId: state.ticketId,
    });
    if (view === state.view) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
    link.onclick = event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      switchView(view, "push");
    };
  }

  const hasProject = Boolean(state.projectId);
  const readOnly = isReadOnly();
  const isTree = state.view === "tree" && hasProject;
  $("header-canvas-controls").hidden = !isTree;
  $("canvas-legend").hidden = !isTree || !(state.snapshot?.tasks?.length);
  syncTreeDirectionControl();
  $("new-project").disabled = readOnly;
  $("new-project").title = readOnly ? READ_ONLY_TIP : "Projectを作成";
  const welcomeCreate = $("welcome-create");
  if (welcomeCreate) {
    welcomeCreate.disabled = readOnly;
    welcomeCreate.title = readOnly ? READ_ONLY_TIP : "Projectを作成";
  }
  $("new-task").disabled = !hasProject || readOnly;
  $("new-task").title = readOnly ? READ_ONLY_TIP : "Taskを追加";
  $("open-knowledge").disabled = !hasProject;
  $("new-ticket").disabled = !hasProject || nonTerminalTasks().length === 0 || readOnly;
  $("new-ticket").title = readOnly ? READ_ONLY_TIP : "Ticketを追加";
  syncFilterControls();
  refreshHScrollBars();
}

/* ================================
   Tree View (2x Supersampled Canvas + Crisp Zoom)
   ================================ */
const CANVAS_SUPERSAMPLE = 2;
const SUPPORTS_CSS_ZOOM = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("zoom", "1.5");

function cleanupCanvasController() {
  if (canvasController?.destroy) {
    try {
      canvasController.destroy();
    } catch {
      // Ignore cleanup errors
    }
  }
  canvasController = null;
}

function clampScale(value) {
  return Math.min(CANVAS_MAX_SCALE, Math.max(CANVAS_MIN_SCALE, value));
}

function drawTreeSceneCanvas(canvas, viewport, scene, tx, ty, scale) {
  const vw = Math.max(1, viewport.clientWidth || 720);
  const vh = Math.max(1, viewport.clientHeight || 480);
  const dpr = Math.max(window.devicePixelRatio || 1, 1);
  const renderScale = dpr * CANVAS_SUPERSAMPLE;
  const targetW = Math.max(1, Math.round(vw * renderScale));
  const targetH = Math.max(1, Math.round(vh * renderScale));

  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  canvas.dataset.supersample = String(CANVAS_SUPERSAMPLE);
  canvas.dataset.renderScale = String(renderScale);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  ctx.clearRect(0, 0, vw, vh);

  const styles = getComputedStyle(viewport);
  const bgColor = (styles.getPropertyValue("--bg") || "").trim() || "#f3f6f3";
  const dotColor = (styles.getPropertyValue("--canvas-dot") || "").trim() || "#c9d5ca";
  const edgeColor = (styles.getPropertyValue("--edge-main") || "").trim() || "#6a7a6d";

  // 1. Crisp pan/zoom-synchronized dot grid at 2x DPR
  let gridStep = 18 * scale;
  while (gridStep < 9) gridStep *= 2;
  const startX = ((tx % gridStep) + gridStep) % gridStep;
  const startY = ((ty % gridStep) + gridStep) % gridStep;
  const dotRadius = Math.max(0.85, Math.min(1.4, 0.95 * Math.sqrt(scale)));
  ctx.fillStyle = dotColor;
  ctx.beginPath();
  for (let x = startX; x <= vw + dotRadius; x += gridStep) {
    for (let y = startY; y <= vh + dotRadius; y += gridStep) {
      ctx.moveTo(x + dotRadius, y);
      ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
    }
  }
  ctx.fill();

  // 2. Scene edges, semicircular bridges, open chevron arrowheads, and junction dots at 2x DPR
  ctx.save();
  ctx.translate(tx, ty);
  ctx.scale(scale, scale);

  ctx.strokeStyle = edgeColor;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const edge of scene.edges) {
    const pts = edge.points || [];
    if (pts.length < 2) continue;

    // Trim shaft tip by 0.6px so rounded lineCap nests cleanly inside the open chevron apex
    const [prevX, prevY] = pts[pts.length - 2];
    const [endX, endY] = pts[pts.length - 1];
    const edx = endX - prevX;
    const edy = endY - prevY;
    const elen = Math.hypot(edx, edy);
    const ux = elen > 0 ? edx / elen : 1;
    const uy = elen > 0 ? edy / elen : 0;
    const tipX = elen > 0.6 ? endX - ux * 0.6 : endX;
    const tipY = elen > 0.6 ? endY - uy * 0.6 : endY;

    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const bx = i === pts.length - 1 ? tipX : pts[i][0];
      const by = i === pts.length - 1 ? tipY : pts[i][1];
      if (ay === by && ax !== bx) {
        const left = Math.min(ax, bx);
        const right = Math.max(ax, bx);
        const matching = scene.bridges.filter(b =>
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
              ctx.lineTo(b.x - r, ay);
              ctx.arc(b.x, ay, r, Math.PI, 0, false);
            } else {
              ctx.lineTo(b.x + r, ay);
              ctx.arc(b.x, ay, r, 0, Math.PI, true);
            }
          }
        }
      }
      ctx.lineTo(bx, by);
    }
    ctx.stroke();

    // Open chevron arrowhead (points right in horizontal, down in vertical)
    if (elen > 0) {
      const wingLen = 5.2;
      const wingHalf = 4.4;
      const w1x = tipX - ux * wingLen - uy * wingHalf;
      const w1y = tipY - uy * wingLen + ux * wingHalf;
      const w2x = tipX - ux * wingLen + uy * wingHalf;
      const w2y = tipY - uy * wingLen - ux * wingHalf;
      ctx.beginPath();
      ctx.moveTo(w1x, w1y);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(w2x, w2y);
      ctx.stroke();
    }
  }

  // Semicircular non-connecting crossing bridges (casing + crisp top arc)
  for (const bridge of scene.bridges) {
    const r = bridge.radius;
    ctx.beginPath();
    ctx.arc(bridge.x, bridge.y, r, Math.PI, 0, false);
    ctx.strokeStyle = bgColor;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(bridge.x, bridge.y, r, Math.PI, 0, false);
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = 1.7;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  // Branch & merge junction dots
  for (const junction of scene.junctions) {
    ctx.beginPath();
    ctx.arc(junction.x, junction.y, 4.2, 0, Math.PI * 2);
    ctx.fillStyle = edgeColor;
    ctx.fill();
    ctx.strokeStyle = bgColor;
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }

  ctx.restore();
}

function applyCanvasTransform(panLayer, stage, drawCanvas) {
  const tx = Math.round(canvasView.x);
  const ty = Math.round(canvasView.y);
  const scale = Number(canvasView.scale.toFixed(4));
  if (SUPPORTS_CSS_ZOOM) {
    panLayer.style.left = `${tx}px`;
    panLayer.style.top = `${ty}px`;
    stage.style.zoom = String(scale);
    stage.style.transform = "";
  } else {
    panLayer.style.left = "0px";
    panLayer.style.top = "0px";
    stage.style.zoom = "";
    stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  }
  stage.dataset.tx = String(tx);
  stage.dataset.ty = String(ty);
  stage.dataset.scale = String(Number(scale.toFixed(3)));
  $("zoom-label").textContent = `${Math.round(scale * 100)}%`;
  if (typeof drawCanvas === "function") drawCanvas(tx, ty, scale);
}

function computeFitTransform(viewport, scene) {
  const vw = viewport.clientWidth || 720;
  const vh = viewport.clientHeight || 480;
  const pad = vw < 520 ? 12 : 24;
  const usableW = Math.max(120, vw - pad * 2);
  const usableH = Math.max(120, vh - pad * 2);
  const fitScale = clampScale(Math.min(1, usableW / Math.max(1, scene.width), usableH / Math.max(1, scene.height)));
  const scaledW = scene.width * fitScale;
  const scaledH = scene.height * fitScale;
  const x = scaledW < vw ? Math.round((vw - scaledW) / 2) : pad;
  const y = scaledH < vh ? Math.round((vh - scaledH) / 2) : pad;
  return { scale: fitScale, x, y };
}

function computeInitialTransform(viewport, scene) {
  const fitted = computeFitTransform(viewport, scene);
  if (fitted.scale >= 0.75) return fitted;
  const vw = viewport.clientWidth || 720;
  const pad = vw < 520 ? 12 : 20;
  const scale = vw < 460
    ? Math.min(0.92, Math.max(0.75, (vw - pad * 2) / (scene.metrics.cardWidth + 32)))
    : 0.85;
  const clamped = clampScale(scale);
  const scaledW = scene.width * clamped;
  const x = scene.direction === "vertical" && scaledW < vw
    ? Math.round((vw - scaledW) / 2)
    : pad;
  return { scale: clamped, x, y: pad };
}

function renderTree() {
  cleanupCanvasController();
  const scene = treeScene(state.snapshot, { ...currentFilterOptions(), direction: state.treeDirection });

  if (!scene.nodes.length) {
    const wrap = node("div", "empty-overview");
    const msg = state.snapshot?.tasks?.length
      ? "表示条件に一致するTask・Ticketはありません。"
      : "上部のTask追加ボタンから最初のTaskを作成してください。";
    wrap.append(node("p", "", msg));
    if (state.snapshot?.tasks?.length && hasActiveFilters(state.filters)) {
      const reset = node("button", "btn secondary sm", "フィルタをリセット");
      reset.type = "button";
      reset.onclick = resetFilters;
      wrap.append(reset);
    }
    $("view-content").replaceChildren(wrap);
    return;
  }

  if (canvasView.projectId !== state.projectId) {
    canvasView.projectId = state.projectId;
    canvasView.initialized = false;
    canvasView.userControlled = false;
  }

  const viewport = node("div", "tree-viewport");
  viewport.tabIndex = 0;
  viewport.dataset.direction = scene.direction;
  viewport.setAttribute("aria-label", "作業ツリー（ドラッグで移動、ホイールまたはボタンで拡大縮小）");

  const canvas = document.createElement("canvas");
  canvas.className = "tree-canvas";
  canvas.setAttribute("aria-hidden", "true");

  const panLayer = node("div", "tree-pan-layer");
  const stage = node("div", "tree-stage");
  stage.style.width = scene.width + "px";
  stage.style.height = scene.height + "px";
  stage.dataset.direction = scene.direction;
  panLayer.append(stage);

  for (const item of scene.nodes) {
    const isTask = item.kind === "task";
    const record = item.row.record;
    const isSelected = isTask
      ? item.taskId === state.taskId && !state.ticketId
      : item.ticketId === state.ticketId;

    const card = node(
      "div",
      `tree-node ${isTask ? "is-task" : "is-ticket"}${isSelected ? " selected" : ""}`,
    );
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.style.left = item.x + "px";
    card.style.top = item.y + "px";
    card.style.width = item.width + "px";
    card.style.height = item.height + "px";
    card.dataset.nodeId = record.id;
    card.dataset.kind = item.kind;

    const top = node("div", "card-top");
    const topLeft = node("div", "card-top-left");
    topLeft.append(statusBadge(record.status), node("span", "card-kind", isTask ? "Task" : "Ticket"));
    top.append(topLeft, copyIdButton(record.id));

    const title = node("h3", "card-title", record.objective);
    title.title = record.objective;

    let summaryText = item.row.display?.summary || "";
    if (!summaryText) {
      if (isTask) {
        const criteriaCount = (record.criteria || []).length;
        summaryText = `達成条件 ${criteriaCount}件 · Ticket ${item.ticketCount}件`;
      } else {
        const person = workerName(record.worker_id);
        const done = item.jobs.filter(job => job.record.status === "completed").length;
        const depNote = item.dependsTitles?.length ? ` · 先行 ${item.dependsTitles.length}件` : "";
        summaryText = `${person} · ${done}/${item.jobs.length} Job${depNote}`;
      }
    }
    const summaryEl = node("p", "card-summary", summaryText);
    summaryEl.title = summaryText;

    const bottom = node("div", "card-bottom");
    if (isTask) {
      bottom.append(node("span", "card-task-foot", `Ticket ${item.ticketCount}件`));
    } else {
      const icons = node("div", "job-icon-row");
      for (const job of visibleJobs(item.jobs)) {
        icons.append(createJobDot(job, {
          interactive: true,
          onClick: clickedJob => openJobDetail(item.taskId, item.ticketId, clickedJob.record.id),
        }));
      }
      bottom.append(icons);
    }

    card.append(top, title, summaryEl, bottom);

    const openCard = () => {
      if (isTask) openTaskDetail(item.taskId);
      else openTicketDetail(item.taskId, item.ticketId);
    };
    card.addEventListener("click", openCard);
    card.addEventListener("keydown", event => {
      if (event.target !== card) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openCard();
      }
    });

    stage.append(card);
  }

  const hint = node("div", "canvas-hint", "ドラッグで移動 · ホイールで拡大縮小 · カードをクリックで詳細");
  viewport.append(canvas, panLayer, hint);
  $("view-content").replaceChildren(viewport);

  const redrawCanvas = (tx = Math.round(canvasView.x), ty = Math.round(canvasView.y), scale = Number(canvasView.scale.toFixed(4))) => {
    drawTreeSceneCanvas(canvas, viewport, scene, tx, ty, scale);
  };

  const applyTransform = () => applyCanvasTransform(panLayer, stage, redrawCanvas);

  let resizeObserver = null;
  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(() => {
      redrawCanvas();
    });
    resizeObserver.observe(viewport);
  }

  const zoomAt = (nextScale, focalX, focalY) => {
    const clamped = clampScale(nextScale);
    const wx = (focalX - canvasView.x) / canvasView.scale;
    const wy = (focalY - canvasView.y) / canvasView.scale;
    canvasView.scale = clamped;
    canvasView.x = focalX - wx * clamped;
    canvasView.y = focalY - wy * clamped;
    canvasView.userControlled = true;
    applyTransform();
  };

  const fitToViewport = () => {
    const fitted = computeFitTransform(viewport, scene);
    canvasView.scale = fitted.scale;
    canvasView.x = fitted.x;
    canvasView.y = fitted.y;
    applyTransform();
  };

  const resetToOneHundred = () => {
    canvasView.scale = 1;
    const vw = viewport.clientWidth || 720;
    const vh = viewport.clientHeight || 480;
    canvasView.x = scene.width < vw ? Math.round((vw - scene.width) / 2) : 16;
    canvasView.y = scene.height < vh ? Math.round((vh - scene.height) / 2) : 16;
    canvasView.userControlled = true;
    applyTransform();
  };

  canvasController = {
    zoomIn: () => zoomAt(canvasView.scale * CANVAS_ZOOM_STEP, viewport.clientWidth / 2, viewport.clientHeight / 2),
    zoomOut: () => zoomAt(canvasView.scale / CANVAS_ZOOM_STEP, viewport.clientWidth / 2, viewport.clientHeight / 2),
    fit: () => {
      canvasView.userControlled = false;
      fitToViewport();
    },
    reset: resetToOneHundred,
    redraw: () => redrawCanvas(),
    destroy: () => {
      resizeObserver?.disconnect();
      resizeObserver = null;
    },
  };

  let drag = null;
  let pinch = null;
  const activePointers = new Map();
  let suppressNextClick = false;

  const beginPinch = () => {
    const pts = [...activePointers.values()];
    if (pts.length < 2) return;
    const [p1, p2] = pts;
    const rect = viewport.getBoundingClientRect();
    const midX = (p1.x + p2.x) / 2 - rect.left;
    const midY = (p1.y + p2.y) / 2 - rect.top;
    const dist = Math.max(10, Math.hypot(p2.x - p1.x, p2.y - p1.y));
    pinch = {
      startDist: dist,
      startScale: canvasView.scale,
      worldX: (midX - canvasView.x) / canvasView.scale,
      worldY: (midY - canvasView.y) / canvasView.scale,
    };
    if (drag?.captured) {
      try { viewport.releasePointerCapture(drag.pointerId); } catch { /* Ignore */ }
    }
    drag = null;
    viewport.classList.add("is-panning");
  };

  const onPointerMove = event => {
    if (activePointers.has(event.pointerId)) {
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pinch && activePointers.size >= 2) {
      const [p1, p2] = [...activePointers.values()];
      const rect = viewport.getBoundingClientRect();
      const midX = (p1.x + p2.x) / 2 - rect.left;
      const midY = (p1.y + p2.y) / 2 - rect.top;
      const dist = Math.max(10, Math.hypot(p2.x - p1.x, p2.y - p1.y));
      const nextScale = clampScale(pinch.startScale * (dist / pinch.startDist));
      canvasView.scale = nextScale;
      canvasView.x = midX - pinch.worldX * nextScale;
      canvasView.y = midY - pinch.worldY * nextScale;
      canvasView.userControlled = true;
      applyTransform();
      return;
    }
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
      drag.moved = true;
      viewport.classList.add("is-panning");
      try {
        viewport.setPointerCapture(event.pointerId);
        drag.captured = true;
      } catch {
        // Ignore
      }
    }
    if (drag.moved) {
      canvasView.x = drag.origX + dx;
      canvasView.y = drag.origY + dy;
      canvasView.userControlled = true;
      applyTransform();
    }
  };

  const finishDrag = event => {
    const hadPinch = Boolean(pinch);
    activePointers.delete(event.pointerId);

    if (pinch) {
      if (activePointers.size >= 2) {
        beginPinch();
        return;
      }
      pinch = null;
      if (activePointers.size === 1) {
        const [[remId, remPt]] = [...activePointers.entries()];
        drag = {
          pointerId: remId,
          startX: remPt.x,
          startY: remPt.y,
          origX: canvasView.x,
          origY: canvasView.y,
          moved: true,
          captured: false,
        };
        return;
      }
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
      viewport.classList.remove("is-panning");
      if (hadPinch) {
        suppressNextClick = true;
        setTimeout(() => { suppressNextClick = false; }, 0);
      }
      return;
    }

    if (!drag || event.pointerId !== drag.pointerId) return;
    const wasMoved = drag.moved;
    if (drag.captured) {
      try {
        viewport.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore
      }
    }
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", finishDrag);
    window.removeEventListener("pointercancel", finishDrag);
    drag = null;
    viewport.classList.remove("is-panning");
    if (wasMoved) {
      suppressNextClick = true;
      setTimeout(() => { suppressNextClick = false; }, 0);
    }
  };

  viewport.addEventListener("pointerdown", event => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const wasEmpty = activePointers.size === 0;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (wasEmpty) {
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", finishDrag);
      window.addEventListener("pointercancel", finishDrag);
    }
    if (activePointers.size >= 2) {
      beginPinch();
      return;
    }
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origX: canvasView.x,
      origY: canvasView.y,
      moved: false,
      captured: false,
    };
  });

  viewport.addEventListener("click", event => {
    if (!suppressNextClick) return;
    event.preventDefault();
    event.stopPropagation();
    suppressNextClick = false;
  }, true);

  viewport.addEventListener("wheel", event => {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const focalX = event.clientX - rect.left;
    const focalY = event.clientY - rect.top;
    const factor = event.ctrlKey
      ? Math.exp(-event.deltaY * 0.008)
      : event.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomAt(canvasView.scale * factor, focalX, focalY);
  }, { passive: false });

  if (!canvasView.initialized) {
    const init = computeInitialTransform(viewport, scene);
    canvasView.scale = init.scale;
    canvasView.x = init.x;
    canvasView.y = init.y;
    canvasView.initialized = true;
  }
  applyTransform();
}

/* ================================
   Kanban View
   ================================ */
function renderKanban() {
  cleanupCanvasController();
  const columns = kanbanColumns(state.snapshot, state.detail, currentFilterOptions());

  if (!state.snapshot?.tasks?.length) {
    $("view-content").replaceChildren(node("p", "empty-overview", "まだTask・Ticketがありません。上部のTask追加ボタンから作成しましょう。"));
    return;
  }

  const board = node("div", "kanban-board");
  for (const column of columns) {
    const isCollapsed = Boolean(column.collapsible && kanbanCollapsed[column.key]);
    const section = node("section", `kanban-column status-${column.key}${isCollapsed ? " is-collapsed" : ""}`);
    section.dataset.kanbanColumn = column.key;

    const header = node("header", "kanban-column-header");
    const titleGroup = node("div", "kanban-column-title");
    titleGroup.append(
      node("span", `kanban-dot status-${column.key}`),
      node("h3", "", column.label),
      node("span", "kanban-count", String(column.cards.length)),
    );
    header.append(titleGroup);

    if (column.collapsible) {
      const toggle = node("button", "kanban-toggle", isCollapsed ? "展開" : "折りたたむ");
      toggle.type = "button";
      toggle.setAttribute("aria-expanded", String(!isCollapsed));
      toggle.onclick = () => {
        kanbanCollapsed[column.key] = !kanbanCollapsed[column.key];
        renderKanban();
      };
      header.append(toggle);
    }

    section.append(header);

    if (!isCollapsed) {
      const list = node("div", "kanban-cards");
      if (!column.cards.length) {
        list.append(node("p", "kanban-empty", "該当するTicketはありません"));
      } else {
        for (const card of column.cards) {
          const isSelected = card.ticketId === state.ticketId;
          const el = node("div", "kanban-card" + (isSelected ? " selected" : ""));
          el.setAttribute("role", "button");
          el.tabIndex = 0;
          el.dataset.ticketId = card.ticketId;

          const top = node("div", "card-top");
          const topLeft = node("div", "card-top-left");
          const taskPill = node("span", "kanban-task-pill", card.taskObjective);
          taskPill.title = card.taskObjective;
          topLeft.append(statusBadge(card.status), taskPill);
          top.append(topLeft, copyIdButton(card.ticketId));

          const title = node("h4", "card-title", card.objective);
          title.title = card.objective;

          const midSlot = node("div", "kanban-mid-slot");
          if (card.progress) {
            const hasPercent = card.progress.percent !== undefined && card.progress.percent !== null;
            const progRow = node("div", "kanban-progress-row");
            progRow.append(
              node("span", "", card.progress.message || "Run実行中"),
              node("strong", "", hasPercent ? `${card.progress.percent}%` : "実行中"),
            );
            midSlot.append(progRow);
            const bar = node("div", "kanban-progress-bar");
            const fill = node("span", "kanban-progress-fill");
            fill.style.width = `${hasPercent ? Math.max(0, Math.min(100, Number(card.progress.percent))) : 35}%`;
            bar.append(fill);
            midSlot.append(bar);
          } else {
            const person = workerName(card.workerId);
            const depNote = card.hasDependencies ? ` · 先行 ${card.dependsIds.length}件` : "";
            const metaText = card.summary || `${person}${depNote}`;
            const metaLine = node("div", "kanban-meta-line", metaText);
            metaLine.title = metaText;
            midSlot.append(metaLine);
          }

          const bottom = node("div", "kanban-card-bottom");
          const icons = node("div", "job-icon-row");
          for (const job of visibleJobs(card.jobs)) {
            icons.append(createJobDot(job, {
              interactive: true,
              onClick: clickedJob => openJobDetail(card.taskId, card.ticketId, clickedJob.record.id),
            }));
          }
          bottom.append(icons, node("span", "kanban-job-count", `${card.jobsCompleted}/${card.jobsTotal}`));

          el.append(top, title, midSlot, bottom);
          el.addEventListener("click", () => openTicketDetail(card.taskId, card.ticketId));
          el.addEventListener("keydown", event => {
            if (event.target !== el) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openTicketDetail(card.taskId, card.ticketId);
            }
          });
          list.append(el);
        }
      }
      section.append(list);
    }

    board.append(section);
  }

  $("view-content").replaceChildren(board);
}

/* ================================
   List View
   ================================ */
function renderList() {
  cleanupCanvasController();
  const allRows = workRows(state.snapshot, currentFilterOptions());
  const rows = state.listFilter === "all"
    ? allRows
    : allRows.filter(item => item.kind === state.listFilter);

  const shell = node("div", "list-shell");
  const subbar = node("div", "list-subbar");
  for (const [key, label] of [["all", "すべて"], ["task", "Task"], ["ticket", "Ticket"]]) {
    const tab = node("button", "sub-tab" + (state.listFilter === key ? " active" : ""), label);
    tab.type = "button";
    tab.onclick = () => {
      state.listFilter = key;
      renderList();
    };
    subbar.append(tab);
  }
  shell.append(subbar);

  const scroll = node("div", "list-scroll");
  if (!rows.length) {
    const empty = node("div", "empty-overview");
    empty.append(node("p", "", "表示条件に一致するTask・Ticketはありません。"));
    if (hasActiveFilters(state.filters)) {
      const reset = node("button", "btn secondary sm", "フィルタをリセット");
      reset.type = "button";
      reset.onclick = resetFilters;
      empty.append(reset);
    }
    scroll.append(empty);
  } else {
    const compactList = isOrcaPanelMode() || window.innerWidth <= 480;
    const maxListJobs = compactList ? 4 : 8;
    for (const item of rows) {
      const isTask = item.kind === "task";
      const record = item.row.record;
      const rowEl = node("div", `list-row ${isTask ? "is-task" : "is-ticket"}`);
      rowEl.setAttribute("role", "button");
      rowEl.tabIndex = 0;
      rowEl.dataset.kind = item.kind;
      rowEl.dataset.rowId = record.id;

      const head = node("div", "list-row-head");
      const titleEl = node("div", "list-row-title", record.objective);
      titleEl.title = record.objective;
      const actions = node("div", "list-row-actions");
      actions.append(copyIdButton(record.id), node("span", "row-chevron", "›"));
      head.append(statusBadge(record.status), titleEl, actions);

      const foot = node("div", "list-row-foot");
      let sub = "";
      if (isTask) {
        sub = `Task · 達成条件 ${(record.criteria || []).length}件 · Ticket ${item.ticketCount}件`;
      } else {
        const done = item.jobs.filter(job => job.record.status === "completed").length;
        sub = `Ticket · ${workerName(record.worker_id)} · ${done}/${item.jobs.length} Job`;
      }
      const subEl = node("div", "list-row-sub", sub);
      subEl.title = sub;

      const jobsSlot = node("div", "list-row-jobs");
      if (!isTask && item.jobs.length) {
        const allVisible = visibleJobs(item.jobs);
        const shown = allVisible.slice(0, maxListJobs);
        const hiddenCount = Math.max(0, item.jobs.length - shown.length);
        const icons = node("div", "job-icon-row");
        for (const job of shown) {
          icons.append(createJobDot(job, {
            interactive: true,
            onClick: clickedJob => openJobDetail(item.taskId, item.ticketId, clickedJob.record.id),
          }));
        }
        jobsSlot.append(icons);
        if (hiddenCount > 0) {
          const more = node("span", "job-more-badge", `+${hiddenCount}`);
          more.title = `他 ${hiddenCount} 件の Job`;
          jobsSlot.append(more);
        }
      }
      foot.append(subEl, jobsSlot);

      rowEl.append(head, foot);
      const activate = () => {
        if (isTask) openTaskDetail(item.taskId);
        else openTicketDetail(item.taskId, item.ticketId);
      };
      rowEl.addEventListener("click", activate);
      rowEl.addEventListener("keydown", event => {
        if (event.target !== rowEl) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      });
      scroll.append(rowEl);
    }
  }
  shell.append(scroll);
  $("view-content").replaceChildren(shell);
}

/* ================================
   Timeline View
   ================================ */
function renderTimeline() {
  cleanupCanvasController();
  const allEvents = timelineRows(state.snapshot, { timeZone: state.timeZone });
  const filtering = hasActiveFilters(state.filters);
  const events = filtering
    ? filterTimelineRows(allEvents, state.snapshot, state.filters, state.customIcons)
    : allEvents;

  const scroll = node("div", "timeline-scroll");
  if (!allEvents.length) {
    scroll.append(node("p", "empty-overview", "実行・状態変更の履歴はまだありません。"));
    $("view-content").replaceChildren(scroll);
    return;
  }
  if (!events.length) {
    const empty = node("div", "empty-overview");
    empty.append(node("p", "", "フィルタ条件に一致する履歴はありません。"));
    if (filtering) {
      const reset = node("button", "btn secondary sm", "フィルタをリセット");
      reset.type = "button";
      reset.onclick = resetFilters;
      empty.append(reset);
    }
    scroll.append(empty);
    $("view-content").replaceChildren(scroll);
    return;
  }

  let currentDate = null;
  for (const event of events) {
    if (event.dateLabel !== currentDate) {
      currentDate = event.dateLabel;
      scroll.append(node("p", "timeline-date", currentDate));
    }
    const isKnowledge = event.kind === "knowledge" && Boolean(event.target);
    const navigable = Boolean(event.owner?.taskId) || isKnowledge;
    const rowEl = node("div", "timeline-row" + (navigable ? " clickable" : ""));
    if (navigable) {
      rowEl.setAttribute("role", "button");
      rowEl.tabIndex = 0;
    }
    if (event.target) rowEl.dataset.target = event.target;
    if (event.kind) rowEl.dataset.kind = event.kind;

    const badgeStatus = event.afterStatus || (event.event === "run.started" ? "doing" : event.event === "run.finished" ? "completed" : "");
    const leftBadge = badgeStatus
      ? statusBadge(badgeStatus)
      : node("span", "status-badge" + (event.event === "run.progress_changed" ? " progress" : ""), event.label);
    if (leftBadge.textContent) leftBadge.title = leftBadge.textContent;

    const main = node("div", "timeline-row-main");
    const top = node("div", "timeline-row-top");
    const titleEl = node("span", "timeline-row-title", event.title);
    titleEl.title = event.title || "";
    top.append(node("span", "timeline-kind", event.kindLabel), titleEl);

    const progressSummary = event.progress && ((event.progress.percent !== undefined && event.progress.percent !== null) || event.progress.message)
      ? `${event.progress.percent !== undefined && event.progress.percent !== null ? event.progress.percent + "% " : ""}${event.progress.message || ""}`.trim()
      : event.event === "run.progress_changed" && event.from?.progress
        ? "進捗をクリア"
        : "";

    const metaParts = [
      event.fullLabel || `${event.dateLabel} ${event.timeLabel}`,
      event.label,
      event.transition,
      event.actorLabel,
      progressSummary,
      event.reason,
    ].filter(Boolean);

    const metaText = metaParts.join(" · ");
    const metaEl = node("div", "timeline-row-meta", metaText);
    metaEl.title = metaText;
    main.append(top, metaEl);
    rowEl.append(leftBadge, main);
    if (navigable) {
      rowEl.append(node("span", "row-chevron", "›"));
      const activate = () => {
        if (isKnowledge) {
          openKnowledgeDetail(event.target, { fallbackEvent: event, historyMode: "push" });
        } else if (event.owner.jobId && event.owner.ticketId) {
          openJobDetail(event.owner.taskId, event.owner.ticketId, event.owner.jobId);
        } else if (event.owner.ticketId) {
          openTicketDetail(event.owner.taskId, event.owner.ticketId);
        } else {
          openTaskDetail(event.owner.taskId);
        }
      };
      rowEl.addEventListener("click", activate);
      rowEl.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      });
    }
    scroll.append(rowEl);
  }

  $("view-content").replaceChildren(scroll);
}

/* ================================
   Detail Modal (Task / Ticket / Job)
   ================================ */
function ensureModalOpen() {
  const dlg = $("detail-modal");
  if (!dlg.open) dlg.showModal();
}

function closeDetailModal({ sync = true, historyMode = "push" } = {}) {
  const wasOpen = modalState.open;
  modalState.open = false;
  modalState.kind = null;
  modalState.id = null;
  modalState.taskId = null;
  modalState.ticketId = null;
  modalState.backStack = [];
  setDetailError(null);
  resetProgressDraft();
  const dlg = $("detail-modal");
  if (dlg.open) dlg.close();
  if (wasOpen && sync) syncUrl(historyMode);
}

function pushBackState() {
  if (modalState.open && modalState.kind && modalState.id) {
    modalState.backStack.push({
      kind: modalState.kind,
      id: modalState.id,
      taskId: modalState.taskId,
      ticketId: modalState.ticketId,
    });
  }
}

function openTaskDetail(taskId, { pushBack = false, historyMode = "push" } = {}) {
  if (panelState.open) closePanelModal({ sync: false });
  if (pushBack) pushBackState();
  else modalState.backStack = [];
  setDetailError(null);
  resetProgressDraft();
  state.taskId = taskId;
  state.ticketId = null;
  modalState.open = true;
  modalState.kind = "task";
  modalState.id = taskId;
  modalState.taskId = taskId;
  modalState.ticketId = null;
  syncUrl(historyMode);
  renderDetailModal();
  ensureModalOpen();
}

function openTicketDetail(taskId, ticketId, { pushBack = false, historyMode = "push" } = {}) {
  if (panelState.open) closePanelModal({ sync: false });
  if (pushBack) pushBackState();
  else modalState.backStack = [];
  setDetailError(null);
  if (modalState.ticketId !== ticketId) resetProgressDraft();
  const owner = findTicketItem(ticketId);
  const resolvedTaskId = taskId || owner?.taskEntry.task.record.id || state.taskId;
  state.taskId = resolvedTaskId;
  state.ticketId = ticketId;
  modalState.open = true;
  modalState.kind = "ticket";
  modalState.id = ticketId;
  modalState.taskId = resolvedTaskId;
  modalState.ticketId = ticketId;
  syncUrl(historyMode);
  renderDetailModal();
  ensureModalOpen();
  fetchTicketDetail(ticketId).catch(showError);
}

function openJobDetail(taskId, ticketId, jobId, { pushBack = false, historyMode = "push" } = {}) {
  if (panelState.open) closePanelModal({ sync: false });
  setDetailError(null);
  resetProgressDraft();
  const jobFound = findJobItem(jobId);
  const resolvedTicketId = ticketId || jobFound?.ticketEntry?.ticket?.record?.id || state.ticketId;
  const owner = findTicketItem(resolvedTicketId);
  const resolvedTaskId = taskId || jobFound?.taskEntry?.task?.record?.id || owner?.taskEntry.task.record.id || state.taskId;
  if (pushBack) {
    pushBackState();
  } else {
    modalState.backStack = resolvedTicketId
      ? [{ kind: "ticket", id: resolvedTicketId, taskId: resolvedTaskId, ticketId: resolvedTicketId }]
      : [];
  }
  state.taskId = resolvedTaskId;
  state.ticketId = resolvedTicketId;
  modalState.open = true;
  modalState.kind = "job";
  modalState.id = jobId;
  modalState.taskId = resolvedTaskId;
  modalState.ticketId = resolvedTicketId;
  syncUrl(historyMode);
  renderDetailModal();
  ensureModalOpen();
  if (resolvedTicketId) fetchTicketDetail(resolvedTicketId).catch(showError);
}

function detailSection(label, ...children) {
  const sec = node("section", "detail-section");
  sec.append(node("div", "detail-section-label", label), ...children);
  return sec;
}

function renderTaskModal(taskId) {
  const entry = findTaskEntry(taskId);
  const body = $("detail-modal-body");
  const editBtn = $("detail-edit");
  const delBtn = $("detail-delete");

  if (!entry) {
    $("detail-modal-title").textContent = "Taskが見つかりません";
    $("detail-modal-id").textContent = taskId || "";
    setStatusBadge($("detail-status"), "");
    $("detail-kind").textContent = "Task";
    editBtn.hidden = true;
    delBtn.hidden = true;
    body.replaceChildren(node("p", "detail-text", "このTaskは削除されたか、現在のProjectにありません。"));
    return;
  }

  const task = entry.task;
  const record = task.record;
  const isEnd = terminal(task);
  const readOnly = isReadOnly();
  const deletable = canDeleteTask(state.snapshot, task) && !readOnly;
  const purgeable = canPurgeTask(state.snapshot, task) && !readOnly;

  setStatusBadge($("detail-status"), record.status);
  $("detail-kind").textContent = "Task";
  $("detail-modal-title").textContent = record.objective;
  $("detail-modal-id").textContent = record.id;
  $("detail-copy-id").onclick = () => copyText(record.id, `IDをコピー: ${record.id}`);

  editBtn.hidden = false;
  editBtn.disabled = isEnd || readOnly;
  editBtn.title = readOnly ? READ_ONLY_TIP : isEnd ? "終了済みのTaskは編集できません" : "Taskを編集";
  editBtn.onclick = () => openEditTaskDialog(task);

  delBtn.hidden = false;
  delBtn.disabled = !deletable;
  delBtn.title = readOnly ? READ_ONLY_TIP : deletable ? "Taskを論理削除" : "Taskと配下を完了または中止にしてから削除できます";
  delBtn.onclick = () => openDeleteTaskDialog(task);

  const sections = [];
  if (task.display?.summary) {
    sections.push(detailSection("補足メモ", node("p", "detail-text", task.display.summary)));
  }

  if ((record.criteria || []).length) {
    const ul = node("ul", "detail-criteria");
    for (const c of record.criteria) ul.append(node("li", "", c));
    sections.push(detailSection("完了条件", ul));
  }

  if (record.deadline) {
    sections.push(detailSection("期限", node("p", "detail-text", formatTimestamp(record.deadline, state.timeZone))));
  }

  if (record.resume) {
    sections.push(detailSection("再開条件", node("p", "detail-text", record.resume)));
  }

  const evidence = task.constraints?.completion_evidence || record.result;
  if (evidence) {
    sections.push(detailSection("結果・完了の根拠", node("p", "detail-text", evidence)));
  }

  // Child Tickets section with `+` header action
  const ticketSection = node("section", "detail-section");
  const ticketHeader = node("div", "section-header-row");
  const childTickets = entry.tickets || [];
  ticketHeader.append(node("div", "detail-section-label", `Ticket（${childTickets.length}件）`));
  const plusTicketBtn = node("button", "tool-btn sm");
  plusTicketBtn.type = "button";
  plusTicketBtn.disabled = isEnd || readOnly;
  plusTicketBtn.title = readOnly ? READ_ONLY_TIP : isEnd ? "終了済みTaskへはTicketを追加できません" : "配下Ticketを追加";
  plusTicketBtn.setAttribute("aria-label", "配下Ticketを追加");
  plusTicketBtn.append(svgIcon("/icons/plus.svg", "sm"));
  plusTicketBtn.onclick = () => openNewTicketDialog(record.id);
  ticketHeader.append(plusTicketBtn);
  ticketSection.append(ticketHeader);

  if (childTickets.length) {
    const list = node("div", "modal-row-list");
    for (const item of childTickets) {
      const tr = item.ticket.record;
      const rowEl = node("div", "modal-item-row");
      rowEl.setAttribute("role", "button");
      rowEl.tabIndex = 0;
      rowEl.append(
        statusBadge(tr.status),
        node("span", "modal-item-title", tr.objective),
        copyIdButton(tr.id),
        node("span", "row-chevron", "›"),
      );
      rowEl.onclick = () => openTicketDetail(record.id, tr.id, { pushBack: true });
      rowEl.onkeydown = e => {
        if (e.target === rowEl && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          openTicketDetail(record.id, tr.id, { pushBack: true });
        }
      };
      list.append(rowEl);
    }
    ticketSection.append(list);
  } else {
    ticketSection.append(node("p", "detail-text", "まだTicketがありません。右上の＋から追加できます。"));
  }
  sections.push(ticketSection);

  // Task Actions
  const actions = node("div", "modal-actions");
  const editAction = node("button", "btn secondary sm", "編集");
  editAction.type = "button";
  editAction.disabled = isEnd || readOnly;
  if (readOnly) editAction.title = READ_ONLY_TIP;
  editAction.onclick = () => openEditTaskDialog(task);

  const pauseBtn = node("button", "btn secondary sm", record.status === "paused" ? "保留を解除" : "保留");
  pauseBtn.type = "button";
  pauseBtn.disabled = isEnd || readOnly;
  if (readOnly) pauseBtn.title = READ_ONLY_TIP;
  pauseBtn.onclick = () => openPauseTaskDialog(task);

  const completeBtn = node("button", "btn primary sm", "Taskを完了");
  completeBtn.type = "button";
  completeBtn.disabled = isEnd || readOnly;
  if (readOnly) completeBtn.title = READ_ONLY_TIP;
  completeBtn.onclick = () => openCompletionDialog(task, "Task");

  const cancelBtn = node("button", "btn danger sm", "Taskを中止");
  cancelBtn.type = "button";
  cancelBtn.disabled = isEnd || readOnly;
  if (readOnly) cancelBtn.title = READ_ONLY_TIP;
  cancelBtn.onclick = () => openCancelTaskDialog(task);

  actions.append(editAction, pauseBtn, completeBtn, cancelBtn);
  sections.push(detailSection("操作", actions));

  // Delete & Purge footer
  const deleteBar = node("div", "modal-footer-bar");
  const delAction = node("button", "btn danger sm", "論理削除");
  delAction.type = "button";
  delAction.disabled = !deletable;
  delAction.title = deletable ? "履歴と依存参照を残して一覧から除外します" : "Taskと配下をすべて完了・中止にしてから削除できます";
  delAction.onclick = () => openDeleteTaskDialog(task);

  const purgeAction = node("button", "btn danger sm", "物理削除（完全削除）");
  purgeAction.type = "button";
  purgeAction.disabled = !purgeable;
  purgeAction.title = purgeable
    ? "このTaskと配下のTicket・Job・RunをDBから完全削除します"
    : "配下すべて終端・稼働Runなし・他Taskからの参照なしの時のみ利用できます";
  purgeAction.onclick = () => openPurgeTaskDialog(task);

  deleteBar.append(delAction, purgeAction);
  sections.push(deleteBar);

  body.replaceChildren(...sections);
}

function renderTicketModal(ticketId) {
  const found = findTicketItem(ticketId);
  const body = $("detail-modal-body");
  const editBtn = $("detail-edit");
  const delBtn = $("detail-delete");
  const liveDetail = state.detail?.ticket?.record?.id === ticketId ? state.detail : null;
  const ticket = liveDetail?.ticket || found?.ticketEntry?.ticket;

  if (!ticket) {
    $("detail-modal-title").textContent = "Ticketが見つかりません";
    $("detail-modal-id").textContent = ticketId || "";
    setStatusBadge($("detail-status"), "");
    $("detail-kind").textContent = "Ticket";
    editBtn.hidden = true;
    delBtn.hidden = true;
    body.replaceChildren(node("p", "detail-text", "このTicketは削除されたか、現在のProjectにありません。"));
    return;
  }

  const record = ticket.record;
  const isEnd = terminal(ticket);
  const readOnly = isReadOnly();
  const taskId = found?.taskEntry?.task?.record?.id || modalState.taskId;
  const liveJob = liveDetail?.job || null;
  const liveRun = liveDetail?.run || null;
  const snapshotJobs = found?.ticketEntry?.jobs || (record.jobs || []).map(j => ({ record: j }));

  setStatusBadge($("detail-status"), record.status);
  $("detail-kind").textContent = "Ticket";
  $("detail-modal-title").textContent = record.objective;
  $("detail-modal-id").textContent = record.id;
  $("detail-copy-id").onclick = () => copyText(record.id, `IDをコピー: ${record.id}`);

  editBtn.hidden = false;
  editBtn.disabled = isEnd || readOnly;
  editBtn.title = readOnly ? READ_ONLY_TIP : isEnd ? "終了済みのTicketは編集できません" : "Ticketを編集";
  editBtn.onclick = () => openEditTicketDialog(ticket);

  delBtn.hidden = false;
  delBtn.disabled = !isEnd || readOnly;
  delBtn.title = readOnly ? READ_ONLY_TIP : isEnd ? "Ticketを論理削除" : "完了または中止にしてから削除できます";
  delBtn.onclick = () => openDeleteTicketDialog(ticket);

  const activeRunId = liveRun?.record?.id || "";
  const existingForm = body.querySelector("#progress-form");
  const focusedEl = existingForm && existingForm.contains(document.activeElement) ? document.activeElement : null;
  const focusedId = focusedEl?.id || null;
  const focusStart = focusedEl && typeof focusedEl.selectionStart === "number" ? focusedEl.selectionStart : null;
  const focusEnd = focusedEl && typeof focusedEl.selectionEnd === "number" ? focusedEl.selectionEnd : null;
  const keepFormValues = Boolean(
    activeRunId && (
      (progressDraft.dirty && progressDraft.runId === activeRunId)
      || (existingForm && existingForm.contains(document.activeElement) && existingForm.dataset.run === activeRunId)
    ),
  );
  if (progressDraft.runId && progressDraft.runId !== activeRunId) {
    resetProgressDraft();
  }
  const savedPercent = keepFormValues
    ? (progressDraft.dirty && progressDraft.runId === activeRunId
      ? progressDraft.percent
      : existingForm?.querySelector("#percent-input")?.value ?? "")
    : null;
  const savedMessage = keepFormValues
    ? (progressDraft.dirty && progressDraft.runId === activeRunId
      ? progressDraft.message
      : existingForm?.querySelector("#message-input")?.value ?? "")
    : null;

  const sections = [];

  if (ticket.display?.summary) {
    sections.push(detailSection("補足メモ", node("p", "detail-text", ticket.display.summary)));
  }

  // Job list
  const jobList = node("div", "modal-row-list");
  for (const job of snapshotJobs) {
    const isCurrent = liveJob?.record?.id === job.record.id
      || (!liveJob && ["doing", "waiting", "blocked"].includes(job.record.status));
    const rowEl = node("div", "modal-item-row" + (isCurrent ? " is-active" : ""));
    rowEl.setAttribute("role", "button");
    rowEl.tabIndex = 0;
    rowEl.dataset.jobRow = job.record.id;
    rowEl.append(
      createJobDot(job, { interactive: false }),
      statusBadge(job.record.status),
      node("span", "modal-item-title", job.record.objective),
      copyIdButton(job.record.id),
      node("span", "row-chevron", "›"),
    );
    const goJob = () => openJobDetail(taskId, ticketId, job.record.id, { pushBack: true });
    rowEl.onclick = goJob;
    rowEl.onkeydown = e => {
      if (e.target === rowEl && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        goJob();
      }
    };
    jobList.append(rowEl);
  }
  sections.push(detailSection("Job一覧 · 上から順に実行", jobList));

  // Current Job Run Progress & Execution Controls
  if (liveJob) {
    const runCard = node("div", "run-card");
    const runHeader = node("div", "run-card-header");
    const runTitle = node("div", "run-card-title");
    runTitle.append(
      createJobDot(liveJob, { interactive: false }),
      node("span", "", liveJob.record.objective),
    );
    runHeader.append(runTitle, statusBadge(liveJob.record.status));
    runCard.append(runHeader);

    if ((liveJob.record.criteria || []).length) {
      const ul = node("ul", "detail-criteria");
      for (const c of liveJob.record.criteria) ul.append(node("li", "", c));
      runCard.append(ul);
    }

    const active = Boolean(liveRun?.active);
    const held = liveDetail?.task?.record?.status === "paused"
      || ["paused", "blocked"].includes(record.status)
      || ["paused", "blocked"].includes(liveJob.record.status)
      || liveRun?.constraints?.stop_requested;
    const percent = active ? liveRun.progress?.percent : undefined;

    const progBox = node("div", "progress-box");
    const progTop = node("div", "progress-top");
    progTop.append(
      node("span", "", held ? "停止・保留の状態を確認してください" : "Runの進捗"),
      node("strong", "", percent !== undefined && percent !== null ? `${percent}%` : active ? "未定" : liveRun ? "Run終了" : "未実行"),
    );
    progBox.append(progTop);

    const progBar = document.createElement("progress");
    progBar.max = 100;
    progBar.hidden = !active;
    if (percent !== undefined && percent !== null) progBar.value = percent;
    progBox.append(progBar);

    progBox.append(node("p", "progress-msg", liveRun?.progress?.message || (active ? "報告を待っています。" : "Runを開始すると、進捗を記録できます。")));
    runCard.append(progBox);

    const progForm = node("form", "progress-form");
    progForm.id = "progress-form";
    progForm.dataset.run = liveRun?.record?.id || "";

    const pctLabel = node("label", "", "進捗率（%）");
    const pctInput = document.createElement("input");
    pctInput.id = "percent-input";
    pctInput.type = "number";
    pctInput.min = "0";
    pctInput.max = "100";
    pctInput.step = "1";
    pctInput.placeholder = "未定";
    pctInput.value = keepFormValues && savedPercent !== null ? savedPercent : (liveRun?.progress?.percent ?? "");
    pctInput.disabled = !active || readOnly;
    pctLabel.append(pctInput);

    const msgLabel = node("label", "", "いま行っていること");
    const msgInput = document.createElement("input");
    msgInput.id = "message-input";
    msgInput.type = "text";
    msgInput.placeholder = "例：テスト結果を確認中";
    msgInput.value = keepFormValues && savedMessage !== null ? savedMessage : (liveRun?.progress?.message ?? "");
    msgInput.disabled = !active || readOnly;
    msgLabel.append(msgInput);

    const syncProgressDraft = () => {
      progressDraft.runId = activeRunId;
      progressDraft.percent = pctInput.value;
      progressDraft.message = msgInput.value;
      progressDraft.dirty = true;
    };
    pctInput.addEventListener("input", syncProgressDraft);
    msgInput.addEventListener("input", syncProgressDraft);

    const reportBtn = node("button", "btn secondary", "進捗を報告");
    reportBtn.type = "submit";
    reportBtn.disabled = !active || readOnly || progressSubmitting;
    if (readOnly) reportBtn.title = READ_ONLY_TIP;

    progForm.append(pctLabel, msgLabel, reportBtn);
    progForm.onsubmit = async event => {
      event.preventDefault();
      const currentRun = state.detail?.ticket?.record?.id === ticketId && state.detail?.run?.active
        ? state.detail.run
        : liveRun;
      if (!currentRun || !currentRun.active || progressSubmitting) return;

      const pctRaw = pctInput.value.trim();
      let nextPercent = null;
      if (pctRaw !== "") {
        const parsed = Number(pctRaw);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
          showError(new Error("進捗率（%）は 0〜100 の整数で入力してください。"));
          return;
        }
        nextPercent = parsed;
      }

      const trimmedMsg = msgInput.value.trim();
      if (/[\x00-\x1f\x7f-\x9f]/.test(trimmedMsg)) {
        showError(new Error("「いま行っていること」に改行や制御文字は含められません。"));
        return;
      }
      if (new TextEncoder().encode(trimmedMsg).length > 2048) {
        showError(new Error("「いま行っていること」は 2048 バイト以内で入力してください。"));
        return;
      }
      const nextMessage = trimmedMsg || null;

      const prevPercent = currentRun.progress?.percent ?? null;
      const prevMessage = currentRun.progress?.message ?? null;
      if (nextPercent === prevPercent && nextMessage === prevMessage) {
        setDetailError(null);
        if (nextPercent === null && nextMessage === null) {
          showToast("進捗率（%）または「いま行っていること」を入力してから報告してください");
          msgInput.focus();
        } else {
          showToast("現在と同じ進捗内容のため変更はありません（値を変更するとタイムラインに記録されます）");
        }
        return;
      }

      setDetailError(null);
      progressSubmitting = true;
      reportBtn.disabled = true;
      try {
        const prevRevision = currentRun.revision;
        const updated = await api("run.progress", {
          id: currentRun.record.id,
          revision: prevRevision,
          percent: nextPercent,
          message: nextMessage,
          ticket_id: ticketId,
        });
        clearError();
        resetProgressDraft();
        progressSubmitting = false;
        await refresh(generation, "replace");
        if (updated && updated.revision !== undefined && updated.revision === prevRevision) {
          showToast("現在と同じ進捗内容のため変更はありませんでした");
        } else if (nextPercent === null && nextMessage === null) {
          showToast("進捗表示をクリアしました（タイムラインに記録）");
        } else {
          showToast("進捗を報告しました（タイムラインに記録）");
        }
      } catch (error) {
        progressSubmitting = false;
        showError(error);
        await refresh(generation, "replace").catch(() => {});
      } finally {
        progressSubmitting = false;
        const stillActive = Boolean(state.detail?.ticket?.record?.id === ticketId && state.detail?.run?.active);
        const liveBtn = $("detail-modal-body")?.querySelector("#progress-form button[type='submit']");
        if (liveBtn) liveBtn.disabled = !stillActive || isReadOnly();
        reportBtn.disabled = !stillActive || isReadOnly();
      }
    };
    runCard.append(progForm);

    const execActions = node("div", "modal-actions");
    const startBtn = node("button", "btn primary sm", "Runを開始");
    startBtn.type = "button";
    startBtn.disabled = readOnly || active || held || !["todo", "doing"].includes(liveJob.record.status) || !["todo", "doing"].includes(record.status);
    if (readOnly) startBtn.title = READ_ONLY_TIP;
    startBtn.onclick = () => startRunFlow(liveDetail, ticketId, startBtn);

    const finishBtn = node("button", "btn secondary sm", "Runを終了");
    finishBtn.type = "button";
    finishBtn.disabled = readOnly || !active;
    if (readOnly) finishBtn.title = READ_ONLY_TIP;
    finishBtn.onclick = () => openFinishRunDialog(liveRun, ticketId);

    const completeJobBtn = node("button", "btn secondary sm", "Jobを完了");
    completeJobBtn.type = "button";
    completeJobBtn.disabled = readOnly || active || !liveJob.started || !["doing", "waiting"].includes(liveJob.record.status);
    if (readOnly) completeJobBtn.title = READ_ONLY_TIP;
    completeJobBtn.onclick = () => openCompletionDialog(liveJob, "Job");

    execActions.append(startBtn, finishBtn, completeJobBtn);
    runCard.append(execActions);

    sections.push(detailSection("現在Jobの実行", runCard));
  }

  // Metadata sections
  if (record.resume) {
    sections.push(detailSection("再開条件", node("p", "detail-text", record.resume)));
  }
  if ((record.refs || []).length) {
    const refText = record.refs.map(r => [r.ticket_id, r.kind, r.note].filter(Boolean).join(" · ")).join("\n");
    sections.push(detailSection("関連参照（refs）", node("p", "detail-text", refText)));
  }
  if ((record.artifacts || []).length) {
    sections.push(detailSection("成果物（artifacts）", node("p", "detail-text", record.artifacts.join("\n"))));
  }
  if (record.cancel_reason) {
    sections.push(detailSection("中止理由", node("p", "detail-text", record.cancel_reason)));
  }

  const person = workerName(record.worker_id);
  const assigneeText = record.session_id ? `${person}（${record.session_id}）` : person;
  sections.push(detailSection("担当", node("p", "detail-text", assigneeText)));

  const depends = record.depends || [];
  if (depends.length) {
    const depList = node("div", "modal-row-list");
    for (const depId of depends) {
      const depFound = findTicketItem(depId);
      if (depFound) {
        const depRec = depFound.ticketEntry.ticket.record;
        const depRow = node("div", "modal-item-row");
        depRow.setAttribute("role", "button");
        depRow.tabIndex = 0;
        depRow.append(
          statusBadge(depRec.status),
          node("span", "modal-item-title", depRec.objective),
          node("span", "row-chevron", "›"),
        );
        depRow.onclick = () => openTicketDetail(depFound.taskEntry.task.record.id, depId, { pushBack: true });
        depList.append(depRow);
      } else {
        depList.append(node("p", "detail-text", depId));
      }
    }
    sections.push(detailSection("先行Ticket", depList));
  }

  // Footer actions (Watch command + Edit + Cancel / Delete Ticket)
  const footerBar = node("div", "modal-footer-bar");
  const leftFooter = node("div", "modal-actions");
  const watchBtn = node("button", "btn secondary sm", "端末監視コマンドをコピー");
  watchBtn.type = "button";
  watchBtn.onclick = () => {
    const command = `${state.config.watch_prefix} watch ${record.id} --osc7501`;
    copyText(command, "端末監視コマンドをコピーしました");
  };
  const editFooterBtn = node("button", "btn secondary sm", "編集");
  editFooterBtn.type = "button";
  editFooterBtn.disabled = isEnd || readOnly;
  if (readOnly) editFooterBtn.title = READ_ONLY_TIP;
  editFooterBtn.onclick = () => openEditTicketDialog(ticket);
  leftFooter.append(watchBtn, editFooterBtn);

  const rightFooter = node("div", "modal-actions");
  if (!isEnd) {
    const cancelBtn = node("button", "btn danger sm", "Ticketを中止");
    cancelBtn.type = "button";
    cancelBtn.disabled = readOnly;
    if (readOnly) cancelBtn.title = READ_ONLY_TIP;
    cancelBtn.onclick = () => openCancelTicketDialog(ticket);
    rightFooter.append(cancelBtn);
  }
  const deleteTicketBtn = node("button", "btn danger sm", "論理削除");
  deleteTicketBtn.type = "button";
  deleteTicketBtn.disabled = !isEnd || readOnly;
  deleteTicketBtn.title = readOnly ? READ_ONLY_TIP : isEnd ? "履歴と依存参照を保持して一覧から除外します" : "完了または中止にしてから削除できます";
  deleteTicketBtn.onclick = () => openDeleteTicketDialog(ticket);
  rightFooter.append(deleteTicketBtn);

  footerBar.append(leftFooter, rightFooter);
  sections.push(footerBar);

  body.replaceChildren(...sections);
  if (focusedId) {
    const nextFocus = body.querySelector(`#${focusedId}`);
    if (nextFocus && !nextFocus.disabled) {
      nextFocus.focus({ preventScroll: true });
      if (focusStart !== null && focusEnd !== null && typeof nextFocus.setSelectionRange === "function") {
        try {
          nextFocus.setSelectionRange(focusStart, focusEnd);
        } catch {
          // Ignore for input types (e.g. number) that reject setSelectionRange
        }
      }
    }
  }
}

function renderJobModal(jobId) {
  const found = findJobItem(jobId);
  const body = $("detail-modal-body");
  $("detail-edit").hidden = true;
  $("detail-delete").hidden = true;

  const liveDetail = state.detail?.ticket?.record?.id === modalState.ticketId ? state.detail : null;
  const liveJob = liveDetail?.job?.record?.id === jobId ? liveDetail.job : null;
  const job = liveJob || found?.job;

  if (!job) {
    $("detail-modal-title").textContent = "Jobが見つかりません";
    $("detail-modal-id").textContent = jobId || "";
    setStatusBadge($("detail-status"), "");
    $("detail-kind").textContent = "Job";
    body.replaceChildren(node("p", "detail-text", "このJobは削除されたか、現在のProjectにありません。"));
    return;
  }

  const record = job.record;

  setStatusBadge($("detail-status"), record.status);
  $("detail-kind").textContent = "Job";
  $("detail-modal-title").textContent = record.objective;
  $("detail-modal-id").textContent = record.id;
  $("detail-copy-id").onclick = () => copyText(record.id, `IDをコピー: ${record.id}`);

  const sections = [];

  sections.push(detailSection("目標", node("p", "detail-text", record.objective)));

  if (job.display?.summary) {
    sections.push(detailSection("補足メモ", node("p", "detail-text", job.display.summary)));
  }

  if (record.instructions) {
    sections.push(detailSection("手順", node("p", "detail-text", record.instructions)));
  }

  if ((record.criteria || []).length) {
    const ul = node("ul", "detail-criteria");
    for (const c of record.criteria) ul.append(node("li", "", c));
    sections.push(detailSection("完了条件", ul));
  }

  if (record.resume) {
    sections.push(detailSection("再開条件", node("p", "detail-text", record.resume)));
  }

  if (record.result) {
    sections.push(detailSection("結果", node("p", "detail-text", record.result)));
  }

  const runs = [...(record.runs || [])];
  if (liveDetail?.run && liveJob && !runs.some(r => r.id === liveDetail.run.record.id)) {
    runs.push({ ...liveDetail.run.record, active: liveDetail.run.active, progress: liveDetail.run.progress });
  }
  if (runs.length) {
    const runList = node("div", "modal-row-list");
    for (const run of runs) {
      const item = node("div", "run-history-item");
      const top = node("div", "run-history-top");
      const stateLabel = run.active ? "実行中" : run.ended || run.finished_at ? `終了（${run.result || "完了"}）` : "停止・未確認";
      top.append(node("span", "", stateLabel), node("span", "modal-id", run.id || ""));
      item.append(top);
      const startedStr = run.started || run.started_at ? formatTimestamp(run.started || run.started_at, state.timeZone) : "";
      const endedStr = run.ended || run.finished_at ? formatTimestamp(run.ended || run.finished_at, state.timeZone) : "";
      const infoParts = [
        Array.isArray(run.actor) ? run.actor.join(" · ") : "",
        run.progress?.percent !== undefined && run.progress?.percent !== null ? `進捗 ${run.progress.percent}%` : "",
        run.progress?.message || "",
        startedStr ? `開始 ${startedStr}` : "",
        endedStr ? `終了 ${endedStr}` : "",
      ].filter(Boolean);
      if (infoParts.length) item.append(node("p", "detail-text", infoParts.join(" · ")));
      runList.append(item);
    }
    sections.push(detailSection(`実行履歴（${runs.length}件）`, runList));
  } else {
    sections.push(detailSection("実行履歴", node("p", "detail-text", "まだ実行履歴はありません。")));
  }

  body.replaceChildren(...sections);
}

function renderDetailModal() {
  if (!modalState.open) return;
  $("detail-back").hidden = modalState.backStack.length === 0;
  if (modalState.kind === "task") renderTaskModal(modalState.id);
  else if (modalState.kind === "ticket") renderTicketModal(modalState.id);
  else if (modalState.kind === "job") renderJobModal(modalState.id);
}

/* ================================
   Panel Modal: Settings / Knowledge / People
   ================================ */
function setPanelError(error) {
  const el = $("panel-error");
  if (!error) {
    el.hidden = true;
    el.textContent = "";
  } else {
    el.textContent = error?.message || String(error);
    el.hidden = false;
  }
}

function openPanelModal(mode, extra = {}) {
  if (modalState.open) closeDetailModal({ sync: false });
  const historyMode = extra.historyMode ?? "push";
  panelState.open = true;
  panelState.mode = mode;
  panelState.knowledgeId = extra.knowledgeId || null;
  panelState.knowledgeLoading = Boolean(extra.knowledgeLoading);
  panelState.knowledgeFallback = extra.fallbackEvent || null;
  setPanelError(null);
  syncUrl(historyMode);
  renderPanelModal();
  const dlg = $("panel-modal");
  if (!dlg.open) dlg.showModal();
}

function closePanelModal({ sync = true, historyMode = "push" } = {}) {
  const wasOpen = panelState.open;
  panelState.open = false;
  panelState.mode = null;
  panelState.knowledgeId = null;
  panelState.knowledgeLoading = false;
  panelState.knowledgeFallback = null;
  setPanelError(null);
  const dlg = $("panel-modal");
  if (dlg.open) dlg.close();
  if (wasOpen && sync) syncUrl(historyMode);
}

function findTimelineKnowledgeFallback(knowledgeId) {
  if (!knowledgeId || !state.snapshot?.timeline?.length) return null;
  const rows = timelineRows(state.snapshot, { timeZone: state.timeZone });
  for (const ev of rows) {
    if (ev.target !== knowledgeId) continue;
    const rec = ev.to?.record || ev.from?.record;
    if (rec) {
      return {
        record: { id: knowledgeId, ...rec },
        revision: ev.to?.revision ?? ev.from?.revision ?? null,
        fromTimelineFallback: true,
      };
    }
  }
  return null;
}

function resolveKnowledgeEntry(knowledgeId) {
  if (!knowledgeId) return null;
  const inSnapshot = (state.snapshot?.knowledge || []).find(k => k.record.id === knowledgeId);
  if (inSnapshot) return inSnapshot;
  if (state.knowledgeCache.has(knowledgeId)) return state.knowledgeCache.get(knowledgeId);
  if (panelState.knowledgeFallback && panelState.knowledgeFallback.target === knowledgeId) {
    const rec = panelState.knowledgeFallback.to?.record || panelState.knowledgeFallback.from?.record;
    if (rec) {
      return {
        record: { id: knowledgeId, ...rec },
        revision: panelState.knowledgeFallback.to?.revision ?? panelState.knowledgeFallback.from?.revision ?? null,
        fromTimelineFallback: true,
      };
    }
  }
  return findTimelineKnowledgeFallback(knowledgeId);
}

async function fetchKnowledgeDetail(knowledgeId, fallbackEvent = null) {
  if (!knowledgeId) return null;
  const epoch = generation;
  let entry = null;
  try {
    entry = await api("knowledge.get", { id: knowledgeId });
  } catch {
    try {
      entry = await api("knowledge.get", { id: knowledgeId, include_deleted: true });
    } catch {
      entry = null;
    }
  }
  if (epoch !== generation) return null;
  if (entry?.record) {
    state.knowledgeCache.set(knowledgeId, entry);
  } else if (fallbackEvent) {
    const rec = fallbackEvent.to?.record || fallbackEvent.from?.record;
    if (rec) {
      state.knowledgeCache.set(knowledgeId, {
        record: { id: knowledgeId, ...rec },
        revision: fallbackEvent.to?.revision ?? fallbackEvent.from?.revision ?? null,
        fromTimelineFallback: true,
      });
    }
  }
  if (panelState.open && panelState.mode === "knowledge-detail" && panelState.knowledgeId === knowledgeId) {
    panelState.knowledgeLoading = false;
    renderPanelModal();
  }
  return entry;
}

function openKnowledgeDetail(knowledgeId, { fallbackEvent = null, historyMode = "push" } = {}) {
  const inSnapshot = (state.snapshot?.knowledge || []).some(k => k.record.id === knowledgeId);
  const needsFetch = Boolean(knowledgeId) && !inSnapshot;
  openPanelModal("knowledge-detail", {
    knowledgeId,
    fallbackEvent,
    knowledgeLoading: needsFetch && !state.knowledgeCache.has(knowledgeId),
    historyMode,
  });
  if (needsFetch) {
    fetchKnowledgeDetail(knowledgeId, fallbackEvent).catch(() => {
      if (panelState.open && panelState.mode === "knowledge-detail" && panelState.knowledgeId === knowledgeId) {
        panelState.knowledgeLoading = false;
        renderPanelModal();
      }
    });
  }
}

function segmentedControl(items, currentValue, onSelect) {
  const wrap = node("div", "segmented-control");
  for (const [value, label] of items) {
    const btn = node("button", "segmented-btn" + (value === currentValue ? " is-selected" : ""), label);
    btn.type = "button";
    btn.dataset.value = value;
    btn.setAttribute("aria-pressed", String(value === currentValue));
    btn.onclick = () => onSelect(value);
    wrap.append(btn);
  }
  return wrap;
}

function renderSettingsPanel() {
  $("panel-modal-title").textContent = "設定";
  $("panel-back").hidden = true;
  $("panel-badge").hidden = true;
  $("panel-actions").replaceChildren();

  const sections = [];

  // 1. Theme
  sections.push(detailSection(
    "テーマ",
    segmentedControl([
      ["system", "システムに合わせる"],
      ["light", "ライト"],
      ["dark", "ダーク"],
    ], state.themeMode, mode => applyTheme(mode)),
  ));

  // 2. TimeZone
  sections.push(detailSection(
    "日時の表示タイムゾーン",
    segmentedControl(
      Object.entries(TIME_ZONES),
      state.timeZone,
      tz => applyTimeZone(tz),
    ),
  ));

  // 3. Connection Info (host config read-only)
  const infoList = node("div", "info-kv-list");
  const addInfo = (label, value, copyable = false) => {
    const row = node("div", "info-kv-row");
    row.append(node("span", "info-kv-label", label), node("span", "info-kv-val", value));
    if (copyable) {
      const btn = node("button", "btn secondary sm", "コピー");
      btn.type = "button";
      btn.onclick = () => copyText(value, `${label}をコピーしました`);
      row.append(btn);
    }
    infoList.append(row);
  };
  const readOnly = isReadOnly();
  const authEnabled = Boolean(state.config.authEnabled);
  const allowHosts = Array.isArray(state.config.allowHosts) ? state.config.allowHosts : [];
  addInfo("プロトコル", state.config.protocol || "TTJ/1.1.0");
  addInfo("管理主体（actor）", state.config.actor || "ttjweb");
  addInfo("接続モード", readOnly ? "読み取り専用（Read-only）" : "読み書き可能");
  addInfo("トークン認証", authEnabled ? "有効" : "無効（ローカル / Tailnet 限定）");
  addInfo("許可ホスト", allowHosts.length ? allowHosts.join(", ") : "ローカルのみ（127.0.0.1 / localhost）");
  addInfo("OSC 7501 監視コマンド", state.config.watch_prefix || "ttjcore", true);

  const connChildren = [infoList];
  if (readOnly) {
    connChildren.unshift(node("p", "helper", "このサーバーは --read-only で起動されているため、作成・編集・削除・実行操作は無効化されています。"));
  }
  if (authEnabled && !isOrcaPanelMode()) {
    const logoutRow = node("div", "modal-actions");
    const logoutBtn = node("button", "btn secondary sm", "ログアウト");
    logoutBtn.type = "button";
    logoutBtn.onclick = async () => {
      try {
        await fetch("/api/auth/logout", { method: "POST" });
      } finally {
        location.reload();
      }
    };
    logoutRow.append(logoutBtn);
    connChildren.push(logoutRow);
  }
  sections.push(detailSection("接続情報（ホスト設定の確認）", ...connChildren));

  // 4. Job Icon Key Gallery (standard + user custom keys)
  const iconSec = node("section", "detail-section");
  const iconHead = node("div", "section-header-row");
  iconHead.append(node("div", "detail-section-label", "Job アイコンキー一覧"));
  const addIconBtn = node("button", "btn primary sm", "＋ アイコンキーを追加");
  addIconBtn.id = "add-custom-icon-btn";
  addIconBtn.type = "button";
  addIconBtn.onclick = () => openCustomIconDialog(null);
  iconHead.append(addIconBtn);
  iconSec.append(iconHead);

  const gallery = node("div", "icon-gallery");
  for (const opt of JOB_ICON_OPTIONS) {
    const row = node("div", "icon-gallery-row");
    const preview = createJobDot({ record: { status: "completed", objective: opt.value }, display: { icon: opt.value } }, { interactive: false });
    const desc = opt.label.includes("—") ? opt.label.split("—")[1].trim() : opt.label;
    const filename = (DEFAULT_ICONS[opt.value] || "").split("/").pop();
    row.append(
      preview,
      node("span", "icon-gallery-key", opt.value),
      node("span", "icon-gallery-desc", desc),
      node("span", "icon-gallery-path", filename),
    );
    gallery.append(row);
  }

  for (const [key, entry] of Object.entries(state.customIcons).sort(([a], [b]) => a.localeCompare(b))) {
    const row = node("div", "icon-gallery-row");
    row.dataset.customIconKey = key;
    const preview = createJobDot({ record: { status: "completed", objective: key }, display: { icon: key } }, { interactive: false });
    const desc = entry.label || "カスタムアイコン";
    const sourceLabel = entry.sourceName || (entry.src.startsWith("data:image/png") ? "upload.png" : entry.src.startsWith("data:image/svg") ? "upload.svg" : entry.src.split("/").pop());
    const actions = node("div", "icon-gallery-actions");

    const editBtn = node("button", "btn secondary sm", "編集");
    editBtn.type = "button";
    editBtn.onclick = () => openCustomIconDialog(key);

    const delBtn = node("button", "btn danger sm", "削除");
    delBtn.type = "button";
    delBtn.onclick = () => openDeleteCustomIconDialog(key);

    actions.append(editBtn, delBtn);
    row.append(
      preview,
      node("span", "icon-gallery-key", key),
      node("span", "icon-gallery-badge", "カスタム"),
      node("span", "icon-gallery-desc", desc),
      node("span", "icon-gallery-path", sourceLabel),
      actions,
    );
    gallery.append(row);
  }

  iconSec.append(gallery);
  sections.push(iconSec);

  // 5. Project & Worker / Session Management shortcuts
  const mgmtWrap = node("div", "modal-actions");
  const project = state.snapshot?.project;
  const projectDeletable = Boolean(project) && canDeleteProject(state.snapshot) && !readOnly;

  const renameBtn = node("button", "btn secondary sm", "Project名を変更");
  renameBtn.type = "button";
  renameBtn.disabled = !project || readOnly;
  if (readOnly) renameBtn.title = READ_ONLY_TIP;
  renameBtn.onclick = () => openRenameProjectDialog();

  const deleteProjBtn = node("button", "btn danger sm", "Projectを削除");
  deleteProjBtn.type = "button";
  deleteProjBtn.disabled = !project || !projectDeletable;
  deleteProjBtn.title = readOnly
    ? READ_ONLY_TIP
    : !project
      ? "Projectが選択されていません"
      : projectDeletable
        ? "このProjectを論理削除します"
        : "配下のTask・Ticketをすべて完了または中止にしてから削除できます";
  deleteProjBtn.onclick = () => openDeleteProjectDialog(project);

  const peopleBtn = node("button", "btn secondary sm", "Worker / Session 管理を開く");
  peopleBtn.type = "button";
  peopleBtn.onclick = () => openPeoplePanel();

  mgmtWrap.append(renameBtn, deleteProjBtn, peopleBtn);
  const mgmtLabel = project
    ? `Project・作業主体管理（選択中: ${project.record.name}）`
    : "Project・作業主体管理";
  sections.push(detailSection(mgmtLabel, mgmtWrap));

  $("panel-modal-body").replaceChildren(...sections);
}

function renderKnowledgeListPanel() {
  const projectName = state.snapshot?.project?.record?.name || "Project";
  $("panel-modal-title").textContent = `${projectName} の記録・知識`;
  $("panel-back").hidden = true;
  $("panel-badge").hidden = true;

  const readOnly = isReadOnly();
  const addBtn = node("button", "tool-btn");
  addBtn.type = "button";
  addBtn.disabled = readOnly;
  addBtn.title = readOnly ? READ_ONLY_TIP : "記録・知識を追加";
  addBtn.setAttribute("aria-label", "記録・知識を追加");
  addBtn.append(svgIcon("/icons/plus.svg"));
  addBtn.onclick = () => openCreateKnowledgeDialog();
  $("panel-actions").replaceChildren(addBtn);

  const items = state.snapshot?.knowledge || [];
  if (!items.length) {
    const empty = node("div", "empty-overview");
    empty.append(
      node("p", "", "まだ記録・知識がありません。Projectの方針・規約・判断根拠を登録できます。"),
    );
    const cta = node("button", "btn primary sm", "記録・知識を作成");
    cta.type = "button";
    cta.disabled = readOnly;
    if (readOnly) cta.title = READ_ONLY_TIP;
    cta.onclick = () => openCreateKnowledgeDialog();
    empty.append(cta);
    $("panel-modal-body").replaceChildren(empty);
    return;
  }

  const list = node("div", "modal-row-list");
  for (const entry of items) {
    const rec = entry.record;
    const row = node("div", "modal-item-row" + (rec.status === "active" ? " is-knowledge-active" : ""));
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    const firstLine = String(rec.content || "").split(/\r?\n/)[0] || rec.id;
    row.append(
      statusBadge(rec.status),
      node("span", "modal-item-title", firstLine),
      copyIdButton(rec.id),
      node("span", "row-chevron", "›"),
    );
    const openDetail = () => {
      openKnowledgeDetail(rec.id, { historyMode: "push" });
    };
    row.onclick = openDetail;
    row.onkeydown = e => {
      if (e.target === row && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        openDetail();
      }
    };
    list.append(row);
  }

  $("panel-modal-body").replaceChildren(detailSection(`記録一覧（${items.length}件）`, list));
}

function renderKnowledgeDetailPanel() {
  const items = state.snapshot?.knowledge || [];
  const entry = resolveKnowledgeEntry(panelState.knowledgeId);
  $("panel-back").hidden = false;
  $("panel-back").onclick = () => {
    openPanelModal("knowledge", { historyMode: "push" });
  };

  if (!entry) {
    $("panel-modal-title").textContent = panelState.knowledgeLoading ? "記録を読み込み中..." : "記録が見つかりません";
    $("panel-badge").hidden = true;
    $("panel-actions").replaceChildren();
    $("panel-modal-body").replaceChildren(node(
      "p",
      "detail-text",
      panelState.knowledgeLoading
        ? "記録・知識を読み込んでいます..."
        : "この記録・知識は削除されたか存在しません。",
    ));
    return;
  }

  const rec = entry.record;
  const isActive = rec.status === "active";
  const isReadOnlyFallback = Boolean(entry.fromTimelineFallback || entry.deleted || entry.revision === undefined || entry.revision === null);
  $("panel-modal-title").textContent = "記録の詳細";
  $("panel-badge").hidden = !rec.status;
  if (rec.status) setStatusBadge($("panel-badge"), rec.status);

  const copyBtn = node("button", "tool-btn");
  copyBtn.type = "button";
  copyBtn.title = "IDをコピー";
  copyBtn.setAttribute("aria-label", "IDをコピー");
  copyBtn.append(svgIcon(jobIconPath("id.copy")));
  copyBtn.onclick = () => copyText(rec.id, `IDをコピー: ${rec.id}`);
  $("panel-actions").replaceChildren(copyBtn);

  const sections = [
    detailSection("内容", node("p", "detail-text", rec.content || "")),
    detailSection("根拠", node("p", "detail-text", rec.basis || "")),
  ];

  if (rec.supersedes) {
    const prev = items.find(k => k.record.id === rec.supersedes) || state.knowledgeCache.get(rec.supersedes);
    const prevRow = node("div", "modal-item-row");
    prevRow.setAttribute("role", "button");
    prevRow.tabIndex = 0;
    if (prev) {
      prevRow.append(
        statusBadge(prev.record.status),
        node("span", "modal-item-title", String(prev.record.content || "").split(/\r?\n/)[0] || prev.record.id),
        node("span", "row-chevron", "›"),
      );
    } else {
      prevRow.append(
        statusBadge("supersed"),
        node("span", "modal-item-title", rec.supersedes),
        node("span", "row-chevron", "›"),
      );
    }
    const openPrev = () => openKnowledgeDetail(rec.supersedes, { historyMode: "push" });
    prevRow.onclick = openPrev;
    prevRow.onkeydown = e => {
      if (e.target === prevRow && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        openPrev();
      }
    };
    sections.push(detailSection("置換元の記録", prevRow));
  }

  sections.push(detailSection("ID", node("p", "modal-id", rec.id)));

  if (!isReadOnlyFallback && !isReadOnly()) {
    const actions = node("div", "modal-actions");
    if (isActive) {
      const replaceBtn = node("button", "btn primary sm", "新しい知識で置換");
      replaceBtn.type = "button";
      replaceBtn.onclick = () => openCreateKnowledgeDialog(entry);

      const supersedeBtn = node("button", "btn secondary sm", "過去にする");
      supersedeBtn.type = "button";
      supersedeBtn.onclick = () => openUpdateKnowledgeStatusDialog(entry, "supersed");

      actions.append(replaceBtn, supersedeBtn);
    } else {
      const reactivateBtn = node("button", "btn primary sm", "再採用する");
      reactivateBtn.type = "button";
      reactivateBtn.onclick = () => openUpdateKnowledgeStatusDialog(entry, "active");

      const delBtn = node("button", "btn danger sm", "削除");
      delBtn.type = "button";
      delBtn.onclick = () => openDeleteKnowledgeDialog(entry);

      actions.append(reactivateBtn, delBtn);
    }
    sections.push(detailSection("操作", actions));
  } else if (entry.deleted || entry.fromTimelineFallback) {
    sections.push(detailSection("状態", node("p", "helper", "この記録は履歴参照専用（削除済みまたはアーカイブ）です。")));
  }

  $("panel-modal-body").replaceChildren(...sections);
}

function renderPeoplePanel() {
  $("panel-modal-title").textContent = "Worker / Session 管理";
  $("panel-back").hidden = true;
  $("panel-badge").hidden = true;
  $("panel-actions").replaceChildren();

  const readOnly = isReadOnly();
  const sections = [];

  // Workers section
  const workerSec = node("section", "detail-section");
  const workerHead = node("div", "section-header-row");
  workerHead.append(node("div", "detail-section-label", `Worker（作業主体 · ${state.workers.length}件）`));
  const addWorkerBtn = node("button", "btn primary sm", "Workerを追加");
  addWorkerBtn.type = "button";
  addWorkerBtn.disabled = readOnly;
  if (readOnly) addWorkerBtn.title = READ_ONLY_TIP;
  addWorkerBtn.onclick = () => openCreateWorkerDialog();
  workerHead.append(addWorkerBtn);
  workerSec.append(workerHead);

  if (!state.workers.length) {
    workerSec.append(node("p", "detail-text", "まだWorkerが登録されていません。「Workerを追加」から登録してください。"));
  } else {
    const wList = node("div", "modal-row-list");
    for (const worker of state.workers) {
      const rec = worker.record;
      const activeSessions = state.sessions.filter(s => s.record.worker_id === rec.id && !s.record.ended).length;
      const row = node("div", "manage-row");
      const main = node("div", "manage-row-main");
      const title = node("div", "manage-row-title");
      title.append(node("span", "", rec.name));
      main.append(title, node("div", "manage-row-meta", `${rec.id} · 稼働Session ${activeSessions}件`));

      const acts = node("div", "manage-row-actions");
      const renameBtn = node("button", "btn secondary sm", "名称変更");
      renameBtn.type = "button";
      renameBtn.disabled = readOnly;
      if (readOnly) renameBtn.title = READ_ONLY_TIP;
      renameBtn.onclick = () => openRenameWorkerDialog(worker);

      const delBtn = node("button", "btn danger sm", "削除");
      delBtn.type = "button";
      delBtn.disabled = readOnly;
      if (readOnly) delBtn.title = READ_ONLY_TIP;
      delBtn.onclick = () => openDeleteWorkerDialog(worker);

      acts.append(renameBtn, delBtn);
      row.append(main, acts);
      wList.append(row);
    }
    workerSec.append(wList);
  }
  sections.push(workerSec);

  // Sessions section
  const sessionSec = node("section", "detail-section");
  const sessionHead = node("div", "section-header-row");
  sessionHead.append(node("div", "detail-section-label", `Session（作業枠 · ${state.sessions.length}件）`));
  const addSessionBtn = node("button", "btn secondary sm", "Sessionを追加");
  addSessionBtn.type = "button";
  addSessionBtn.disabled = readOnly || state.workers.length === 0;
  addSessionBtn.title = readOnly ? READ_ONLY_TIP : state.workers.length ? "既存Workerに新しいSessionを作成" : "先にWorkerを作成してください";
  addSessionBtn.onclick = () => openCreateSessionDialog();
  sessionHead.append(addSessionBtn);
  sessionSec.append(sessionHead);

  if (!state.sessions.length) {
    sessionSec.append(node("p", "detail-text", "まだSessionがありません。"));
  } else {
    const sList = node("div", "modal-row-list");
    for (const session of state.sessions) {
      const rec = session.record;
      const ended = Boolean(rec.ended);
      const row = node("div", "manage-row");
      const main = node("div", "manage-row-main");
      const title = node("div", "manage-row-title");
      const badge = node("span", "status-badge " + (ended ? "supersed" : "active"), ended ? "終了済" : "稼働中");
      title.append(badge, node("span", "", workerName(rec.worker_id)));
      const metaParts = [
        rec.id,
        rec.started ? `開始 ${formatTimestamp(rec.started, state.timeZone)}` : "",
        rec.ended ? `終了 ${formatTimestamp(rec.ended, state.timeZone)}` : "",
      ].filter(Boolean);
      main.append(title, node("div", "manage-row-meta", metaParts.join(" · ")));

      const acts = node("div", "manage-row-actions");
      const endBtn = node("button", "btn secondary sm", "終了を記録");
      endBtn.type = "button";
      endBtn.disabled = ended || readOnly;
      endBtn.title = readOnly ? READ_ONLY_TIP : ended ? "既に終了済みのSessionです" : "このSessionに終了時刻を記録します";
      endBtn.onclick = () => openEndSessionDialog(session);

      const delBtn = node("button", "btn danger sm", "削除");
      delBtn.type = "button";
      delBtn.disabled = readOnly;
      if (readOnly) delBtn.title = READ_ONLY_TIP;
      delBtn.onclick = () => openDeleteSessionDialog(session);

      acts.append(endBtn, delBtn);
      row.append(main, acts);
      sList.append(row);
    }
    sessionSec.append(sList);
  }
  sections.push(sessionSec);

  $("panel-modal-body").replaceChildren(...sections);
}

function renderPanelModal() {
  if (!panelState.open) return;
  if (panelState.mode === "settings") renderSettingsPanel();
  else if (panelState.mode === "knowledge") renderKnowledgeListPanel();
  else if (panelState.mode === "knowledge-detail") renderKnowledgeDetailPanel();
  else if (panelState.mode === "people") renderPeoplePanel();
}

async function openPeoplePanel({ historyMode = "push" } = {}) {
  openPanelModal("people", { historyMode });
  try {
    await loadPeople();
    if (panelState.open && panelState.mode === "people") renderPanelModal();
  } catch (error) {
    setPanelError(error);
  }
}

async function applyRouteModal(route, { historyMode = "replace" } = {}) {
  if (!route?.modal) {
    closeDetailModal({ sync: false });
    closePanelModal({ sync: false });
    if (historyMode !== "none") syncUrl(historyMode);
    return;
  }

  if (route.modal === "settings") {
    openPanelModal("settings", { historyMode });
    return;
  }
  if (route.modal === "people") {
    await openPeoplePanel({ historyMode });
    return;
  }
  if (route.modal === "knowledge") {
    if (!state.projectId) {
      closeDetailModal({ sync: false });
      closePanelModal({ sync: false });
      if (historyMode !== "none") syncUrl(historyMode);
      return;
    }
    if (route.knowledgeId) {
      openKnowledgeDetail(route.knowledgeId, { historyMode });
    } else {
      openPanelModal("knowledge", { historyMode });
    }
    return;
  }
  if (route.modal === "task") {
    const taskId = route.taskId || state.taskId;
    if (taskId) {
      openTaskDetail(taskId, { historyMode });
    } else {
      closeDetailModal({ sync: false });
      closePanelModal({ sync: false });
      if (historyMode !== "none") syncUrl(historyMode);
    }
    return;
  }
  if (route.modal === "ticket") {
    const ticketId = route.ticketId || state.ticketId;
    if (ticketId) {
      const owner = findTicketItem(ticketId);
      const taskId = route.taskId || owner?.taskEntry?.task?.record?.id || state.taskId;
      openTicketDetail(taskId, ticketId, { historyMode });
    } else {
      closeDetailModal({ sync: false });
      closePanelModal({ sync: false });
      if (historyMode !== "none") syncUrl(historyMode);
    }
    return;
  }
  if (route.modal === "job") {
    const jobId = route.jobId;
    if (jobId) {
      const jobFound = findJobItem(jobId);
      const ticketId = route.ticketId || jobFound?.ticketEntry?.ticket?.record?.id || state.ticketId;
      const taskId = route.taskId || jobFound?.taskEntry?.task?.record?.id || state.taskId;
      openJobDetail(taskId, ticketId, jobId, { historyMode });
    } else {
      closeDetailModal({ sync: false });
      closePanelModal({ sync: false });
      if (historyMode !== "none") syncUrl(historyMode);
    }
  }
}

/* ================================
   Main Render Loop
   ================================ */
function render() {
  renderProjects();
  const hasProject = Boolean(state.projectId);
  $("welcome").hidden = hasProject;
  $("workbench").hidden = !hasProject;
  renderHeaderState();

  if (state.snapshot) {
    if (state.view === "kanban") renderKanban();
    else if (state.view === "list") renderList();
    else if (state.view === "timeline") renderTimeline();
    else renderTree();
  }

  if (modalState.open) renderDetailModal();
  if (panelState.open) renderPanelModal();
}

/* ================================
   Form Dialogs & Full CRUD Flows
   ================================ */
function field(definition) {
  const label = node("label", definition.type === "checkbox" ? "check-field" : "", definition.label);
  let input;
  if (definition.type === "select") {
    input = document.createElement("select");
    for (const option of definition.options) {
      const element = node("option", "", option.label);
      element.value = option.value;
      input.append(element);
    }
  } else {
    input = document.createElement(definition.type === "textarea" ? "textarea" : "input");
    if (input.tagName === "INPUT") input.type = definition.type || "text";
  }
  input.name = definition.name;
  input.required = definition.required !== false;
  if (definition.type === "checkbox") {
    if (definition.checked) input.checked = true;
  } else if (definition.value !== undefined && definition.value !== null) {
    input.value = definition.value;
  }
  if (definition.placeholder) input.placeholder = definition.placeholder;
  if (definition.type === "checkbox") label.prepend(input);
  else label.append(input);
  return label;
}

function openDialog(title, definitions, save, submit = "保存", setup = null, { danger = false } = {}) {
  $("dialog-title").textContent = title;
  const submitBtn = $("dialog-submit");
  submitBtn.textContent = submit;
  submitBtn.className = danger ? "btn danger" : "btn primary";
  $("dialog-error").hidden = true;
  $("dialog-fields").replaceChildren(...definitions.map(field));
  $("dialog-form").onsubmit = async event => {
    event.preventDefault();
    submitBtn.disabled = true;
    try {
      await save(Object.fromEntries(new FormData($("dialog-form"))), $("dialog-form"));
      $("dialog").close();
    } catch (error) {
      $("dialog-error").textContent = error.message;
      $("dialog-error").hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  };
  setup?.($("dialog-fields"));
  $("dialog").showModal();
  $("dialog-fields").scrollTop = 0;
}

/* --- Project CRUD --- */
const openNewProject = () => openDialog("Projectを作成", [
  { name: "name", label: "Project名", placeholder: "例：サービスの公開準備" },
], async values => {
  const name = requireText(values.name, "Project名");
  const project = await api("project.create", { record: { name } });
  clearError();
  await loadProjects(project.record.id, null, "push");
  showToast("Projectを作成しました");
}, "作成");

function openRenameProjectDialog() {
  const project = state.snapshot?.project;
  if (!project) return;
  openDialog("Project名を変更", [
    { name: "name", label: "Project名", value: project.record.name },
    { name: "reason", label: "変更理由", required: false, placeholder: "任意" },
  ], async values => {
    const name = requireText(values.name, "Project名");
    const params = {
      id: project.record.id,
      revision: project.revision,
      patch: { name },
    };
    if (values.reason?.trim()) params.reason = values.reason.trim();
    const updated = await perform("project.update", params);
    showToast(updated?.revision === project.revision ? "同じProject名のため変更はありませんでした" : "Project名を変更しました");
  }, "変更");
}

function openDeleteProjectDialog(project) {
  if (!project) return;
  openDialog("Projectを削除", [
    { name: "reason", label: "削除理由", placeholder: "例：完了したProjectを一覧から除外する" },
  ], async values => {
    const reason = requireText(values.reason, "削除理由");
    await api("project.delete", {
      id: project.record.id,
      revision: project.revision,
      reason,
    });
    clearError();
    closeDetailModal({ sync: false });
    closePanelModal({ sync: false });
    await loadProjects(null, null, "replace");
    showToast("Projectを論理削除しました");
  }, "削除する", container => {
    const box = node("div", "danger-callout",
      `対象Project「${project.record.name}」と配下の記録を一覧から除外します。履歴と依存参照は保持されます。すべてのTask・Ticketが完了または中止の場合のみ削除できます。`);
    container.prepend(box);
  }, { danger: true });
}

/* --- Custom Icon Key CRUD --- */
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("ファイルの読み込みに失敗しました。"));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("ファイルの読み込みに失敗しました。"));
    reader.readAsText(file, "utf-8");
  });
}

function openCustomIconDialog(existingKey = null) {
  const isEdit = Boolean(existingKey && Object.hasOwn(state.customIcons, existingKey));
  const current = isEdit ? state.customIcons[existingKey] : null;
  let sourceMode = current?.kind === "upload" ? "upload" : "preset";
  let selectedPreset = current && current.kind !== "upload" && isSafeIconSource(current.src)
    ? current.src
    : PRESET_ICON_ASSETS[0].path;
  let uploadedSrc = current?.kind === "upload" ? current.src : "";
  let uploadedName = current?.kind === "upload" ? (current.sourceName || "upload") : "";

  openDialog(
    isEdit ? "カスタムアイコンキーを編集" : "カスタムアイコンキーを追加",
    [
      {
        name: "icon_key",
        label: "キー名（必須・英数字と . - _ のみ）",
        value: isEdit ? existingKey : "",
        placeholder: "例：custom.deploy",
      },
      {
        name: "icon_label",
        label: "説明ラベル（任意）",
        required: false,
        value: current?.label || "",
        placeholder: "例：デプロイ・リリース作業",
      },
    ],
    async values => {
      const nextKey = String(values.icon_key || "").trim();
      const nextLabel = String(values.icon_label || "").trim().slice(0, 80);
      if (!isValidIconKey(nextKey)) {
        throw new Error("キー名は先頭英数字、英数字・ドット(.)・ハイフン(-)・アンダースコア(_)のみで64文字以内で指定してください。");
      }
      if (isStandardIconKey(nextKey)) {
        throw new Error(`標準アイコンキー「${nextKey}」は上書きできません。別のキー名を指定してください。`);
      }
      if ((!isEdit || nextKey !== existingKey) && Object.hasOwn(state.customIcons, nextKey)) {
        throw new Error(`カスタムアイコンキー「${nextKey}」はすでに登録されています。`);
      }

      const chosenSrc = sourceMode === "upload" ? uploadedSrc : selectedPreset;
      const chosenName = sourceMode === "upload"
        ? (uploadedName || (chosenSrc.startsWith("data:image/png") ? "upload.png" : "upload.svg"))
        : selectedPreset.split("/").pop();
      if (!isSafeIconSource(chosenSrc)) {
        throw new Error(sourceMode === "upload"
          ? "PNG または SVG ファイルを選択してください。"
          : "プリセット素材を選択してください。");
      }

      const nextIcons = { ...state.customIcons };
      if (isEdit && existingKey !== nextKey) {
        delete nextIcons[existingKey];
        if (state.filters.iconKeys.includes(existingKey)) {
          state.filters.iconKeys = state.filters.iconKeys.map(k => (k === existingKey ? nextKey : k));
        }
      }
      nextIcons[nextKey] = {
        label: nextLabel,
        src: chosenSrc,
        kind: sourceMode,
        sourceName: chosenName,
      };
      state.customIcons = nextIcons;
      saveCustomIcons();
      render();
      showToast(isEdit ? `アイコンキー「${nextKey}」を更新しました` : `アイコンキー「${nextKey}」を追加しました`);
    },
    isEdit ? "更新" : "追加",
    container => {
      const previewStrip = node("div", "icon-preview-strip");
      previewStrip.append(node("span", "field-label", "プレビュー（状態カラーリング内）"));
      const previewDots = node("div", "icon-preview-dots");
      previewStrip.append(previewDots);

      const renderPreview = () => {
        const activeSrc = sourceMode === "upload" ? uploadedSrc : selectedPreset;
        const previewKey = "__preview__";
        const tempMap = isSafeIconSource(activeSrc)
          ? { [previewKey]: { src: activeSrc, kind: sourceMode } }
          : {};
        const targetKey = isSafeIconSource(activeSrc) ? previewKey : "job";
        previewDots.replaceChildren(
          ...["todo", "doing", "completed", "blocked"].map(status =>
            createJobDot(
              { record: { status, objective: "プレビュー" }, display: { icon: targetKey } },
              { interactive: false, customIcons: tempMap },
            ),
          ),
        );
      };

      const modeSection = node("div", "field-label", "アイコン素材");
      const modeToggleWrap = node("div", "");
      const presetGrid = node("div", "icon-preset-grid");
      const uploadBox = node("div", "icon-upload-box");

      const renderPresetGrid = () => {
        presetGrid.replaceChildren(...PRESET_ICON_ASSETS.map(asset => {
          const isSelected = selectedPreset === asset.path;
          const btn = node("button", "icon-preset-btn" + (isSelected ? " is-selected" : ""));
          btn.type = "button";
          btn.dataset.presetPath = asset.path;
          btn.setAttribute("aria-pressed", String(isSelected));
          btn.append(svgIcon(asset.path, "sm"), node("span", "icon-preset-name", asset.label));
          btn.onclick = () => {
            selectedPreset = asset.path;
            renderPresetGrid();
            renderPreview();
          };
          return btn;
        }));
      };

      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = ".png,.svg,image/png,image/svg+xml";
      fileInput.id = "custom-icon-file-input";
      const uploadStatus = node(
        "span",
        "icon-upload-status",
        uploadedSrc ? `選択中: ${uploadedName}` : "未選択（128KB以内の PNG / SVG ファイル）",
      );
      const uploadHelper = node(
        "p",
        "helper",
        "ブラウザ内で読み込んで保存します。SVGの script / イベント属性 / 外部参照は自動的に除去されます。",
      );

      fileInput.onchange = async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const dialogError = $("dialog-error");
        dialogError.hidden = true;
        try {
          if (file.size > MAX_CUSTOM_ICON_BYTES) {
            throw new Error("ファイルサイズは128KB以内で指定してください。");
          }
          const lowerName = (file.name || "").toLowerCase();
          const isPng = file.type === "image/png" || lowerName.endsWith(".png");
          const isSvg = file.type === "image/svg+xml" || lowerName.endsWith(".svg");
          if (!isPng && !isSvg) {
            throw new Error("PNG または SVG ファイルのみアップロードできます。");
          }
          if (isPng) {
            const dataUrl = await readFileAsDataUrl(file);
            if (!isSafeIconSource(dataUrl) || !dataUrl.startsWith("data:image/png;base64,")) {
              throw new Error("PNGデータの形式が不正です。");
            }
            uploadedSrc = dataUrl;
            uploadedName = file.name || "upload.png";
          } else {
            const rawText = await readFileAsText(file);
            const cleanSvg = sanitizeSvgInBrowser(rawText);
            const dataUrl = "data:image/svg+xml;base64," + utf8ToBase64(cleanSvg);
            if (!isSafeIconSource(dataUrl)) {
              throw new Error("SVGデータの変換に失敗しました。");
            }
            uploadedSrc = dataUrl;
            uploadedName = file.name || "upload.svg";
          }
          uploadStatus.textContent = `読み込み済: ${uploadedName}（${Math.max(1, Math.round(file.size / 1024))}KB）`;
          renderPreview();
        } catch (err) {
          uploadedSrc = "";
          uploadedName = "";
          uploadStatus.textContent = "読み込みエラー";
          dialogError.textContent = err.message;
          dialogError.hidden = false;
          renderPreview();
        }
      };

      uploadBox.append(fileInput, uploadStatus, uploadHelper);

      const syncMode = () => {
        modeToggleWrap.replaceChildren(
          segmentedControl([
            ["preset", "同梱プリセットから選択"],
            ["upload", "PNG / SVG アップロード"],
          ], sourceMode, nextMode => {
            sourceMode = nextMode;
            syncMode();
          }),
        );
        presetGrid.hidden = sourceMode !== "preset";
        uploadBox.hidden = sourceMode !== "upload";
        renderPreview();
      };

      modeSection.append(modeToggleWrap, presetGrid, uploadBox);
      renderPresetGrid();
      syncMode();
      container.append(modeSection, previewStrip);
    },
  );
}

function openDeleteCustomIconDialog(key) {
  if (!Object.hasOwn(state.customIcons, key)) return;
  openDialog("カスタムアイコンキーを削除", [], async () => {
    const nextIcons = { ...state.customIcons };
    delete nextIcons[key];
    state.customIcons = nextIcons;
    state.filters.iconKeys = state.filters.iconKeys.filter(k => k !== key);
    saveCustomIcons();
    render();
    showToast(`アイコンキー「${key}」を削除しました`);
  }, "削除する", container => {
    container.append(node(
      "div",
      "danger-callout",
      `カスタムアイコンキー「${key}」を削除します。このキーを使用していたJobは標準アイコン（job）で表示されます。`,
    ));
  }, { danger: true });
}

/* --- Task CRUD --- */
function openNewTaskDialog() {
  openDialog("Taskを追加", [
    { name: "objective", label: "目標（タイトル・必須）", placeholder: "何を達成したいか" },
    { name: "summary", label: "カード補足メモ（任意・1行）", required: false, placeholder: "省略可：カード下段に表示する短い補足" },
    { name: "criteria", label: "完了条件（1行に1つ）", type: "textarea" },
    { name: "deadline", label: "期限（任意・例: 2026-12-31 18:00 または RFC3339）", required: false, placeholder: "2026-12-31 18:00" },
  ], async values => {
    const objective = requireText(values.objective, "目標（タイトル）");
    const criteria = requireLines(values.criteria, "完了条件");
    const record = { objective, criteria };
    const deadline = parseDeadlineInput(values.deadline);
    if (deadline) record.deadline = deadline;
    const params = { parent: state.projectId, record };
    if (values.summary?.trim()) params.display = { summary: values.summary.trim() };
    const task = await api("task.create", params);
    clearError();
    state.taskId = task.record.id;
    state.ticketId = null;
    await refresh(generation, "push");
    showToast("Taskを追加しました");
  }, "追加");
}

function openEditTaskDialog(task) {
  const rec = task.record;
  openDialog("Taskを編集", [
    { name: "objective", label: "目標（タイトル・必須）", value: rec.objective, placeholder: "何を達成したいか" },
    { name: "summary", label: "カード補足メモ（任意・1行）", required: false, value: task.display?.summary || "", placeholder: "省略可：カード下段に表示する短い補足" },
    { name: "criteria", label: "完了条件（1行に1つ）", type: "textarea", value: (rec.criteria || []).join("\n") },
    { name: "deadline", label: "期限（空欄で解除・例: 2026-12-31 18:00）", required: false, value: rec.deadline || "" },
    { name: "reason", label: "変更理由", placeholder: "例：目標と完了条件を明確にする" },
  ], async values => {
    const objective = requireText(values.objective, "目標（タイトル）");
    const criteria = requireLines(values.criteria, "完了条件");
    const reason = requireText(values.reason, "変更理由");
    const patch = {
      objective,
      criteria,
      deadline: parseDeadlineInput(values.deadline),
    };
    const params = {
      id: rec.id,
      revision: task.revision,
      patch,
      display: { summary: values.summary.trim() },
      reason,
    };
    const updated = await perform("task.update", params);
    showToast(updated?.revision === task.revision ? "同じ内容のため変更はありませんでした" : "Taskを更新しました");
  }, "保存");
}

function openCancelTaskDialog(task) {
  openDialog("Taskを中止", [
    { name: "reason", label: "中止理由", type: "textarea" },
    { name: "confirmed", label: "配下の未終了作業も中止されることを確認しました", type: "checkbox" },
  ], async values => {
    const reason = requireText(values.reason, "中止理由");
    await perform("status.set", {
      id: task.record.id,
      revision: task.revision,
      status: "canceled",
      reason,
    });
    showToast("Taskを中止しました");
  }, "中止する", null, { danger: true });
}

function openDeleteTaskDialog(task) {
  openDialog("Taskを論理削除", [
    { name: "reason", label: "削除理由", placeholder: "例：完了した作業を一覧から除外する" },
  ], async values => {
    const reason = requireText(values.reason, "削除理由");
    await perform("task.delete", {
      id: task.record.id,
      revision: task.revision,
      reason,
    });
    closeDetailModal({ historyMode: "replace" });
    showToast("Taskを論理削除しました");
  }, "論理削除する", container => {
    container.prepend(node("div", "danger-callout",
      `対象Task「${task.record.objective}」と配下のTicket・Jobを一覧から除外します。履歴と依存参照は保持されます。`));
  }, { danger: true });
}

function openPurgeTaskDialog(task) {
  openDialog("Taskを物理削除（完全削除）", [], async () => {
    const res = await perform("task.purge", {
      id: task.record.id,
      revision: task.revision,
    });
    closeDetailModal({ historyMode: "replace" });
    if (res?.storage === "pending") {
      showToast("Taskを削除しました（容量回収は保留中）");
    } else {
      showToast("Taskを完全削除しました");
    }
  }, "完全削除する", container => {
    container.append(
      node("div", "fixed-plan-box", ""),
      node("div", "danger-callout",
        "このTaskと配下のすべてのTicket・Job・Runを完全に削除します。元には戻せません。要約履歴とProjectのKnowledgeは残ります。他Taskから参照中の場合は削除できません。"),
    );
    const box = container.querySelector(".fixed-plan-box");
    box.append(node("strong", "", task.record.objective), node("small", "", task.record.id));
  }, { danger: true });
}

/* --- Ticket CRUD --- */
function buildDependsEditor(initialIds = [], excludeTicketId = null) {
  const editor = node("div", "dep-editor");
  const normalizedInitial = parseDependsInput(initialIds);

  const idsInput = document.createElement("textarea");
  idsInput.name = "depends_ids";
  idsInput.className = "dep-ids-input";
  idsInput.rows = 2;
  idsInput.placeholder = "例：tkt-xxxxxxxx-1, tkt-xxxxxxxx-2（カンマ・空白・改行区切りで直接入力可）";
  idsInput.value = normalizedInitial.join(", ");

  const helper = node(
    "p",
    "helper",
    "tkt-... ID を直接入力するか、下の現在Project内候補から選択できます（双方向連動・別ProjectのIDも入力可）。",
  );

  const list = node("div", "dep-checklist");
  const checkboxes = [];
  const selected = new Set(normalizedInitial);
  const candidates = allProjectTickets().filter(({ ticketEntry }) => ticketEntry.ticket.record.id !== excludeTicketId);

  const syncCheckboxesFromInput = () => {
    const idSet = new Set(parseDependsInput(idsInput.value));
    for (const cb of checkboxes) {
      cb.checked = idSet.has(cb.value);
    }
  };

  if (!candidates.length) {
    list.append(node("p", "helper", "このProject内に選択できる他のTicketがありません（上の入力欄へ別Projectの tkt-... ID を直接入力できます）。"));
  } else {
    for (const { ticketEntry } of candidates) {
      const rec = ticketEntry.ticket.record;
      const item = node("label", "dep-check-item");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = rec.id;
      cb.checked = selected.has(rec.id);
      cb.addEventListener("change", () => {
        const currentIds = parseDependsInput(idsInput.value);
        const nextIds = cb.checked
          ? (currentIds.includes(rec.id) ? currentIds : [...currentIds, rec.id])
          : currentIds.filter(id => id !== rec.id);
        idsInput.value = nextIds.join(", ");
      });
      checkboxes.push(cb);
      item.append(
        cb,
        statusBadge(rec.status),
        node("span", "dep-check-id", rec.id),
        node("span", "dep-check-sep", "·"),
        node("span", "dep-check-title", rec.objective),
      );
      list.append(item);
    }
  }

  idsInput.addEventListener("input", syncCheckboxesFromInput);
  editor.append(idsInput, helper, list);
  return editor;
}

function openNewTicketDialog(preferredTaskId = null) {
  const availableTasks = nonTerminalTasks();
  if (!availableTasks.length) {
    showError(new Error("先に未完了のTaskを作成してください。"));
    return;
  }
  const defaultTaskId = preferredTaskId && availableTasks.some(t => t.task.record.id === preferredTaskId)
    ? preferredTaskId
    : state.taskId && availableTasks.some(t => t.task.record.id === state.taskId)
      ? state.taskId
      : availableTasks[0].task.record.id;

  const activeSessionsFor = workerId => state.sessions.filter(s => s.record.worker_id === workerId && !s.record.ended);
  const preferredWorker = state.workers.find(w => activeSessionsFor(w.record.id).length > 0) || state.workers[0] || null;
  const defaultWorkerChoice = preferredWorker ? preferredWorker.record.id : "__new__";

  let workerSelectEl = null;
  let newWorkerWrapEl = null;
  let newWorkerInputEl = null;
  let sessionSelectEl = null;
  let sessionHelperEl = null;

  const populateWorkerAndSessionOptions = (selectedWorker = defaultWorkerChoice) => {
    if (!workerSelectEl || !sessionSelectEl) return;
    const workerOpts = [
      ...state.workers.map(w => ({
        value: w.record.id,
        label: `${w.record.name} (${w.record.id})`,
      })),
      { value: "__new__", label: "＋ 新しい Worker を作成..." },
    ];
    workerSelectEl.replaceChildren(...workerOpts.map(opt => {
      const el = node("option", "", opt.label);
      el.value = opt.value;
      return el;
    }));
    const validWorker = workerOpts.some(o => o.value === selectedWorker) ? selectedWorker : "__new__";
    workerSelectEl.value = validWorker;

    const isNewWorker = validWorker === "__new__";
    if (newWorkerWrapEl) newWorkerWrapEl.hidden = !isNewWorker;
    if (newWorkerInputEl) newWorkerInputEl.required = isNewWorker;

    if (isNewWorker) {
      sessionSelectEl.replaceChildren((() => {
        const el = node("option", "", "自動で新しい Session を作成（確定時に自動発行）");
        el.value = "__auto_new__";
        return el;
      })());
      sessionSelectEl.value = "__auto_new__";
      if (sessionHelperEl) {
        sessionHelperEl.textContent = "確定時に新しい Worker と Session を自動作成して Ticket に割り当てます。";
      }
      return;
    }

    const active = activeSessionsFor(validWorker);
    const sessionOpts = active.length
      ? [
        { value: "__auto__", label: `自動（稼働中 Session を使用: ${active[0].record.id}）` },
        { value: "__auto_new__", label: "新しい Session を自動作成" },
        ...active.map(s => ({ value: s.record.id, label: `既存 Session を使用: ${s.record.id}` })),
      ]
      : [
        { value: "__auto__", label: "自動で新しい Session を作成（未終了 Session なし）" },
      ];
    sessionSelectEl.replaceChildren(...sessionOpts.map(opt => {
      const el = node("option", "", opt.label);
      el.value = opt.value;
      return el;
    }));
    sessionSelectEl.value = "__auto__";
    if (sessionHelperEl) {
      sessionHelperEl.textContent = active.length
        ? "既定の「自動」のまま確定できます。新規 Session の自動作成や既存 Session の選択も可能です。"
        : "選択した Worker に未終了 Session がないため、確定時に新しい Session を自動作成します。";
    }
  };

  openDialog("Ticketを追加", [
    {
      name: "task_id",
      label: "所属Task",
      type: "select",
      value: defaultTaskId,
      options: availableTasks.map(entry => ({
        value: entry.task.record.id,
        label: entry.task.record.objective,
      })),
    },
    { name: "objective", label: "目標（タイトル・必須）", placeholder: "何を達成したいか" },
    { name: "summary", label: "カード補足メモ（任意・1行）", required: false, placeholder: "省略可：カード下段に表示する短い補足" },
    { name: "resume", label: "再開条件（任意）", required: false, placeholder: "待機・保留から再開する条件" },
  ], async (values, formEl) => {
    const ticketObjective = requireText(values.objective, "Ticketの目標（タイトル）");
    const jobs = [...formEl.querySelectorAll("[data-job-plan]")].map((group, idx) => {
      const iconValue = group.querySelector('[name="job-icon"]').value || "job";
      const instructionsValue = group.querySelector('[name="job-instructions"]').value.trim();
      const jobObjective = requireText(group.querySelector('[name="job-objective"]').value, `Job ${idx + 1} の目標（タイトル）`);
      const jobCriteria = requireLines(group.querySelector('[name="job-criteria"]').value, `Job ${idx + 1} の完了条件`);
      const jobRecord = {
        objective: jobObjective,
        criteria: jobCriteria,
        display: { icon: iconValue },
      };
      if (instructionsValue) jobRecord.instructions = instructionsValue;
      return jobRecord;
    });

    let workerId = values.worker_choice || "__new__";
    let sessionId = null;
    let createdWorker = false;
    let createdSession = false;

    if (workerId === "__new__") {
      const newWorkerName = String(values.new_worker_name || "").trim();
      if (!newWorkerName) {
        throw new Error("新しい Worker の名前を入力してください。");
      }
      const wRes = await api("worker.create", { record: { name: newWorkerName } });
      workerId = wRes.record.id;
      createdWorker = true;
      const sRes = await api("session.create", { record: { worker_id: workerId } });
      sessionId = sRes.record.id;
      createdSession = true;
    } else {
      const choice = values.session_choice || "__auto__";
      const active = activeSessionsFor(workerId);
      if (choice === "__auto_new__" || (choice === "__auto__" && !active.length)) {
        const sRes = await api("session.create", { record: { worker_id: workerId } });
        sessionId = sRes.record.id;
        createdSession = true;
      } else if (choice === "__auto__") {
        sessionId = active[0].record.id;
      } else {
        const matched = active.find(s => s.record.id === choice);
        if (matched) {
          sessionId = matched.record.id;
        } else {
          const sRes = await api("session.create", { record: { worker_id: workerId } });
          sessionId = sRes.record.id;
          createdSession = true;
        }
      }
    }

    if (createdWorker || createdSession) {
      await loadPeople();
      populateWorkerAndSessionOptions(workerId);
      if (sessionSelectEl && sessionId) {
        const hasOpt = [...sessionSelectEl.options].some(o => o.value === sessionId);
        if (hasOpt) sessionSelectEl.value = sessionId;
      }
    }

    const depends = parseDependsInput(values.depends_ids);
    const record = {
      task_id: values.task_id,
      worker_id: workerId,
      session_id: sessionId,
      objective: ticketObjective,
      jobs,
    };
    if (depends.length) record.depends = depends;
    if (values.resume?.trim()) record.resume = values.resume.trim();
    const params = { record };
    if (values.summary?.trim()) params.display = { summary: values.summary.trim() };
    const ticket = await api("ticket.create", params);
    clearError();
    state.taskId = values.task_id;
    state.ticketId = ticket.record.id;
    await refresh(generation, "push");
    if (createdWorker && createdSession) {
      showToast("Ticketを追加しました（Worker・Sessionを自動作成）");
    } else if (createdSession) {
      showToast("Ticketを追加しました（Sessionを自動作成）");
    } else {
      showToast("Ticketを追加しました");
    }
  }, "作業計画を確定", container => {
    const assigneeBox = node("div", "assignee-box");
    const workerLabel = node("label", "", "担当 Worker");
    workerSelectEl = document.createElement("select");
    workerSelectEl.name = "worker_choice";
    workerSelectEl.required = true;
    workerLabel.append(workerSelectEl);

    newWorkerWrapEl = node("label", "assignee-new-worker", "新しい Worker の名前（必須）");
    newWorkerInputEl = document.createElement("input");
    newWorkerInputEl.type = "text";
    newWorkerInputEl.name = "new_worker_name";
    newWorkerInputEl.placeholder = "例：ローカル作業者";
    newWorkerWrapEl.append(newWorkerInputEl);

    const sessionLabel = node("label", "", "担当 Session（既定で自動作成・自動割当）");
    sessionSelectEl = document.createElement("select");
    sessionSelectEl.name = "session_choice";
    sessionSelectEl.required = true;
    sessionLabel.append(sessionSelectEl);

    sessionHelperEl = node("p", "helper", "");

    assigneeBox.append(workerLabel, newWorkerWrapEl, sessionLabel, sessionHelperEl);
    workerSelectEl.addEventListener("change", () => {
      populateWorkerAndSessionOptions(workerSelectEl.value);
    });
    populateWorkerAndSessionOptions(defaultWorkerChoice);

    const summaryLabel = container.querySelector('[name="summary"]')?.closest("label");
    if (summaryLabel) summaryLabel.after(assigneeBox);
    else container.append(assigneeBox);

    const depSec = node("div", "field-label", "先行Ticket（depends · 任意・tkt ID 指定）");
    depSec.append(buildDependsEditor([], null));
    container.append(depSec);

    const plans = node("div", "modal-row-list");
    container.append(node("p", "helper", "Jobは上から順に進めます。各Jobのアイコンキーを指定できます。"), plans);
    const add = node("button", "btn secondary sm", "Jobを追加");
    add.type = "button";
    const iconOptions = allJobIconOptions(state.customIcons);
    function addPlan() {
      const group = node("div", "job-plan");
      group.dataset.jobPlan = "";
      const heading = node("div", "plan-heading");
      heading.append(node("span", "", `Job ${plans.children.length + 1}`));
      const remove = node("button", "btn danger sm", "削除");
      remove.type = "button";
      remove.onclick = () => { if (plans.children.length > 1) group.remove(); };
      heading.append(remove);
      group.append(
        heading,
        field({ name: "job-objective", label: "目標（タイトル・必須）", placeholder: "何を達成したいか" }),
        field({ name: "job-icon", label: "アイコンキー", type: "select", value: "job", options: iconOptions }),
        field({ name: "job-instructions", label: "手順（任意）", type: "textarea", required: false }),
        field({ name: "job-criteria", label: "Jobの完了条件（1行に1つ）", type: "textarea" }),
      );
      plans.append(group);
    }
    add.onclick = addPlan;
    container.append(add);
    addPlan();
  });
}

function openEditTicketDialog(ticket) {
  const rec = ticket.record;
  const initialDepends = parseDependsInput(rec.depends || []);
  openDialog("Ticketを編集", [
    { name: "summary", label: "カード補足メモ（任意・1行）", required: false, value: ticket.display?.summary || "", placeholder: "省略可：カード下段に表示する短い補足" },
    { name: "resume", label: "再開条件（空欄で解除）", required: false, value: rec.resume || "" },
    {
      name: "refs",
      label: "関連参照 refs（1行に1件: tkt-ID | 種別 | メモ）",
      type: "textarea",
      required: false,
      value: formatRefsForTextarea(rec.refs),
      placeholder: "tkt-xxxxxxxx-1 | related | 参照メモ",
    },
    {
      name: "artifacts",
      label: "成果物 artifacts（1行に1件・任意）",
      type: "textarea",
      required: false,
      value: (rec.artifacts || []).join("\n"),
    },
    { name: "reason", label: "変更理由", placeholder: "例：依存・再開条件を更新する" },
  ], async values => {
    const reason = requireText(values.reason, "変更理由");
    const nextDepends = parseDependsInput(values.depends_ids);
    if (nextDepends.includes(rec.id)) {
      throw new Error("自分自身を先行Ticketに指定することはできません。");
    }
    const dependsChanged = nextDepends.length !== initialDepends.length
      || nextDepends.some((id, idx) => id !== initialDepends[idx]);
    const patch = {
      resume: values.resume.trim() || null,
      refs: parseRefsTextarea(values.refs),
      artifacts: lines(values.artifacts),
    };
    if (!ticket.started || dependsChanged) {
      patch.depends = nextDepends;
    }
    const updated = await perform("ticket.update", {
      id: rec.id,
      revision: ticket.revision,
      patch,
      display: { summary: values.summary.trim() },
      reason,
    });
    showToast(updated?.revision === ticket.revision ? "同じ内容のため変更はありませんでした" : "Ticketを更新しました");
  }, "保存", container => {
    const fixedBox = node("div", "fixed-plan-box");
    fixedBox.append(
      node("strong", "", rec.objective),
      node("small", "", "目標・担当・Job構成は作成後に固定されます。"),
    );
    container.prepend(fixedBox);

    const depSec = node("div", "field-label", "先行Ticket（depends · 空欄で依存解除）");
    if (ticket.started) {
      depSec.append(node("p", "helper", "※ 着手済みのTicketはTTJCoreの制約により先行Ticketの変更が拒否される場合があります。"));
    }
    depSec.append(buildDependsEditor(initialDepends, rec.id));
    fixedBox.after(depSec);
  });
}

function openDeleteTicketDialog(ticket) {
  openDialog("Ticketを論理削除", [
    { name: "reason", label: "削除理由", placeholder: "例：完了したTicketを一覧から除外する" },
  ], async values => {
    const reason = requireText(values.reason, "削除理由");
    await perform("ticket.delete", {
      id: ticket.record.id,
      revision: ticket.revision,
      reason,
    });
    closeDetailModal({ historyMode: "replace" });
    showToast("Ticketを論理削除しました");
  }, "論理削除する", container => {
    container.prepend(node("div", "danger-callout",
      `対象Ticket「${ticket.record.objective}」と配下のJobを一覧から除外します。履歴と依存参照は保持されます。`));
  }, { danger: true });
}

/* --- Status & Run Dialogs --- */
function openCompletionDialog(row, label) {
  openDialog(label + "を完了", [
    { name: "result", label: "確認した成果・結果", type: "textarea", placeholder: "達成条件をどのように確認したか記入してください" },
    { name: "verified", label: "達成条件をすべて確認しました", type: "checkbox" },
  ], async values => {
    const result = requireText(values.result, "確認した成果・結果");
    await perform("status.set", { id: row.record.id, revision: row.revision, status: "completed", criteria_met: true, result });
    showToast(`${label}を完了しました`);
  }, "完了を記録");
}

function openPauseTaskDialog(task) {
  const release = task.record.status === "paused";
  const target = release
    ? task.constraints?.blocked ? "blocked" : task.constraints?.waiting ? "waiting" : task.started ? "doing" : "todo"
    : "paused";
  openDialog(release ? "保留を解除" : "Taskを保留", [{ name: "reason", label: "判断の理由", type: "textarea" }], async values => {
    const reason = requireText(values.reason, "判断の理由");
    await perform("status.set", { id: task.record.id, revision: task.revision, status: target, release, reason });
    showToast(release ? "保留を解除しました" : "Taskを保留にしました");
  }, release ? "解除" : "保留");
}

async function startRunFlow(liveDetail, ticketId, triggerBtn) {
  const job = liveDetail.job;
  const start = async safety => {
    const trimmedSafety = typeof safety === "string" ? safety.trim() : "";
    await perform("run.start", {
      job: job.record.id,
      revision: job.revision,
      ...(trimmedSafety ? { safety: trimmedSafety } : {}),
    }, ticketId);
    resetProgressDraft();
    showToast("Runを開始しました");
  };
  const retry = (job.record.runs || []).length > 0;
  const needsSafety = (liveDetail.ticket.record.jobs || []).some(item => (item.runs || []).length > 0);
  if (needsSafety) {
    openDialog(
      retry ? "Runを再試行" : "次のJobのRunを開始",
      [{ name: "safety", label: "前回実行の停止・残存する副作用の安全確認", type: "textarea" }],
      values => start(requireText(values.safety, "安全確認の内容")),
      retry ? "再試行" : "Runを開始",
    );
  } else {
    triggerBtn.disabled = true;
    try {
      await start();
    } catch (error) {
      showError(error);
      await refresh(generation, "replace").catch(() => {});
    } finally {
      triggerBtn.disabled = false;
    }
  }
}

function openFinishRunDialog(run, ticketId) {
  openDialog("Runを終了", [{
    name: "result",
    label: "今回の試行結果",
    type: "select",
    options: [
      { value: "succeeded", label: "succeeded — 試行成功" },
      { value: "failed", label: "failed — 試行失敗" },
      { value: "interrupted", label: "interrupted — 中断" },
    ],
  }], async values => {
    await perform("run.finish", { id: run.record.id, revision: run.revision, result: values.result }, ticketId);
    resetProgressDraft();
    showToast("Runを終了しました");
  }, "終了を記録");
}

function openCancelTicketDialog(ticket) {
  openDialog("Ticketを中止", [
    { name: "reason", label: "中止理由", type: "textarea" },
    { name: "confirmed", label: "実行側で必要な停止・安全確認を行います", type: "checkbox" },
  ], async values => {
    const reason = requireText(values.reason, "中止理由");
    await perform("status.set", {
      id: ticket.record.id,
      revision: ticket.revision,
      status: "canceled",
      cancel_reason: reason,
      reason,
    });
    showToast("Ticketを中止しました");
  }, "中止", null, { danger: true });
}

/* --- Knowledge CRUD --- */
function openCreateKnowledgeDialog(supersedingEntry = null) {
  const title = supersedingEntry ? "新しい知識で置換" : "記録・知識を作成";
  openDialog(title, [
    { name: "content", label: "内容", type: "textarea", placeholder: "Projectで共有する決定事項・制約・知見" },
    { name: "basis", label: "根拠", type: "textarea", placeholder: "判断の理由や確認結果" },
    { name: "reason", label: "変更理由", placeholder: supersedingEntry ? "例：新しい方針へ更新する" : "例：検証方針を記録する" },
  ], async values => {
    const content = requireText(values.content, "内容");
    const basis = requireText(values.basis, "根拠");
    const reason = requireText(values.reason, "変更理由");
    const record = { content, basis };
    if (supersedingEntry) record.supersedes = supersedingEntry.record.id;
    const created = await perform("knowledge.create", {
      parent: state.projectId,
      record,
      reason,
    });
    if (supersedingEntry) state.knowledgeCache.delete(supersedingEntry.record.id);
    if (panelState.open) {
      openKnowledgeDetail(created.record.id, { historyMode: "push" });
    }
    showToast(supersedingEntry ? "新しい知識へ置換しました" : "記録・知識を作成しました");
  }, supersedingEntry ? "置換して作成" : "作成", container => {
    if (supersedingEntry) {
      const box = node("div", "fixed-plan-box");
      box.append(
        node("strong", "", "置換元の記録は自動的に「過去」になります"),
        node("small", "", `${supersedingEntry.record.id} · ${String(supersedingEntry.record.content || "").split(/\r?\n/)[0]}`),
      );
      container.prepend(box);
    }
  });
}

function openUpdateKnowledgeStatusDialog(entry, targetStatus) {
  const toPast = targetStatus === "supersed";
  openDialog(toPast ? "記録を過去にする" : "記録を再採用する", [
    { name: "reason", label: "変更理由", placeholder: toPast ? "例：方針変更により過去化する" : "例：現行方針として再採用する" },
  ], async values => {
    const reason = requireText(values.reason, "変更理由");
    const updated = await perform("knowledge.update", {
      id: entry.record.id,
      revision: entry.revision,
      patch: { status: targetStatus },
      reason,
    });
    if (updated?.record) {
      state.knowledgeCache.set(entry.record.id, updated);
    } else {
      state.knowledgeCache.delete(entry.record.id);
    }
    if (panelState.open && panelState.mode === "knowledge-detail" && panelState.knowledgeId === entry.record.id) {
      renderPanelModal();
    }
    showToast(toPast ? "過去にしました" : "再採用しました");
  }, toPast ? "過去にする" : "再採用する");
}

function openDeleteKnowledgeDialog(entry) {
  openDialog("過去の記録・知識を削除", [
    { name: "reason", label: "削除理由", placeholder: "例：不要になった過去の記録を削除する" },
  ], async values => {
    const reason = requireText(values.reason, "削除理由");
    await perform("knowledge.delete", {
      id: entry.record.id,
      revision: entry.revision,
      reason,
    });
    state.knowledgeCache.delete(entry.record.id);
    if (panelState.open) {
      openPanelModal("knowledge", { historyMode: "replace" });
    }
    showToast("記録・知識を削除しました");
  }, "削除する", container => {
    container.prepend(node("div", "danger-callout", "過去の記録・知識を一覧から除外します。採用中の記録は先に「過去にする」必要があります。"));
  }, { danger: true });
}

/* --- Worker / Session CRUD --- */
function openCreateWorkerDialog() {
  openDialog("Worker（作業主体）を追加", [
    { name: "name", label: "担当者の名前", placeholder: "例：ローカル作業者" },
    { name: "withSession", label: "同時に作業Sessionも作成する", type: "checkbox", required: false, checked: true },
  ], async (values, formEl) => {
    const name = requireText(values.name, "担当者の名前");
    const worker = await api("worker.create", { record: { name } });
    if (formEl.querySelector('input[name="withSession"]')?.checked) {
      await api("session.create", { record: { worker_id: worker.record.id } });
    }
    clearError();
    await loadPeople();
    render();
    showToast("Workerを登録しました");
  }, "追加");
}

function openRenameWorkerDialog(worker) {
  openDialog("Worker名を変更", [
    { name: "name", label: "新しい名前", value: worker.record.name },
    { name: "reason", label: "変更理由", required: false, placeholder: "任意" },
  ], async values => {
    const name = requireText(values.name, "新しい名前");
    const params = {
      id: worker.record.id,
      revision: worker.revision,
      patch: { name },
    };
    if (values.reason?.trim()) params.reason = values.reason.trim();
    const updated = await api("worker.update", params);
    clearError();
    await loadPeople();
    render();
    showToast(updated?.revision === worker.revision ? "同じWorker名のため変更はありませんでした" : "Worker名を変更しました");
  }, "変更");
}

function openDeleteWorkerDialog(worker) {
  openDialog("Workerを削除", [
    { name: "reason", label: "削除理由", placeholder: "例：未使用のWorkerを削除する" },
  ], async values => {
    const reason = requireText(values.reason, "削除理由");
    await api("worker.delete", {
      id: worker.record.id,
      revision: worker.revision,
      reason,
    });
    clearError();
    await loadPeople();
    render();
    showToast("Workerを削除しました");
  }, "削除する", container => {
    container.prepend(node("div", "danger-callout",
      `Worker「${worker.record.name}」を削除します。SessionやTicketから参照されている場合は削除できません。`));
  }, { danger: true });
}

function openCreateSessionDialog() {
  openDialog("Session（作業枠）を追加", [
    {
      name: "worker_id",
      label: "所属Worker",
      type: "select",
      options: state.workers.map(w => ({ value: w.record.id, label: `${w.record.name} (${w.record.id})` })),
    },
  ], async values => {
    await api("session.create", { record: { worker_id: values.worker_id } });
    clearError();
    await loadPeople();
    render();
    showToast("Sessionを作成しました");
  }, "追加");
}

function openEndSessionDialog(session) {
  openDialog("Sessionの終了を記録", [
    { name: "reason", label: "終了理由", placeholder: "例：作業区切りのためSessionを終了する" },
  ], async values => {
    const reason = requireText(values.reason, "終了理由");
    await api("session.update", {
      id: session.record.id,
      revision: session.revision,
      patch: { ended: new Date().toISOString() },
      reason,
    });
    clearError();
    await loadPeople();
    render();
    showToast("Sessionを終了しました");
  }, "終了を記録", container => {
    container.prepend(node("p", "helper", `Session ${session.record.id}（${workerName(session.record.worker_id)}）に現在時刻の終了を記録します。終了後は再開できません。`));
  });
}

function openDeleteSessionDialog(session) {
  openDialog("Sessionを削除", [
    { name: "reason", label: "削除理由", placeholder: "例：未使用のSessionを削除する" },
  ], async values => {
    const reason = requireText(values.reason, "削除理由");
    await api("session.delete", {
      id: session.record.id,
      revision: session.revision,
      reason,
    });
    clearError();
    await loadPeople();
    render();
    showToast("Sessionを削除しました");
  }, "削除する", container => {
    container.prepend(node("div", "danger-callout",
      `Session「${session.record.id}」を削除します。Ticketから参照されている場合は削除できません。`));
  }, { danger: true });
}

/* ================================
   Event Wiring
   ================================ */
$("new-project").onclick = openNewProject;
$("welcome-create").onclick = openNewProject;
$("new-task").onclick = openNewTaskDialog;
$("new-ticket").onclick = () => openNewTicketDialog();
$("manage-people").onclick = () => openPeoplePanel();
$("open-knowledge").onclick = () => {
  if (!state.projectId) return;
  openPanelModal("knowledge");
};
$("open-settings").onclick = () => openPanelModal("settings");

$("refresh").onclick = async () => {
  try {
    await loadPeople();
    state.projects = (await api("project.list")).items;
    await (state.projectId ? refresh(generation, "replace") : loadProjects(null, null, "replace"));
    showToast("最新の状態を読み込みました");
  } catch (error) {
    showError(error);
  }
};

/* Filter popover interactions */
$("filter-popover").addEventListener("click", event => event.stopPropagation());
$("filter-btn").onclick = event => {
  event.stopPropagation();
  if (filterPopoverOpen) closeFilterPopover();
  else openFilterPopover();
};
$("filter-close").onclick = closeFilterPopover;
$("filter-reset").onclick = resetFilters;

$("filter-work-only-check").onchange = event => {
  if (!state.projectId) return;
  state.filters.workOnly = Boolean(event.target.checked);
  saveWorkOnly(state.projectId, state.filters.workOnly);
  if (!canvasView.userControlled) canvasView.initialized = false;
  render();
};

$("filter-worker-select").onchange = event => {
  state.filters.workerId = event.target.value || "";
  if (!canvasView.userControlled) canvasView.initialized = false;
  render();
};

$("filter-query-input").oninput = event => {
  state.filters.query = event.target.value || "";
  if (!canvasView.userControlled) canvasView.initialized = false;
  render();
};

document.addEventListener("click", event => {
  if (!filterPopoverOpen) return;
  const pop = $("filter-popover");
  const btn = $("filter-btn");
  if (!pop.contains(event.target) && !btn.contains(event.target)) {
    closeFilterPopover();
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && filterPopoverOpen) {
    closeFilterPopover();
  }
});

let lastCompactListMode = isOrcaPanelMode() || window.innerWidth <= 480;
window.addEventListener("resize", () => {
  if (filterPopoverOpen) positionFilterPopover();
  refreshHScrollBars();
  const nextCompact = isOrcaPanelMode() || window.innerWidth <= 480;
  if (nextCompact !== lastCompactListMode) {
    lastCompactListMode = nextCompact;
    if (state.view === "list" && state.snapshot) renderList();
  }
});

$("tree-dir-toggle").onclick = () => {
  setTreeDirection(state.treeDirection === "vertical" ? "horizontal" : "vertical", { persist: true, historyMode: "push", refit: true });
};
$("zoom-out").onclick = () => canvasController?.zoomOut();
$("zoom-in").onclick = () => canvasController?.zoomIn();
$("zoom-fit").onclick = () => canvasController?.fit();
$("zoom-reset").onclick = () => canvasController?.reset();

$("theme-toggle").onclick = () => applyTheme(state.resolvedTheme === "dark" ? "light" : "dark");

systemColorScheme?.addEventListener?.("change", () => {
  if (state.themeMode === "system") applyTheme("system");
});

/* Detail Modal close / back / backdrop */
$("detail-close").onclick = () => closeDetailModal({ historyMode: "push" });
$("detail-back").onclick = () => {
  const prev = modalState.backStack.pop();
  if (!prev) {
    closeDetailModal({ historyMode: "push" });
    return;
  }
  setDetailError(null);
  if (modalState.ticketId !== prev.ticketId) resetProgressDraft();
  modalState.kind = prev.kind;
  modalState.id = prev.id;
  modalState.taskId = prev.taskId;
  modalState.ticketId = prev.ticketId;
  state.taskId = prev.taskId;
  state.ticketId = prev.ticketId;
  syncUrl("push");
  renderDetailModal();
  if (prev.kind === "ticket" && prev.ticketId) fetchTicketDetail(prev.ticketId).catch(showError);
};

$("detail-modal").addEventListener("close", () => {
  const wasOpen = modalState.open;
  modalState.open = false;
  modalState.kind = null;
  modalState.id = null;
  modalState.taskId = null;
  modalState.ticketId = null;
  modalState.backStack = [];
  setDetailError(null);
  resetProgressDraft();
  restoreToastHost();
  if (wasOpen) syncUrl("push");
});

$("detail-modal").addEventListener("click", event => {
  if (event.target === $("detail-modal")) closeDetailModal({ historyMode: "push" });
});

/* Panel Modal close / backdrop */
$("panel-close").onclick = () => closePanelModal({ historyMode: "push" });
$("panel-modal").addEventListener("close", () => {
  const wasOpen = panelState.open;
  panelState.open = false;
  panelState.mode = null;
  panelState.knowledgeId = null;
  panelState.knowledgeLoading = false;
  panelState.knowledgeFallback = null;
  setPanelError(null);
  restoreToastHost();
  if (wasOpen) syncUrl("push");
});
$("panel-modal").addEventListener("click", event => {
  if (event.target === $("panel-modal")) closePanelModal({ historyMode: "push" });
});

/* Form Dialog close / backdrop */
$("close-dialog").onclick = $("cancel-dialog").onclick = () => $("dialog").close();
$("dialog").addEventListener("close", () => {
  restoreToastHost();
});
$("dialog").addEventListener("click", event => {
  if (event.target === $("dialog")) $("dialog").close();
});

window.addEventListener("popstate", () => {
  if (isOrcaPanelMode()) return;
  const route = parseRoute(location.href);
  state.view = route.view;
  const nextDir = route.dir || loadSavedTreeDirection() || defaultTreeDirection();
  if (nextDir !== state.treeDirection) {
    state.treeDirection = nextDir;
    state.treeDirectionExplicit = Boolean(route.dir || loadSavedTreeDirection());
    canvasView.initialized = false;
    canvasView.userControlled = false;
  }
  if (route.projectId && route.projectId !== state.projectId && state.projects.some(p => p.record.id === route.projectId)) {
    selectProject(route.projectId, { taskId: route.taskId, ticketId: route.ticketId }, "none")
      .then(() => applyRouteModal(route, { historyMode: "none" }))
      .catch(showError);
    return;
  }
  state.taskId = route.taskId;
  state.ticketId = route.ticketId;
  applyRouteModal(route, { historyMode: "none" }).catch(showError);
  render();
});

/* Bootstrap & Host Integration Hooks */
state.customIcons = loadCustomIcons();
state.timeZone = loadTimeZone();
applyTheme(loadThemeMode(), { persist: false });
initHScrollBars();

async function bootstrapApp() {
  try {
    const meta = await fetchMeta();
    if (meta && meta.disabled) {
      connected(false);
      return { ok: false, disabled: true };
    }
    state.config = {
      actor: "ttjweb",
      protocol: "TTJ/1.1.0",
      watch_prefix: "ttjcore",
      allowHosts: [],
      readOnly: false,
      authEnabled: false,
      ...(meta || {}),
    };
    await loadPeople();
    await loadProjects(
      state.projectId || initialRoute.projectId,
      { taskId: initialRoute.taskId, ticketId: initialRoute.ticketId },
      "none",
    );
    clearError();
    connected(true);
    await applyRouteModal(initialRoute, { historyMode: "replace" });
    return { ok: true };
  } catch (error) {
    connected(false);
    showError(error);
    render();
    return { ok: false, error };
  }
}

async function refreshNow({ silent = true } = {}) {
  try {
    const meta = await fetchMeta();
    if (meta && meta.disabled) {
      connected(false);
      return { ok: false, disabled: true };
    }
    if (meta) {
      state.config = { ...state.config, ...meta };
    }
    await loadPeople();
    state.projects = (await api("project.list")).items;
    await (state.projectId ? refresh(generation, "replace") : loadProjects(null, null, "replace"));
    clearError();
    connected(true);
    if (!silent) showToast("最新の状態を読み込みました");
    return { ok: true };
  } catch (error) {
    connected(false);
    if (!silent) showError(error);
    return { ok: false, error };
  }
}

function pauseApp() {
  generation++;
  watchAbort?.abort();
  watchAbort = null;
  connected(false);
}

function applyExternalTheme(scheme) {
  if (scheme !== "dark" && scheme !== "light") return;
  externalThemeScheme = scheme;
  if (state.themeMode === "system") {
    applyTheme("system", { persist: false });
  }
}

window.TTJ_APP = {
  start: bootstrapApp,
  reload: bootstrapApp,
  refreshNow,
  pause: pauseApp,
  applyExternalTheme,
  showToast,
  setTreeDirection,
  getRouteUrl: () => routeUrl(currentRouteState()),
  getState: () => ({
    view: state.view,
    treeDirection: state.treeDirection,
    projectId: state.projectId,
    taskId: state.taskId,
    ticketId: state.ticketId,
    route: currentRouteState(),
    readOnly: isReadOnly(),
    themeMode: state.themeMode,
    resolvedTheme: state.resolvedTheme,
  }),
};

if (!getBridge()?.deferBootstrap) {
  bootstrapApp();
}
