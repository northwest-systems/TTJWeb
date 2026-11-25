(() => {
  const pluginState = {
    enabled: true,
    backendMode: "server",
    serverUrl: "http://127.0.0.1:8878",
    autoRefreshSeconds: 10,
    mobileUrl: "",
    serverWorkdir: "",
    serverAllowHosts: "",
    serverReadOnly: false,
    corePath: "",
    homePath: "",
    wslDistro: "",
    connected: false,
    lastError: null,
  };

  let serverStatus = null;
  let activeDrawer = null; // null | "server" | "mobile"
  let serverBusy = false;
  let tailscaleBusy = false;
  let configFormDirty = false;
  let qrModulePromise = null;
  let copyFeedbackTimer = null;

  let refreshTimer = null;
  let startedOnce = false;
  let busy = false;

  const $ = id => document.getElementById(id);

  function requireOrca() {
    if (!window.orca || !window.orca.plugin || typeof window.orca.plugin.request !== "function") {
      throw new Error("Orca プラグインブリッジが利用できません。");
    }
    return window.orca;
  }

  function loadQrModule() {
    if (!qrModulePromise) {
      qrModulePromise = import("./qrcode.mjs");
    }
    return qrModulePromise;
  }

  function detectOrcaColorScheme(payload) {
    if (payload && (payload.colorScheme === "dark" || payload.colorScheme === "light")) {
      return payload.colorScheme;
    }
    if (payload && (payload.mode === "dark" || payload.mode === "light")) {
      return payload.mode;
    }
    if (document.documentElement.classList.contains("dark")) return "dark";
    if (document.documentElement.classList.contains("light")) return "light";
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  }

  function syncDisabledIcon(scheme) {
    const img = $("orca-disabled-icon");
    if (!img) return;
    img.src = scheme === "dark" ? "./vendor/assets/app-icon.png" : "./vendor/assets/app-icon-light.png";
  }

  function applyOrcaTheme(payload) {
    const scheme = detectOrcaColorScheme(payload);
    syncDisabledIcon(scheme);
    window.TTJ_APP?.applyExternalTheme?.(scheme);
  }

  function clearRefreshTimer() {
    if (refreshTimer !== null) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  function scheduleRefreshTimer() {
    clearRefreshTimer();
    const sec = Number(pluginState.autoRefreshSeconds || 0);
    if (!pluginState.enabled || !Number.isFinite(sec) || sec <= 0) return;
    refreshTimer = setInterval(() => {
      if (!pluginState.enabled || document.hidden || busy) return;
      void runRefresh({ silent: true });
    }, sec * 1000);
  }

  function setDrawerMessage(id, text, tone = "") {
    const el = $(id);
    if (!el) return;
    if (!text) {
      el.hidden = true;
      el.textContent = "";
      el.className = "orca-drawer-msg";
      return;
    }
    el.hidden = false;
    el.textContent = text;
    el.className = tone ? `orca-drawer-msg is-${tone}` : "orca-drawer-msg";
  }

  function setActiveDrawer(nextDrawer) {
    activeDrawer = activeDrawer === nextDrawer ? null : nextDrawer;
    const serverDrawer = $("orca-server-drawer");
    const mobileDrawer = $("orca-mobile-drawer");
    const serverBtn = $("orca-server-btn");
    const mobileBtn = $("orca-mobile-btn");

    const showServer = activeDrawer === "server";
    const showMobile = activeDrawer === "mobile";

    if (serverDrawer) serverDrawer.hidden = !showServer;
    if (mobileDrawer) mobileDrawer.hidden = !showMobile;
    if (serverBtn) serverBtn.setAttribute("aria-expanded", String(showServer));
    if (mobileBtn) mobileBtn.setAttribute("aria-expanded", String(showMobile));

    if (showServer || showMobile) {
      setDrawerMessage("orca-server-msg", "");
      setDrawerMessage("orca-mobile-msg", "");
      void refreshServerStatus({ forceSyncForm: showServer && !configFormDirty });
    }
  }

  function syncConfigFormFromStatus(force = false) {
    if (configFormDirty && !force) return;
    const eff = serverStatus?.effectiveConfig || {};
    const setVal = (id, val) => {
      const el = $(id);
      if (el) el.value = val || "";
    };
    setVal("cfg-server-workdir", eff.serverWorkdir ?? pluginState.serverWorkdir ?? "");
    setVal("cfg-core-path", eff.corePath ?? pluginState.corePath ?? "");
    setVal("cfg-home-path", eff.homePath ?? pluginState.homePath ?? "");
    setVal("cfg-wsl-distro", eff.wslDistro ?? pluginState.wslDistro ?? "");
    setVal("cfg-server-url", serverStatus?.serverUrl ?? pluginState.serverUrl ?? "");
    setVal("cfg-allow-hosts", eff.serverAllowHosts ?? pluginState.serverAllowHosts ?? "");
    setVal("cfg-mobile-url", serverStatus?.configuredMobileUrl ?? pluginState.mobileUrl ?? "");
    const roEl = $("cfg-read-only");
    if (roEl) roEl.checked = Boolean(eff.serverReadOnly ?? pluginState.serverReadOnly);
    configFormDirty = false;
  }

  function formatHostPort(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      return parsed.host;
    } catch {
      return rawUrl || "127.0.0.1:8878";
    }
  }

  function buildExternalBrowserUrl() {
    const baseRaw = String(serverStatus?.serverUrl || pluginState.serverUrl || "http://127.0.0.1:8878").trim();
    if (!baseRaw) return "";
    let base;
    try {
      base = new URL(baseRaw);
    } catch {
      return "";
    }
    if (base.protocol !== "http:" && base.protocol !== "https:") return "";
    const relRoute = window.TTJ_APP?.getRouteUrl?.();
    if (typeof relRoute === "string" && relRoute.startsWith("/")) {
      try {
        return new URL(relRoute, base).toString();
      } catch {
        return base.toString();
      }
    }
    return base.toString();
  }

  function openExternalWithFeedback(url, { drawerMsgId = null } = {}) {
    const report = (text, tone = "") => {
      if (drawerMsgId) {
        setDrawerMessage(drawerMsgId, text, tone);
      } else if (window.TTJ_APP?.showToast) {
        window.TTJ_APP.showToast(text);
      }
    };
    if (!url) {
      report("接続先サーバー URL が設定されていません。", "error");
      return;
    }
    // Call openExternal directly inside click handler to preserve user gesture
    if (window.orca?.shell && typeof window.orca.shell.openExternal === "function") {
      void window.orca.shell.openExternal(url).then(res => {
        if (res && res.opened === false && res.reason === "cancelled") {
          report("ブラウザ起動がキャンセルされました。");
        } else if (res && res.opened === false) {
          report("外部ブラウザを開けませんでした。", "error");
        } else {
          report("ブラウザで開きました。", "ok");
        }
      }).catch(error => {
        report(`ブラウザを開けませんでした: ${error?.message || String(error)}`, "error");
      });
    } else {
      report("この環境では外部ブラウザ起動が利用できません。", "error");
    }
  }

  function renderServerUI() {
    const pip = $("orca-server-dot");
    const mobilePip = $("orca-mobile-dot");
    const indicator = $("orca-server-status-dot");
    const label = $("orca-server-status-label");
    const metaEl = $("orca-server-status-meta");
    const startBtn = $("orca-server-start-btn");
    const stopBtn = $("orca-server-stop-btn");
    const restartBtn = $("orca-server-restart-btn");
    const openExtBtn = $("orca-open-external-btn");
    const serverOpenExtBtn = $("orca-server-open-external-btn");
    const errStartBtn = $("orca-error-start-btn");

    const rawServerUrl = String(serverStatus?.serverUrl || pluginState.serverUrl || "").trim();
    const hostPort = formatHostPort(rawServerUrl);
    const hasValidServerUrl = Boolean(buildExternalBrowserUrl());
    const running = Boolean(serverStatus?.running);
    const known = serverStatus !== null;

    if (openExtBtn) {
      openExtBtn.disabled = !hasValidServerUrl;
      openExtBtn.title = hasValidServerUrl
        ? `別ウィンドウ（ブラウザ）で開く (${hostPort})`
        : "別ウィンドウ（ブラウザ）で開く";
    }
    if (serverOpenExtBtn) {
      serverOpenExtBtn.disabled = !hasValidServerUrl;
    }

    if (pip) {
      if (!known) pip.className = "orca-status-pip is-unknown";
      else if (running) pip.className = "orca-status-pip is-running";
      else pip.className = "orca-status-pip is-stopped";
    }
    if (mobilePip) {
      mobilePip.className = serverStatus?.tailscaleServing
        ? "orca-status-pip is-serving"
        : "orca-status-pip is-hidden";
    }
    if (indicator) {
      if (!known) indicator.className = "orca-server-indicator is-unknown";
      else if (running) indicator.className = "orca-server-indicator is-running";
      else indicator.className = "orca-server-indicator is-stopped";
    }
    if (label) {
      if (!known) label.textContent = "状態を確認中...";
      else if (running) label.textContent = `起動中 (${hostPort})`;
      else label.textContent = `停止中 (${hostPort})`;
    }
    if (metaEl) {
      const notes = [];
      if (running && serverStatus?.managedByPlugin) notes.push("プラグイン起動");
      if (running && serverStatus?.readOnly) notes.push("閲覧専用");
      if (running && serverStatus?.authEnabled) notes.push("認証あり");
      if (!running && known && !serverStatus?.canStart) {
        notes.push("下の「起動設定」でフォルダと ttjcore を設定してください");
      }
      metaEl.textContent = notes.join(" · ");
    }

    if (startBtn) startBtn.disabled = serverBusy || running;
    if (stopBtn) stopBtn.disabled = serverBusy || !running;
    if (restartBtn) restartBtn.disabled = serverBusy || !running;
    if (errStartBtn) {
      errStartBtn.disabled = serverBusy || running;
      errStartBtn.hidden = pluginState.backendMode !== "server";
    }
  }

  async function renderMobileUI() {
    const urlText = $("orca-mobile-url-text");
    const openBtn = $("orca-mobile-open-btn");
    const copyBtn = $("orca-mobile-copy-btn");
    const qrStage = $("orca-mobile-qr-stage");
    const qrWrap = $("orca-mobile-qr-wrap");
    const tsLabel = $("orca-tailscale-label");
    const tsBadge = $("orca-tailscale-badge");
    const tsBtn = $("orca-tailscale-toggle-btn");

    const port = serverStatus?.port || 8878;
    const mobileUrl = (serverStatus?.mobileUrl || pluginState.mobileUrl || "").trim();

    if (urlText) {
      urlText.textContent = mobileUrl || "スマホ用 URL が未検出です（Tailscale または起動設定で指定）";
    }
    if (openBtn) openBtn.disabled = !mobileUrl;
    if (copyBtn) copyBtn.disabled = !mobileUrl;

    if (qrStage && qrWrap) {
      if (!mobileUrl) {
        qrStage.hidden = true;
        qrWrap.innerHTML = "";
      } else {
        try {
          const qr = await loadQrModule();
          qrWrap.innerHTML = qr.renderQrSvg(mobileUrl, {
            ecc: "M",
            quietZone: 4,
            size: 164,
            label: `スマホ接続用 QR コード (${mobileUrl})`,
          });
          qrStage.hidden = false;
        } catch (error) {
          qrStage.hidden = true;
          qrWrap.innerHTML = "";
          setDrawerMessage("orca-mobile-msg", `QR コードを生成できませんでした: ${error?.message || String(error)}`, "error");
        }
      }
    }

    if (tsLabel) {
      tsLabel.textContent = `Tailscale 公開 (ポート ${port})`;
    }
    if (tsBadge && tsBtn) {
      if (!serverStatus) {
        tsBadge.textContent = "確認中";
        tsBadge.className = "orca-pill is-idle";
        tsBtn.disabled = true;
        tsBtn.textContent = "確認中...";
      } else if (!serverStatus.tailscaleAvailable) {
        tsBadge.textContent = "Tailscale 未検出";
        tsBadge.className = "orca-pill is-warn";
        tsBtn.disabled = true;
        tsBtn.textContent = "Tailscale が見つかりません";
      } else if (serverStatus.tailscaleServing) {
        tsBadge.textContent = "公開中";
        tsBadge.className = "orca-pill is-ok";
        tsBtn.disabled = tailscaleBusy;
        tsBtn.textContent = tailscaleBusy ? "切り替え中..." : `公開を OFF にする (:${port})`;
      } else {
        tsBadge.textContent = "未公開";
        tsBadge.className = "orca-pill is-idle";
        tsBtn.disabled = tailscaleBusy;
        tsBtn.textContent = tailscaleBusy ? "切り替え中..." : `公開を ON にする (:${port})`;
      }
    }
  }

  function applyServerStatus(next, { forceSyncForm = false } = {}) {
    serverStatus = next || null;
    renderServerUI();
    syncConfigFormFromStatus(forceSyncForm);
    void renderMobileUI();
  }

  async function refreshServerStatus({ forceSyncForm = false } = {}) {
    try {
      const orca = requireOrca();
      const status = await orca.plugin.request("ttj.serverStatus", {});
      applyServerStatus(status, { forceSyncForm });
      return status;
    } catch (error) {
      setDrawerMessage("orca-server-msg", error?.message || String(error), "error");
      return null;
    }
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Fall through to execCommand fallback
      }
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  function updateControlBarUI() {
    const toggle = $("orca-enabled-toggle");
    const label = $("orca-switch-label");
    const badge = $("orca-conn-badge");
    const badgeText = $("orca-conn-text");
    const refreshBtn = $("orca-refresh-btn");
    const disabledView = $("orca-disabled-state");
    const errorView = $("orca-error-state");
    const errorMsg = $("orca-error-message");
    const appRoot = $("orca-app-root");

    const enabled = Boolean(pluginState.enabled);
    if (toggle) {
      toggle.setAttribute("aria-checked", String(enabled));
      toggle.classList.toggle("is-on", enabled);
    }
    if (label) {
      label.textContent = enabled ? "常駐 ON" : "常駐 OFF";
    }
    if (refreshBtn) {
      refreshBtn.disabled = !enabled;
    }

    if (!enabled) {
      if (badge) {
        badge.className = "orca-conn-badge is-off";
        badge.title = "常駐 OFF";
      }
      if (badgeText) badgeText.textContent = "OFF";
      if (disabledView) disabledView.hidden = false;
      if (errorView) errorView.hidden = true;
      if (appRoot) appRoot.hidden = true;
      return;
    }

    if (disabledView) disabledView.hidden = true;

    if (pluginState.lastError && !pluginState.connected) {
      if (badge) {
        badge.className = "orca-conn-badge is-error";
        badge.title = pluginState.lastError;
      }
      if (badgeText) badgeText.textContent = "エラー";
      if (errorMsg) errorMsg.textContent = pluginState.lastError;
      if (errorView) errorView.hidden = false;
      if (appRoot) appRoot.hidden = true;
      renderServerUI();
      return;
    }

    if (errorView) errorView.hidden = true;
    if (appRoot) appRoot.hidden = false;

    if (badge && badgeText) {
      if (pluginState.connected) {
        badgeText.textContent = pluginState.backendMode === "ttjcore" ? "ttjcore" : "接続中";
        badge.className = "orca-conn-badge is-ok";
        badge.title = pluginState.backendMode === "ttjcore" ? "ttjcore 直接接続中" : `接続中 (${pluginState.serverUrl})`;
      } else {
        badgeText.textContent = "確認中";
        badge.className = "orca-conn-badge is-idle";
        badge.title = "接続を確認中";
      }
    }
  }

  async function runRefresh({ silent = false } = {}) {
    if (!pluginState.enabled || busy) return;
    if (!window.TTJ_APP) return;
    busy = true;
    try {
      const outcome = startedOnce
        ? await window.TTJ_APP.refreshNow({ silent })
        : await window.TTJ_APP.start();
      if (outcome?.disabled) {
        pluginState.enabled = false;
        pluginState.connected = false;
        pluginState.lastError = null;
        clearRefreshTimer();
        window.TTJ_APP.pause();
      } else if (outcome?.ok) {
        startedOnce = true;
        pluginState.connected = true;
        pluginState.lastError = null;
      } else if (outcome?.error) {
        pluginState.connected = false;
        pluginState.lastError = outcome.error?.message || String(outcome.error);
      }
    } catch (error) {
      pluginState.connected = false;
      pluginState.lastError = error?.message || String(error);
    } finally {
      busy = false;
      updateControlBarUI();
    }
  }

  function applyWorkerState(next, { triggerLoad = false } = {}) {
    const prevEnabled = pluginState.enabled;
    const prevMode = pluginState.backendMode;
    const prevUrl = pluginState.serverUrl;
    Object.assign(pluginState, next || {});

    if (!pluginState.enabled) {
      clearRefreshTimer();
      pluginState.connected = false;
      pluginState.lastError = null;
      window.TTJ_APP?.pause?.();
      updateControlBarUI();
      return;
    }

    scheduleRefreshTimer();
    const backendChanged = prevMode !== pluginState.backendMode || prevUrl !== pluginState.serverUrl;
    if (triggerLoad || !prevEnabled || backendChanged || !startedOnce) {
      if (backendChanged) {
        startedOnce = false;
        pluginState.connected = false;
      }
      updateControlBarUI();
      void runRefresh({ silent: true });
    } else {
      updateControlBarUI();
    }
  }

  async function setEnabled(nextEnabled) {
    try {
      const orca = requireOrca();
      const updated = await orca.plugin.request("ttj.setEnabled", { enabled: Boolean(nextEnabled) });
      applyWorkerState(updated, { triggerLoad: Boolean(nextEnabled) });
    } catch (error) {
      pluginState.lastError = error?.message || String(error);
      updateControlBarUI();
    }
  }

  async function handleServerStart() {
    if (serverBusy) return;
    serverBusy = true;
    renderServerUI();
    setDrawerMessage("orca-server-msg", "サーバーを起動しています...");
    try {
      const orca = requireOrca();
      const res = await orca.plugin.request("ttj.serverStart", {});
      if (res?.status) applyServerStatus(res.status);
      setDrawerMessage(
        "orca-server-msg",
        res?.alreadyRunning ? "サーバーは既に起動中です。" : "サーバーを起動しました。",
        "ok",
      );
      if (pluginState.enabled) {
        startedOnce = false;
        pluginState.lastError = null;
        updateControlBarUI();
        void runRefresh({ silent: false });
      }
    } catch (error) {
      const msg = error?.message || String(error);
      setDrawerMessage("orca-server-msg", msg, "error");
      const details = $("orca-server-config-details");
      if (details && msg.includes("起動設定")) {
        details.open = true;
      }
    } finally {
      serverBusy = false;
      renderServerUI();
    }
  }

  async function handleServerStop() {
    if (serverBusy) return;
    serverBusy = true;
    renderServerUI();
    setDrawerMessage("orca-server-msg", "サーバーを停止しています...");
    try {
      const orca = requireOrca();
      const res = await orca.plugin.request("ttj.serverStop", {});
      if (res?.status) applyServerStatus(res.status);
      setDrawerMessage(
        "orca-server-msg",
        res?.alreadyStopped ? "サーバーは既に停止しています。" : "サーバーを停止しました。",
        "ok",
      );
    } catch (error) {
      setDrawerMessage("orca-server-msg", error?.message || String(error), "error");
    } finally {
      serverBusy = false;
      renderServerUI();
    }
  }

  async function handleServerRestart() {
    if (serverBusy) return;
    serverBusy = true;
    renderServerUI();
    setDrawerMessage("orca-server-msg", "サーバーを再起動しています...");
    try {
      const orca = requireOrca();
      await orca.plugin.request("ttj.serverStop", {});
      const started = await orca.plugin.request("ttj.serverStart", {});
      if (started?.status) applyServerStatus(started.status);
      setDrawerMessage("orca-server-msg", "サーバーを再起動しました。", "ok");
      if (pluginState.enabled) {
        startedOnce = false;
        pluginState.lastError = null;
        updateControlBarUI();
        void runRefresh({ silent: false });
      }
    } catch (error) {
      setDrawerMessage("orca-server-msg", error?.message || String(error), "error");
    } finally {
      serverBusy = false;
      renderServerUI();
    }
  }

  async function handleTailscaleToggle() {
    if (tailscaleBusy || !serverStatus?.tailscaleAvailable) return;
    const nextEnable = !serverStatus.tailscaleServing;
    tailscaleBusy = true;
    void renderMobileUI();
    setDrawerMessage("orca-mobile-msg", nextEnable ? "Tailscale 公開を ON にしています..." : "Tailscale 公開を OFF にしています...");
    try {
      const orca = requireOrca();
      const res = await orca.plugin.request("ttj.tailscaleToggle", { enable: nextEnable });
      if (res?.status) applyServerStatus(res.status);
      setDrawerMessage(
        "orca-mobile-msg",
        res?.enabled ? `ポート ${res.status?.port} の Tailscale 公開を ON にしました。` : `ポート ${res.status?.port} の Tailscale 公開を OFF にしました。`,
        "ok",
      );
    } catch (error) {
      setDrawerMessage("orca-mobile-msg", error?.message || String(error), "error");
    } finally {
      tailscaleBusy = false;
      void renderMobileUI();
    }
  }

  async function handleSaveServerConfig(event) {
    event.preventDefault();
    const saveBtn = $("orca-server-config-save");
    if (saveBtn) saveBtn.disabled = true;
    setDrawerMessage("orca-server-msg", "設定を保存しています...");
    try {
      const orca = requireOrca();
      const payload = {
        serverWorkdir: $("cfg-server-workdir")?.value?.trim() || "",
        corePath: $("cfg-core-path")?.value?.trim() || "",
        homePath: $("cfg-home-path")?.value?.trim() || "",
        wslDistro: $("cfg-wsl-distro")?.value?.trim() || "",
        serverUrl: $("cfg-server-url")?.value?.trim() || "http://127.0.0.1:8878",
        serverAllowHosts: $("cfg-allow-hosts")?.value?.trim() || "",
        mobileUrl: $("cfg-mobile-url")?.value?.trim() || "",
        serverReadOnly: Boolean($("cfg-read-only")?.checked),
      };
      const res = await orca.plugin.request("ttj.saveServerConfig", payload);
      configFormDirty = false;
      if (res?.state) applyWorkerState(res.state, { triggerLoad: false });
      if (res?.status) applyServerStatus(res.status, { forceSyncForm: true });
      setDrawerMessage("orca-server-msg", "起動設定を保存しました。", "ok");
    } catch (error) {
      setDrawerMessage("orca-server-msg", error?.message || String(error), "error");
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  window.TTJ_BRIDGE = {
    mode: "orca-panel",
    assetBase: "./vendor",
    deferBootstrap: true,
    disableWatch: true,
    defaultView: "list",
    async getMeta() {
      if (!pluginState.enabled) {
        return { disabled: true };
      }
      const orca = requireOrca();
      const meta = await orca.plugin.request("ttj.meta", {});
      if (meta && !meta.disabled) {
        pluginState.connected = true;
        pluginState.lastError = null;
        updateControlBarUI();
      }
      return meta;
    },
    async call(method, params = {}) {
      if (!pluginState.enabled) {
        throw new Error("TTJWeb 常駐は現在 OFF です。ON に切り替えてください。");
      }
      const orca = requireOrca();
      return await orca.plugin.request("ttj.call", { method, params });
    },
  };

  async function initPanel() {
    $("orca-enabled-toggle")?.addEventListener("click", () => {
      void setEnabled(!pluginState.enabled);
    });
    $("orca-enable-btn")?.addEventListener("click", () => {
      void setEnabled(true);
    });
    $("orca-refresh-btn")?.addEventListener("click", () => {
      void runRefresh({ silent: false });
      void refreshServerStatus();
    });
    $("orca-retry-btn")?.addEventListener("click", () => {
      startedOnce = false;
      pluginState.lastError = null;
      updateControlBarUI();
      void runRefresh({ silent: false });
      void refreshServerStatus();
    });
    $("orca-error-start-btn")?.addEventListener("click", () => {
      if (activeDrawer !== "server") setActiveDrawer("server");
      void handleServerStart();
    });

    $("orca-open-external-btn")?.addEventListener("click", () => {
      const url = buildExternalBrowserUrl();
      openExternalWithFeedback(url);
    });
    $("orca-server-open-external-btn")?.addEventListener("click", () => {
      const url = buildExternalBrowserUrl();
      openExternalWithFeedback(url, { drawerMsgId: "orca-server-msg" });
    });

    $("orca-server-btn")?.addEventListener("click", () => {
      setActiveDrawer("server");
    });
    $("orca-server-close")?.addEventListener("click", () => {
      setActiveDrawer(null);
    });
    $("orca-mobile-btn")?.addEventListener("click", () => {
      setActiveDrawer("mobile");
    });
    $("orca-mobile-close")?.addEventListener("click", () => {
      setActiveDrawer(null);
    });

    $("orca-server-start-btn")?.addEventListener("click", () => {
      void handleServerStart();
    });
    $("orca-server-stop-btn")?.addEventListener("click", () => {
      void handleServerStop();
    });
    $("orca-server-restart-btn")?.addEventListener("click", () => {
      void handleServerRestart();
    });

    const configForm = $("orca-server-config-form");
    if (configForm) {
      configForm.addEventListener("input", () => {
        configFormDirty = true;
      });
      configForm.addEventListener("submit", event => {
        void handleSaveServerConfig(event);
      });
    }

    $("orca-mobile-open-btn")?.addEventListener("click", () => {
      const url = (serverStatus?.mobileUrl || pluginState.mobileUrl || "").trim();
      if (!url) return;
      // Call openExternal directly inside click handler to preserve user gesture
      if (window.orca?.shell && typeof window.orca.shell.openExternal === "function") {
        void window.orca.shell.openExternal(url).then(res => {
          if (res && res.opened === false && res.reason === "cancelled") {
            setDrawerMessage("orca-mobile-msg", "ブラウザ起動がキャンセルされました。");
          } else if (res && res.opened === false) {
            setDrawerMessage("orca-mobile-msg", "外部ブラウザを開けませんでした。URL をコピーして開いてください。", "error");
          } else {
            setDrawerMessage("orca-mobile-msg", "ブラウザで開きました。", "ok");
          }
        }).catch(error => {
          setDrawerMessage("orca-mobile-msg", `ブラウザを開けませんでした: ${error?.message || String(error)}`, "error");
        });
      } else {
        setDrawerMessage("orca-mobile-msg", "この環境では外部ブラウザ起動が利用できません。URL コピーをご利用ください。", "error");
      }
    });

    $("orca-mobile-copy-btn")?.addEventListener("click", async () => {
      const url = (serverStatus?.mobileUrl || pluginState.mobileUrl || "").trim();
      if (!url) return;
      const copyBtn = $("orca-mobile-copy-btn");
      const ok = await copyTextToClipboard(url);
      if (ok) {
        setDrawerMessage("orca-mobile-msg", "コピーしました。", "ok");
        if (copyBtn) {
          copyBtn.textContent = "コピーしました";
          clearTimeout(copyFeedbackTimer);
          copyFeedbackTimer = setTimeout(() => {
            copyBtn.textContent = "URL コピー";
          }, 1800);
        }
      } else {
        setDrawerMessage("orca-mobile-msg", "クリップボードへのコピーに失敗しました。", "error");
      }
    });

    $("orca-tailscale-toggle-btn")?.addEventListener("click", () => {
      void handleTailscaleToggle();
    });

    const brand = document.querySelector(".brand");
    if (brand) {
      brand.addEventListener("click", event => {
        event.preventDefault();
      });
    }

    applyOrcaTheme(null);

    if (window.orca?.on) {
      window.orca.on("theme", payload => {
        applyOrcaTheme(payload);
      });
    }
    if (window.orca?.plugin?.on) {
      window.orca.plugin.on("ttj.state", next => {
        applyWorkerState(next, { triggerLoad: false });
      });
      window.orca.plugin.on("ttj.serverStatus", next => {
        applyServerStatus(next, { forceSyncForm: false });
      });
      window.orca.plugin.on("ttj.refresh", () => {
        if (pluginState.enabled) {
          startedOnce = false;
          void runRefresh({ silent: false });
        }
      });
    }

    // Wait briefly if module app.js hasn't finished registering window.TTJ_APP yet
    let waited = 0;
    while (!window.TTJ_APP && waited < 40) {
      await new Promise(resolve => setTimeout(resolve, 25));
      waited++;
    }
    applyOrcaTheme(null);

    try {
      const orca = requireOrca();
      const initial = await orca.plugin.request("ttj.state", {});
      applyWorkerState(initial, { triggerLoad: Boolean(initial?.enabled) });
      void refreshServerStatus({ forceSyncForm: true });
    } catch (error) {
      pluginState.connected = false;
      pluginState.lastError = error?.message || String(error);
      updateControlBarUI();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { void initPanel(); }, { once: true });
  } else {
    void initPanel();
  }
})();
