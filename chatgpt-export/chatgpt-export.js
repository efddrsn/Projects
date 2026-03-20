// ==UserScript==
// @name         ChatGPT History Exporter
// @namespace    chatgpt-history-exporter
// @version      3.0.0
// @description  Auto-activate and continuously export ChatGPT conversation history
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// ChatGPT History Exporter with Auto Sync + Resumable Storage
// Runs automatically via userscript manager, or paste into browser console on https://chatgpt.com

(async function ChatGPTExport() {
  "use strict";

  if (!location.hostname.includes("chatgpt.com") && !location.hostname.includes("chat.openai.com")) {
    alert("Please run this script on https://chatgpt.com");
    return;
  }

  if (window.__CHATGPT_HISTORY_EXPORTER__?.destroy) {
    try {
      window.__CHATGPT_HISTORY_EXPORTER__.destroy("restart");
    } catch (err) {
      console.warn("[ChatGPT Export]", err);
    }
  }

  const SCRIPT_VERSION = "3.0.0";
  const CANCELLED_MESSAGE = "Export cancelled.";
  const BATCH_DELAY_MS = 350;
  const CONVERSATION_LIST_PAGE_SIZE = 100;
  const MAX_RETRIES = 4;
  const AUTO_RECENT_PRIORITY_COUNT = 20;
  const DB_NAME = "chatgpt-history-exporter-db";
  const DB_VERSION = 1;
  const STORE_CONVERSATIONS = "conversations";

  const STORAGE_KEYS = {
    settings: "__cge_settings_v2",
    runtime: "__cge_runtime_v2",
    index: "__cge_index_v2",
  };

  const DEFAULT_SETTINGS = {
    limitEnabled: false,
    limitNum: 500,
    minUpdateDate: "",
    multiMsgOnly: false,
    format: "json", // json | markdown | both
    mode: "auto", // manual | auto
    autoEnabled: true,
    autoIntervalSec: 180,
    autoBatchSize: 30,
    saveManualDownload: true,
    storageTarget: "local", // local | local_cloud
    cloudUrl: "",
    cloudAuthToken: "",
  };

  const DEFAULT_RUNTIME = {
    syncCursor: 0,
    pendingCloudIds: [],
    lastCoverage: null,
    lastRunAt: 0,
    lastSuccessfulRunAt: 0,
    lastError: "",
    autoCycleCount: 0,
  };

  let accessToken = null;
  let abortController = null;
  let autoTimer = null;
  let dbPromise = null;
  let isRunning = false;

  let panel = null;
  let statusEl = null;
  let progressBarEl = null;
  let coverageEl = null;
  let coverageDateEl = null;
  let autoStateEl = null;
  let statsEl = null;
  let badge = null;

  const settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...loadJSON(STORAGE_KEYS.settings, {}) });
  const runtime = sanitizeRuntime({ ...DEFAULT_RUNTIME, ...loadJSON(STORAGE_KEYS.runtime, {}) });
  let conversationIndex = sanitizeIndex(loadJSON(STORAGE_KEYS.index, {}));
  let pendingCloudIds = new Set(runtime.pendingCloudIds);

  // -------------------------
  // persistence
  // -------------------------
  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn("[ChatGPT Export] localStorage write failed:", err);
    }
  }

  function sanitizeSettings(input) {
    return {
      limitEnabled: !!input.limitEnabled,
      limitNum: clampInt(input.limitNum, 1, 99999, DEFAULT_SETTINGS.limitNum),
      minUpdateDate: typeof input.minUpdateDate === "string" ? input.minUpdateDate : "",
      multiMsgOnly: !!input.multiMsgOnly,
      format: ["json", "markdown", "both"].includes(input.format) ? input.format : "json",
      mode: input.mode === "auto" ? "auto" : "manual",
      autoEnabled: !!input.autoEnabled,
      autoIntervalSec: clampInt(input.autoIntervalSec, 20, 86400, DEFAULT_SETTINGS.autoIntervalSec),
      autoBatchSize: clampInt(input.autoBatchSize, 1, 1000, DEFAULT_SETTINGS.autoBatchSize),
      saveManualDownload: input.saveManualDownload !== false,
      storageTarget: input.storageTarget === "local_cloud" ? "local_cloud" : "local",
      cloudUrl: typeof input.cloudUrl === "string" ? input.cloudUrl.trim() : "",
      cloudAuthToken: typeof input.cloudAuthToken === "string" ? input.cloudAuthToken.trim() : "",
    };
  }

  function sanitizeRuntime(input) {
    return {
      syncCursor: clampInt(input.syncCursor, 0, Number.MAX_SAFE_INTEGER, 0),
      pendingCloudIds: Array.isArray(input.pendingCloudIds)
        ? input.pendingCloudIds.filter((v) => typeof v === "string")
        : [],
      lastCoverage: input.lastCoverage && typeof input.lastCoverage === "object" ? input.lastCoverage : null,
      lastRunAt: Number.isFinite(input.lastRunAt) ? input.lastRunAt : 0,
      lastSuccessfulRunAt: Number.isFinite(input.lastSuccessfulRunAt) ? input.lastSuccessfulRunAt : 0,
      lastError: typeof input.lastError === "string" ? input.lastError : "",
      autoCycleCount: clampInt(input.autoCycleCount, 0, Number.MAX_SAFE_INTEGER, 0),
    };
  }

  function sanitizeIndex(input) {
    if (!input || typeof input !== "object") return {};
    const out = {};
    for (const [id, value] of Object.entries(input)) {
      if (!id || !value || typeof value !== "object") continue;
      out[id] = {
        update_time: Number.isFinite(value.update_time) ? value.update_time : null,
        user_message_count: clampInt(value.user_message_count, 0, 999999, 0),
        last_saved_at: Number.isFinite(value.last_saved_at) ? value.last_saved_at : 0,
        cloud_uploaded_update_time: Number.isFinite(value.cloud_uploaded_update_time)
          ? value.cloud_uploaded_update_time
          : null,
      };
    }
    return out;
  }

  function persistSettings() {
    saveJSON(STORAGE_KEYS.settings, settings);
  }

  function persistRuntime() {
    runtime.pendingCloudIds = Array.from(pendingCloudIds);
    saveJSON(STORAGE_KEYS.runtime, runtime);
  }

  function persistIndex() {
    saveJSON(STORAGE_KEYS.index, conversationIndex);
  }

  function clampInt(value, min, max, fallback) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  // -------------------------
  // utils
  // -------------------------
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function throwIfCancelled() {
    if (abortController?.signal.aborted) {
      throw new Error(CANCELLED_MESSAGE);
    }
  }

  function isCancelledError(err) {
    return (
      err?.message === CANCELLED_MESSAGE ||
      err?.name === "AbortError" ||
      abortController?.signal.aborted
    );
  }

  function fmtTime(unix) {
    if (!unix) return "unknown";
    return new Date(unix * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  }

  function fmtDateOnly(unix) {
    if (!unix) return "unknown";
    return new Date(unix * 1000).toISOString().slice(0, 10);
  }

  function fmtLocalDateTime(ms) {
    if (!ms) return "never";
    return new Date(ms).toLocaleString();
  }

  function truncateTitle(title, max = 80) {
    const t = String(title || "Untitled");
    return t.length <= max ? t : t.slice(0, max - 1) + "...";
  }

  function dateInputToEpoch(dateValue) {
    if (!dateValue) return null;
    const ts = Date.parse(dateValue + "T00:00:00Z");
    return Number.isFinite(ts) ? Math.floor(ts / 1000) : null;
  }

  function authHeaders() {
    return {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };
  }

  // -------------------------
  // indexedDB
  // -------------------------
  function reqToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
    });
  }

  function openDb() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_CONVERSATIONS)) {
          db.createObjectStore(STORE_CONVERSATIONS, { keyPath: "id" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB."));
    });

    return dbPromise;
  }

  async function idbGetConversation(id) {
    const db = await openDb();
    const tx = db.transaction(STORE_CONVERSATIONS, "readonly");
    const store = tx.objectStore(STORE_CONVERSATIONS);
    return reqToPromise(store.get(id));
  }

  async function idbPutConversation(record) {
    const db = await openDb();
    const tx = db.transaction(STORE_CONVERSATIONS, "readwrite");
    const store = tx.objectStore(STORE_CONVERSATIONS);
    await reqToPromise(store.put(record));
  }

  async function idbGetAllConversations() {
    const db = await openDb();
    const tx = db.transaction(STORE_CONVERSATIONS, "readonly");
    const store = tx.objectStore(STORE_CONVERSATIONS);
    return reqToPromise(store.getAll());
  }

  // -------------------------
  // API helpers
  // -------------------------
  async function getAccessToken() {
    if (accessToken) return accessToken;
    const res = await fetch("/api/auth/session");
    if (!res.ok) throw new Error("Failed to get session. Please make sure you are logged in.");
    const data = await res.json();
    accessToken = data.accessToken;
    if (!accessToken) throw new Error("No access token found in session.");
    return accessToken;
  }

  async function apiFetchJson(url, retries = MAX_RETRIES) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      throwIfCancelled();
      try {
        const res = await fetch(url, {
          headers: authHeaders(),
          signal: abortController?.signal,
        });

        if (res.status === 429) {
          const waitMs = Math.min(2000 * Math.pow(2, attempt), 30000);
          setStatus(`Rate-limited by ChatGPT, retrying in ${Math.round(waitMs / 1000)}s...`);
          await sleep(waitMs);
          continue;
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} for ${url}`);
        }

        return await res.json();
      } catch (err) {
        if (isCancelledError(err)) throw new Error(CANCELLED_MESSAGE);
        if (attempt === retries) throw err;
        await sleep(1000 * Math.pow(2, attempt));
      }
    }

    throw new Error("Unexpected API fetch state.");
  }

  async function fetchConversationMetaPage(offset, limit) {
    return apiFetchJson(`/backend-api/conversations?offset=${offset}&limit=${limit}&order=updated`);
  }

  async function fetchConversation(id) {
    return apiFetchJson(`/backend-api/conversation/${id}`);
  }

  async function fetchTargetConversationMetas({ limitNum, minUpdateTime }) {
    const metas = [];
    let offset = 0;
    let total = Infinity;
    let totalAvailable = null;

    while (offset < total) {
      throwIfCancelled();

      const pageSize = CONVERSATION_LIST_PAGE_SIZE;
      setStatus(`Fetching conversation list (${metas.length} loaded)...`);
      const data = await fetchConversationMetaPage(offset, pageSize);
      const items = Array.isArray(data.items) ? data.items : [];

      if (data.total != null) {
        total = data.total;
        totalAvailable = data.total;
      }

      if (!items.length) break;

      let reachedDateBoundary = false;

      for (const meta of items) {
        if (limitNum && metas.length >= limitNum) break;

        const updateTime = Number.isFinite(meta.update_time) ? meta.update_time : null;
        if (minUpdateTime && updateTime && updateTime < minUpdateTime) {
          reachedDateBoundary = true;
          break;
        }

        metas.push(meta);
      }

      if ((limitNum && metas.length >= limitNum) || reachedDateBoundary) {
        break;
      }

      offset += items.length;
      await sleep(BATCH_DELAY_MS);
    }

    return {
      metas,
      totalAvailable: totalAvailable == null ? metas.length : totalAvailable,
    };
  }

  // -------------------------
  // conversation parsing
  // -------------------------
  function extractMessages(conv) {
    if (!conv?.mapping) return [];

    const mapping = conv.mapping;
    let leafId = conv.current_node || null;

    if (!leafId) {
      for (const [id, node] of Object.entries(mapping)) {
        if (!node.children || node.children.length === 0) {
          leafId = id;
          break;
        }
      }
    }
    if (!leafId) return [];

    const path = [];
    let cur = leafId;
    const seen = new Set();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      path.push(cur);
      cur = mapping[cur]?.parent;
    }
    path.reverse();

    const ordered = [];
    for (const nodeId of path) {
      const node = mapping[nodeId];
      const msg = node?.message;
      if (!msg) continue;

      const role = msg.author?.role;
      if (role !== "user" && role !== "assistant" && role !== "tool") continue;

      let text = "";
      if (Array.isArray(msg.content?.parts)) {
        text = msg.content.parts.filter((p) => typeof p === "string").join("\n");
      } else if (typeof msg.content?.text === "string") {
        text = msg.content.text;
      }

      ordered.push({
        id: msg.id || nodeId,
        role,
        text,
        create_time: msg.create_time || null,
        model_slug: msg.metadata?.model_slug || null,
      });
    }

    return ordered;
  }

  function conversationToRecord(conv, messages) {
    const id = conv.conversation_id || conv.id;
    const userMessageCount = messages.filter((m) => m.role === "user").length;

    return {
      id,
      title: conv.title || "Untitled",
      create_time: conv.create_time || null,
      create_time_iso: fmtTime(conv.create_time),
      update_time: conv.update_time || null,
      update_time_iso: fmtTime(conv.update_time),
      model: conv.model?.slug || null,
      user_message_count: userMessageCount,
      messages: messages.map((m) => ({
        role: m.role,
        text: m.text,
        create_time: m.create_time,
        create_time_iso: fmtTime(m.create_time),
        model: m.model_slug,
      })),
      synced_at_unix: Math.floor(Date.now() / 1000),
      synced_at_iso: new Date().toISOString(),
    };
  }

  function recordToMarkdown(record) {
    const lines = [];
    lines.push(`# ${record.title || "Untitled"}`);
    lines.push("");
    lines.push(`- **Created:** ${fmtTime(record.create_time)}`);
    lines.push(`- **Updated:** ${fmtTime(record.update_time)}`);
    lines.push(`- **ID:** ${record.id}`);
    if (record.model) lines.push(`- **Model:** ${record.model}`);
    lines.push("");
    lines.push("---");
    lines.push("");

    for (const m of record.messages || []) {
      const roleLabel =
        m.role === "user" ? "**You**" : m.role === "assistant" ? "**ChatGPT**" : `**${m.role}**`;
      const ts = m.create_time ? ` _(${fmtTime(m.create_time)})_` : "";
      const model = m.model && m.role === "assistant" ? ` [${m.model}]` : "";
      lines.push(`### ${roleLabel}${model}${ts}`);
      lines.push("");
      lines.push(m.text || "_(empty)_");
      lines.push("");
    }

    return lines.join("\n");
  }

  // -------------------------
  // dedupe / coverage
  // -------------------------
  function isConversationUpToDate(meta, indexEntry) {
    if (!indexEntry) return false;
    const remoteUpdate = Number.isFinite(meta?.update_time) ? meta.update_time : null;
    const localUpdate = Number.isFinite(indexEntry.update_time) ? indexEntry.update_time : null;

    if (remoteUpdate == null) {
      return !!indexEntry.last_saved_at;
    }
    return localUpdate != null && localUpdate >= remoteUpdate;
  }

  function computeCoverageStats(metas) {
    let coveredCount = 0;
    let contiguousCoveredCount = 0;
    let contiguousCoveredUntil = null;

    for (const meta of metas) {
      if (isConversationUpToDate(meta, conversationIndex[meta.id])) coveredCount++;
    }

    for (const meta of metas) {
      if (isConversationUpToDate(meta, conversationIndex[meta.id])) {
        contiguousCoveredCount++;
        if (Number.isFinite(meta.update_time)) {
          contiguousCoveredUntil = meta.update_time;
        }
      } else {
        break;
      }
    }

    const targetTotal = metas.length;
    const percent = targetTotal ? (coveredCount / targetTotal) * 100 : 0;

    return {
      targetTotal,
      coveredCount,
      percent,
      contiguousCoveredCount,
      contiguousCoveredUntil,
    };
  }

  function selectAutoQueue(metas, staleMetas) {
    const batchSize = clampInt(settings.autoBatchSize, 1, 1000, DEFAULT_SETTINGS.autoBatchSize);
    if (!staleMetas.length || !metas.length) {
      runtime.syncCursor = 0;
      persistRuntime();
      return [];
    }

    const staleSet = new Set(staleMetas.map((m) => m.id));
    const selected = [];
    const selectedIds = new Set();

    // Prioritize newest stale chats to keep near-real-time updates.
    const recentCount = Math.min(AUTO_RECENT_PRIORITY_COUNT, metas.length);
    for (let i = 0; i < recentCount && selected.length < batchSize; i++) {
      const meta = metas[i];
      if (staleSet.has(meta.id) && !selectedIds.has(meta.id)) {
        selected.push(meta);
        selectedIds.add(meta.id);
      }
    }

    let idx = runtime.syncCursor % metas.length;
    let walked = 0;
    while (walked < metas.length && selected.length < batchSize) {
      const meta = metas[idx];
      if (staleSet.has(meta.id) && !selectedIds.has(meta.id)) {
        selected.push(meta);
        selectedIds.add(meta.id);
      }
      idx = (idx + 1) % metas.length;
      walked++;
    }

    runtime.syncCursor = idx;
    persistRuntime();
    return selected;
  }

  async function saveConversationRecord(record) {
    const existing = conversationIndex[record.id] || {};
    await idbPutConversation(record);

    const nextUpdate = Number.isFinite(record.update_time) ? record.update_time : null;
    const existingCloudUpdate = Number.isFinite(existing.cloud_uploaded_update_time)
      ? existing.cloud_uploaded_update_time
      : null;
    const cloudUpdateStillValid =
      existingCloudUpdate != null && nextUpdate != null && existingCloudUpdate >= nextUpdate;

    conversationIndex[record.id] = {
      update_time: nextUpdate,
      user_message_count: clampInt(record.user_message_count, 0, 999999, 0),
      last_saved_at: Date.now(),
      cloud_uploaded_update_time: cloudUpdateStillValid ? existingCloudUpdate : null,
    };
    persistIndex();
  }

  // -------------------------
  // cloud uploads (optional)
  // -------------------------
  function isCloudEnabled() {
    return settings.storageTarget === "local_cloud" && !!settings.cloudUrl;
  }

  async function uploadCloudPayload(payload) {
    const headers = { "Content-Type": "application/json" };
    if (settings.cloudAuthToken) {
      headers.Authorization = `Bearer ${settings.cloudAuthToken}`;
    }

    const res = await fetch(settings.cloudUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: abortController?.signal,
    });

    if (!res.ok) {
      throw new Error(`Cloud endpoint HTTP ${res.status}`);
    }
  }

  async function flushCloudQueue(maxItems) {
    if (!isCloudEnabled()) {
      return { uploaded: 0, failed: 0, remaining: pendingCloudIds.size };
    }

    const ids = Array.from(pendingCloudIds);
    const hardLimit = Number.isFinite(maxItems) ? Math.max(0, maxItems) : ids.length;
    let uploaded = 0;
    let failed = 0;

    for (let i = 0; i < ids.length && uploaded + failed < hardLimit; i++) {
      throwIfCancelled();
      const id = ids[i];
      const indexEntry = conversationIndex[id];
      if (!indexEntry) {
        pendingCloudIds.delete(id);
        continue;
      }

      const localUpdate = Number.isFinite(indexEntry.update_time) ? indexEntry.update_time : null;
      const uploadedUpdate = Number.isFinite(indexEntry.cloud_uploaded_update_time)
        ? indexEntry.cloud_uploaded_update_time
        : null;

      if (localUpdate != null && uploadedUpdate != null && uploadedUpdate >= localUpdate) {
        pendingCloudIds.delete(id);
        continue;
      }

      const record = await idbGetConversation(id);
      if (!record) {
        pendingCloudIds.delete(id);
        continue;
      }

      try {
        await uploadCloudPayload({
          exporter: "chatgpt-history-exporter",
          version: SCRIPT_VERSION,
          event: "conversation_upsert",
          sent_at: new Date().toISOString(),
          conversation: record,
        });

        conversationIndex[id] = {
          ...indexEntry,
          cloud_uploaded_update_time: localUpdate,
        };
        pendingCloudIds.delete(id);
        uploaded++;
        persistIndex();
        persistRuntime();
      } catch (err) {
        failed++;
        runtime.lastError = `Cloud upload failed for ${id}: ${err.message}`;
        persistRuntime();
        // Stop on first cloud error to avoid hammering a broken endpoint.
        break;
      }

      await sleep(50);
    }

    persistRuntime();
    return { uploaded, failed, remaining: pendingCloudIds.size };
  }

  // -------------------------
  // downloads
  // -------------------------
  function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  function exportableSettings() {
    return {
      limitEnabled: settings.limitEnabled,
      limitNum: settings.limitEnabled ? settings.limitNum : null,
      minUpdateDate: settings.minUpdateDate || null,
      multiMsgOnly: settings.multiMsgOnly,
      mode: settings.mode,
      autoEnabled: settings.autoEnabled,
      autoIntervalSec: settings.autoIntervalSec,
      autoBatchSize: settings.autoBatchSize,
      storageTarget: settings.storageTarget,
      format: settings.format,
    };
  }

  async function buildRecordsFromMetas(metas) {
    const allRecords = await idbGetAllConversations();
    const map = new Map(allRecords.map((r) => [r.id, r]));
    const selected = [];

    for (const meta of metas) {
      const record = map.get(meta.id);
      if (!record) continue;
      if (!isConversationUpToDate(meta, conversationIndex[meta.id])) continue;
      if (settings.multiMsgOnly && (record.user_message_count || 0) <= 1) continue;
      selected.push(record);
    }

    return selected;
  }

  async function downloadSnapshotFromMetas(metas, coverageStats, reason) {
    const records = await buildRecordsFromMetas(metas);
    if (!records.length) {
      setStatus("No fully synced conversations available to download with current filters.");
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filenameBase = `chatgpt-export-${timestamp}`;

    if (settings.format === "json" || settings.format === "both") {
      const jsonPayload = {
        exporter: "chatgpt-history-exporter",
        version: SCRIPT_VERSION,
        exported_at: new Date().toISOString(),
        reason,
        params: exportableSettings(),
        coverage: coverageStats,
        conversations: records,
      };
      downloadFile(`${filenameBase}.json`, JSON.stringify(jsonPayload, null, 2), "application/json");
    }

    if (settings.format === "markdown" || settings.format === "both") {
      const markdownBody = records.map((r) => recordToMarkdown(r)).join("\n\n---\n\n");
      downloadFile(`${filenameBase}.md`, markdownBody, "text/markdown");
    }
  }

  // -------------------------
  // sync engine
  // -------------------------
  async function runSyncCycle({ trigger, isAuto }) {
    if (isRunning) {
      setStatus("A sync cycle is already running.");
      return;
    }

    readSettingsFromUI();
    persistSettings();

    if (isAuto && (settings.mode !== "auto" || !settings.autoEnabled)) {
      return;
    }

    isRunning = true;
    abortController = new AbortController();
    setBusyUI(true);

    runtime.lastRunAt = Date.now();
    runtime.lastError = "";
    persistRuntime();

    const cycleName = isAuto ? "Auto sync" : "Manual sync";
    const minUpdateTime = dateInputToEpoch(settings.minUpdateDate);
    const limitNum = settings.limitEnabled ? settings.limitNum : null;

    try {
      setStatus(`${cycleName}: authenticating...`);
      await getAccessToken();

      setStatus(`${cycleName}: loading conversation metadata...`);
      const { metas, totalAvailable } = await fetchTargetConversationMetas({
        limitNum,
        minUpdateTime,
      });

      if (!metas.length) {
        const emptyCoverage = {
          targetTotal: 0,
          coveredCount: 0,
          percent: 0,
          contiguousCoveredCount: 0,
          contiguousCoveredUntil: null,
          totalAvailable,
        };
        runtime.lastCoverage = emptyCoverage;
        persistRuntime();
        updateCoverageUI(emptyCoverage);
        setProgress(0, 0);
        setStatus("No conversations matched your preset parameters.");
        return;
      }

      let coverage = computeCoverageStats(metas);
      coverage.totalAvailable = totalAvailable;
      runtime.lastCoverage = coverage;
      updateCoverageUI(coverage);
      persistRuntime();

      const staleMetas = metas.filter((meta) => !isConversationUpToDate(meta, conversationIndex[meta.id]));
      const queue = isAuto ? selectAutoQueue(metas, staleMetas) : staleMetas;

      let updatedCount = 0;
      let skippedCurrent = 0;
      let fetchFailures = 0;

      if (queue.length === 0) {
        setProgress(0, 0);
        setStatus(`${cycleName}: local storage already up to date.`);
      } else {
        const cycleStartMs = Date.now();

        for (let i = 0; i < queue.length; i++) {
          throwIfCancelled();

          const meta = queue[i];
          const title = truncateTitle(meta.title || "Untitled");
          setProgress(i + 1, queue.length);

          let etaText = "";
          if (i >= 2) {
            const elapsed = Date.now() - cycleStartMs;
            const perItem = elapsed / i;
            const remainingSec = Math.round((perItem * (queue.length - i)) / 1000);
            if (remainingSec > 5) etaText = ` (~${remainingSec}s left)`;
          }

          setStatus(`${cycleName}: syncing ${i + 1}/${queue.length} - ${title}${etaText}`);

          if (isConversationUpToDate(meta, conversationIndex[meta.id])) {
            skippedCurrent++;
            continue;
          }

          try {
            const conv = await fetchConversation(meta.id);
            const messages = extractMessages(conv);
            const record = conversationToRecord(conv, messages);
            await saveConversationRecord(record);

            if (isCloudEnabled()) {
              pendingCloudIds.add(record.id);
              persistRuntime();
            }

            updatedCount++;
          } catch (err) {
            if (isCancelledError(err)) throw err;
            fetchFailures++;
            runtime.lastError = `Failed to sync "${title}": ${err.message}`;
            persistRuntime();
            console.warn("[ChatGPT Export]", runtime.lastError, err);
          }

          coverage = computeCoverageStats(metas);
          coverage.totalAvailable = totalAvailable;
          runtime.lastCoverage = coverage;
          updateCoverageUI(coverage);
          persistRuntime();

          await sleep(BATCH_DELAY_MS);
        }
      }

      let cloudResult = { uploaded: 0, failed: 0, remaining: pendingCloudIds.size };
      if (isCloudEnabled()) {
        setStatus(`${cycleName}: uploading pending cloud records...`);
        cloudResult = await flushCloudQueue(isAuto ? settings.autoBatchSize : Number.POSITIVE_INFINITY);
      }

      coverage = computeCoverageStats(metas);
      coverage.totalAvailable = totalAvailable;
      runtime.lastCoverage = coverage;
      runtime.lastSuccessfulRunAt = Date.now();
      if (isAuto) runtime.autoCycleCount += 1;
      if (!fetchFailures && !cloudResult.failed) runtime.lastError = "";
      persistRuntime();
      persistIndex();
      updateCoverageUI(coverage);
      updateStatsLine();

      if (!isAuto && settings.saveManualDownload) {
        setStatus("Preparing local download...");
        await downloadSnapshotFromMetas(metas, coverage, "manual_sync");
      }

      const summaryParts = [
        `${cycleName} complete`,
        `${updatedCount} updated`,
        skippedCurrent ? `${skippedCurrent} already current` : null,
        fetchFailures ? `${fetchFailures} fetch failed` : null,
        isCloudEnabled() ? `${cloudResult.remaining} cloud pending` : null,
      ].filter(Boolean);

      setStatus(summaryParts.join(" | "));
    } catch (err) {
      if (isCancelledError(err)) {
        setStatus(`${cycleName} cancelled by user.`);
      } else {
        runtime.lastError = err.message || String(err);
        persistRuntime();
        setStatus(`Error: ${runtime.lastError}`);
        console.error("[ChatGPT Export]", err);
      }
    } finally {
      isRunning = false;
      abortController = null;
      setBusyUI(false);
      persistRuntime();
      persistIndex();
      updateStatsLine();

      if (isAuto && settings.autoEnabled && settings.mode === "auto") {
        scheduleNextAutoRun(trigger);
      }
    }
  }

  function scheduleNextAutoRun(trigger) {
    clearTimeout(autoTimer);
    autoTimer = null;

    if (settings.mode !== "auto" || !settings.autoEnabled) return;

    const intervalMs = Math.max(20000, settings.autoIntervalSec * 1000);
    const nextAt = Date.now() + intervalMs;
    setAutoState(`ON - next run ${new Date(nextAt).toLocaleTimeString()}`);

    autoTimer = setTimeout(() => {
      runSyncCycle({ trigger: `${trigger || "auto"}_timer`, isAuto: true });
    }, intervalMs);
  }

  async function startAutoSync() {
    if (settings.mode !== "auto") {
      setStatus('Set mode to "Auto sync" to enable automatic cycles.');
      return;
    }

    settings.autoEnabled = true;
    persistSettings();
    writeSettingsToUI();
    updateControlVisibility();
    setAutoState(`ON - interval ${settings.autoIntervalSec}s`);

    if (!isRunning) {
      await runSyncCycle({ trigger: "auto_start", isAuto: true });
    }
  }

  function stopAutoSync(reason) {
    settings.autoEnabled = false;
    persistSettings();

    clearTimeout(autoTimer);
    autoTimer = null;
    setAutoState(`OFF${reason ? ` (${reason})` : ""}`);

    writeSettingsToUI();
    updateControlVisibility();
  }

  function cancelCurrentRun() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  }

  async function downloadCurrentSnapshotWithoutSync() {
    if (isRunning) {
      setStatus("Please wait for the current cycle to finish before downloading.");
      return;
    }

    readSettingsFromUI();
    persistSettings();

    abortController = new AbortController();
    setBusyUI(true);

    try {
      await getAccessToken();
      const minUpdateTime = dateInputToEpoch(settings.minUpdateDate);
      const limitNum = settings.limitEnabled ? settings.limitNum : null;
      setStatus("Loading metadata for snapshot download...");
      const { metas, totalAvailable } = await fetchTargetConversationMetas({ limitNum, minUpdateTime });

      const coverage = computeCoverageStats(metas);
      coverage.totalAvailable = totalAvailable;
      runtime.lastCoverage = coverage;
      persistRuntime();
      updateCoverageUI(coverage);

      setStatus("Creating local snapshot from stored transcripts...");
      await downloadSnapshotFromMetas(metas, coverage, "download_from_storage");
      setStatus("Snapshot download complete.");
    } catch (err) {
      if (isCancelledError(err)) {
        setStatus("Snapshot download cancelled.");
      } else {
        setStatus(`Download error: ${err.message}`);
        console.error("[ChatGPT Export]", err);
      }
    } finally {
      abortController = null;
      setBusyUI(false);
    }
  }

  // -------------------------
  // UI
  // -------------------------
  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
    updateBadge();
  }

  function setProgress(current, total) {
    if (!progressBarEl) return;
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    progressBarEl.style.width = `${pct}%`;
    progressBarEl.textContent = total > 0 ? `${current}/${total}` : "idle";
  }

  function setAutoState(text) {
    if (autoStateEl) autoStateEl.textContent = `Auto: ${text}`;
  }

  function updateCoverageUI(coverage) {
    if (!coverageEl || !coverageDateEl) return;

    if (!coverage || !coverage.targetTotal) {
      coverageEl.textContent = "Coverage: 0% (0/0)";
      coverageDateEl.textContent = "Covered continuously until: n/a";
      return;
    }

    const pct = coverage.percent.toFixed(1);
    coverageEl.textContent = `Coverage: ${pct}% (${coverage.coveredCount}/${coverage.targetTotal})`;

    if (coverage.contiguousCoveredUntil) {
      coverageDateEl.textContent =
        `Covered continuously from newest back to: ${fmtDateOnly(coverage.contiguousCoveredUntil)} ` +
        `(${fmtTime(coverage.contiguousCoveredUntil)})`;
    } else {
      coverageDateEl.textContent = "Covered continuously from newest back to: not yet";
    }
    updateBadge();
  }

  function updateStatsLine() {
    if (!statsEl) return;
    const localCount = Object.keys(conversationIndex).length;
    const pending = pendingCloudIds.size;
    const lastOk = fmtLocalDateTime(runtime.lastSuccessfulRunAt);
    const lastErr = runtime.lastError ? ` | Last error: ${runtime.lastError}` : "";
    statsEl.textContent =
      `Local transcripts: ${localCount} | Cloud pending: ${pending} | Last successful sync: ${lastOk}${lastErr}`;
  }

  function setBusyUI(busy) {
    const runNowBtn = document.getElementById("cge-run-now");
    const cancelBtn = document.getElementById("cge-cancel");
    const autoToggleBtn = document.getElementById("cge-auto-toggle");
    const downloadBtn = document.getElementById("cge-download-now");

    if (runNowBtn) runNowBtn.disabled = busy;
    if (downloadBtn) downloadBtn.disabled = busy;
    if (autoToggleBtn) autoToggleBtn.disabled = busy;
    if (cancelBtn) cancelBtn.style.display = busy ? "" : "none";
    updateBadge();
  }

  function readSettingsFromUI() {
    const limitEnabledEl = document.getElementById("cge-limit-check");
    const limitNumEl = document.getElementById("cge-limit-num");
    const minDateEl = document.getElementById("cge-min-date");
    const multiMsgEl = document.getElementById("cge-multi-msg");
    const formatEl = document.getElementById("cge-format");
    const modeEl = document.getElementById("cge-mode");
    const autoEnabledEl = document.getElementById("cge-auto-enabled");
    const autoIntervalEl = document.getElementById("cge-auto-interval");
    const autoBatchEl = document.getElementById("cge-auto-batch");
    const saveManualDlEl = document.getElementById("cge-save-manual-download");
    const storageTargetEl = document.getElementById("cge-storage-target");
    const cloudUrlEl = document.getElementById("cge-cloud-url");
    const cloudTokenEl = document.getElementById("cge-cloud-token");

    settings.limitEnabled = !!limitEnabledEl?.checked;
    settings.limitNum = clampInt(limitNumEl?.value, 1, 99999, settings.limitNum);
    settings.minUpdateDate = typeof minDateEl?.value === "string" ? minDateEl.value : "";
    settings.multiMsgOnly = !!multiMsgEl?.checked;
    settings.format = ["json", "markdown", "both"].includes(formatEl?.value) ? formatEl.value : "json";
    settings.mode = modeEl?.value === "auto" ? "auto" : "manual";
    settings.autoEnabled = !!autoEnabledEl?.checked;
    settings.autoIntervalSec = clampInt(autoIntervalEl?.value, 20, 86400, settings.autoIntervalSec);
    settings.autoBatchSize = clampInt(autoBatchEl?.value, 1, 1000, settings.autoBatchSize);
    settings.saveManualDownload = !!saveManualDlEl?.checked;
    settings.storageTarget = storageTargetEl?.value === "local_cloud" ? "local_cloud" : "local";
    settings.cloudUrl = typeof cloudUrlEl?.value === "string" ? cloudUrlEl.value.trim() : "";
    settings.cloudAuthToken = typeof cloudTokenEl?.value === "string" ? cloudTokenEl.value.trim() : "";

    if (settings.mode !== "auto") {
      settings.autoEnabled = false;
    }
  }

  function writeSettingsToUI() {
    const set = (id, value, prop = "value") => {
      const el = document.getElementById(id);
      if (!el) return;
      if (prop === "checked") el.checked = !!value;
      else el.value = value ?? "";
    };

    set("cge-limit-check", settings.limitEnabled, "checked");
    set("cge-limit-num", settings.limitNum);
    set("cge-min-date", settings.minUpdateDate);
    set("cge-multi-msg", settings.multiMsgOnly, "checked");
    set("cge-format", settings.format);
    set("cge-mode", settings.mode);
    set("cge-auto-enabled", settings.autoEnabled, "checked");
    set("cge-auto-interval", settings.autoIntervalSec);
    set("cge-auto-batch", settings.autoBatchSize);
    set("cge-save-manual-download", settings.saveManualDownload, "checked");
    set("cge-storage-target", settings.storageTarget);
    set("cge-cloud-url", settings.cloudUrl);
    set("cge-cloud-token", settings.cloudAuthToken);

    setAutoState(settings.autoEnabled ? `ON - interval ${settings.autoIntervalSec}s` : "OFF");
  }

  function updateControlVisibility() {
    const limitNumEl = document.getElementById("cge-limit-num");
    if (limitNumEl) limitNumEl.disabled = !settings.limitEnabled;

    const modeIsAuto = settings.mode === "auto";
    const autoEnabledEl = document.getElementById("cge-auto-enabled");
    const autoIntervalEl = document.getElementById("cge-auto-interval");
    const autoBatchEl = document.getElementById("cge-auto-batch");
    const autoToggleBtn = document.getElementById("cge-auto-toggle");

    if (autoEnabledEl) autoEnabledEl.disabled = !modeIsAuto;
    if (autoIntervalEl) autoIntervalEl.disabled = !modeIsAuto;
    if (autoBatchEl) autoBatchEl.disabled = !modeIsAuto;
    if (autoToggleBtn) {
      autoToggleBtn.disabled = !modeIsAuto || isRunning;
      autoToggleBtn.textContent = settings.autoEnabled ? "Turn Auto OFF" : "Turn Auto ON";
    }

    const cloudEnabled = settings.storageTarget === "local_cloud";
    const cloudRow = document.getElementById("cge-cloud-row");
    if (cloudRow) cloudRow.style.display = cloudEnabled ? "" : "none";
  }

  function handleSettingsChange() {
    readSettingsFromUI();
    persistSettings();
    updateControlVisibility();
    updateStatsLine();

    if (!settings.autoEnabled) {
      clearTimeout(autoTimer);
      autoTimer = null;
      setAutoState("OFF");
    } else if (settings.mode === "auto" && !isRunning) {
      scheduleNextAutoRun("settings_change");
    }
  }

  function closePanel() {
    cancelCurrentRun();
    clearTimeout(autoTimer);
    autoTimer = null;
    settings.autoEnabled = false;
    persistSettings();
    panel?.remove();
    panel = null;
    badge?.remove();
    badge = null;
  }

  // -------------------------
  // floating badge (minimized indicator)
  // -------------------------
  function buildBadge() {
    const existing = document.getElementById("cge-badge");
    if (existing) existing.remove();

    badge = document.createElement("div");
    badge.id = "cge-badge";
    badge.innerHTML = `
      <style>
        #cge-badge {
          position: fixed; bottom: 20px; right: 20px; z-index: 999998;
          background: #1e1e2e; border: 1px solid #313244; border-radius: 20px;
          padding: 8px 14px; display: flex; align-items: center; gap: 8px;
          cursor: pointer; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 12px; color: #cdd6f4; box-shadow: 0 4px 16px rgba(0,0,0,0.35);
          transition: background 0.2s, transform 0.15s; user-select: none;
        }
        #cge-badge:hover { background: #313244; transform: translateY(-1px); }
        #cge-badge .cge-dot {
          width: 8px; height: 8px; border-radius: 50%; background: #a6adc8;
          flex-shrink: 0; transition: background 0.3s;
        }
        #cge-badge .cge-dot.syncing { background: #f9e2af; animation: cge-pulse 1.2s infinite; }
        #cge-badge .cge-dot.ok { background: #a6e3a1; }
        #cge-badge .cge-dot.error { background: #f38ba8; }
        @keyframes cge-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      </style>
      <span class="cge-dot" id="cge-badge-dot"></span>
      <span id="cge-badge-label">Export</span>
    `;
    badge.addEventListener("click", showPanel);
    document.body.appendChild(badge);
  }

  function updateBadge() {
    const dot = document.getElementById("cge-badge-dot");
    const label = document.getElementById("cge-badge-label");
    if (!dot || !label) return;

    dot.className = "cge-dot";
    if (isRunning) {
      dot.classList.add("syncing");
    } else if (runtime.lastError) {
      dot.classList.add("error");
    } else if (runtime.lastSuccessfulRunAt) {
      dot.classList.add("ok");
    }

    const cov = runtime.lastCoverage;
    if (cov && cov.targetTotal) {
      label.textContent = `${cov.percent.toFixed(0)}% synced`;
    } else if (isRunning) {
      label.textContent = "Syncing\u2026";
    } else {
      label.textContent = "Export";
    }
  }

  function showPanel() {
    if (!panel) buildUI();
    panel.style.display = "";
    if (badge) badge.style.display = "none";
  }

  function minimizePanel() {
    if (panel) panel.style.display = "none";
    if (badge) {
      badge.style.display = "";
      updateBadge();
    }
  }

  // -------------------------
  // settings panel
  // -------------------------
  function buildUI() {
    const existing = document.getElementById("chatgpt-export-panel");
    if (existing) existing.remove();

    panel = document.createElement("div");
    panel.id = "chatgpt-export-panel";
    panel.innerHTML = `
      <style>
        #chatgpt-export-panel {
          position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
          z-index: 999999; background: #1e1e2e; color: #cdd6f4;
          border-radius: 16px; padding: 24px 28px; width: 560px; max-width: calc(100vw - 20px);
          max-height: calc(100vh - 20px); overflow: auto;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          box-shadow: 0 24px 60px rgba(0,0,0,0.55); border: 1px solid #313244;
        }
        #chatgpt-export-panel h2 { margin: 0 0 14px 0; font-size: 20px; color: #cba6f7; }
        #chatgpt-export-panel .cge-section {
          margin-top: 12px; padding-top: 12px; border-top: 1px solid #313244;
        }
        #chatgpt-export-panel .cge-row {
          display: flex; align-items: center; gap: 8px; margin: 8px 0; flex-wrap: wrap;
        }
        #chatgpt-export-panel label {
          display: flex; align-items: center; gap: 8px; font-size: 13px; color: #cdd6f4;
        }
        #chatgpt-export-panel input[type="number"],
        #chatgpt-export-panel input[type="date"],
        #chatgpt-export-panel input[type="text"],
        #chatgpt-export-panel input[type="password"],
        #chatgpt-export-panel select {
          background: #313244; border: 1px solid #45475a; color: #cdd6f4;
          border-radius: 6px; padding: 5px 8px; font-size: 13px;
        }
        #chatgpt-export-panel input[type="text"],
        #chatgpt-export-panel input[type="password"] { width: 100%; min-width: 280px; }
        #chatgpt-export-panel input[type="checkbox"] { accent-color: #cba6f7; width: 16px; height: 16px; }
        #chatgpt-export-panel button {
          padding: 9px 14px; border: none; border-radius: 8px; cursor: pointer;
          font-size: 13px; font-weight: 600; transition: background 0.2s;
        }
        #chatgpt-export-panel .cge-primary { background: #cba6f7; color: #1e1e2e; }
        #chatgpt-export-panel .cge-primary:hover { background: #b4befe; }
        #chatgpt-export-panel .cge-secondary { background: #45475a; color: #cdd6f4; }
        #chatgpt-export-panel .cge-secondary:hover { background: #585b70; }
        #chatgpt-export-panel .cge-danger { background: #f38ba8; color: #1e1e2e; }
        #chatgpt-export-panel .cge-danger:hover { background: #eba0ac; }
        #chatgpt-export-panel .cge-muted {
          background: rgba(137,180,250,0.08); border: 1px solid #313244; border-radius: 8px;
          padding: 8px 10px; color: #a6adc8; font-size: 12px; line-height: 1.4;
        }
        #chatgpt-export-panel .cge-progress-outer {
          height: 22px; background: #313244; border-radius: 6px; overflow: hidden; margin: 10px 0;
        }
        #chatgpt-export-panel .cge-progress-inner {
          height: 100%; width: 0%; background: #a6e3a1; color: #1e1e2e; font-size: 12px;
          display: flex; align-items: center; justify-content: center; transition: width 0.25s;
        }
        #chatgpt-export-panel .cge-status { font-size: 13px; color: #a6adc8; min-height: 20px; margin: 8px 0; }
        #chatgpt-export-panel .cge-metric { font-size: 13px; color: #cdd6f4; margin: 4px 0; }
        #chatgpt-export-panel .cge-close {
          position: absolute; top: 10px; right: 14px; background: none; border: none;
          color: #6c7086; font-size: 22px; cursor: pointer; padding: 4px;
        }
        #chatgpt-export-panel .cge-close:hover { color: #cdd6f4; }
      </style>
      <button class="cge-close" id="cge-close">&times;</button>
      <h2>ChatGPT History Export</h2>

      <div class="cge-section">
        <div class="cge-row">
          <span style="font-size:13px;">Mode:</span>
          <select id="cge-mode">
            <option value="manual">User initiated (run now)</option>
            <option value="auto">Auto sync while ChatGPT tab is open</option>
          </select>
          <label><input type="checkbox" id="cge-auto-enabled">Auto enabled</label>
        </div>

        <div class="cge-row">
          <span style="font-size:13px;">Auto interval</span>
          <input type="number" id="cge-auto-interval" min="20" max="86400" style="width:90px;">
          <span style="font-size:13px;">seconds</span>
          <span style="font-size:13px; margin-left: 10px;">Auto batch</span>
          <input type="number" id="cge-auto-batch" min="1" max="1000" style="width:90px;">
          <span style="font-size:13px;">chats/cycle</span>
        </div>

        <div class="cge-row">
          <label><input type="checkbox" id="cge-limit-check">Limit to last</label>
          <input type="number" id="cge-limit-num" min="1" max="99999" style="width:90px;">
          <span style="font-size:13px;">chats</span>
        </div>

        <div class="cge-row">
          <span style="font-size:13px;">Updated on or after</span>
          <input type="date" id="cge-min-date">
          <span style="font-size:12px;color:#a6adc8;">(optional backfill boundary)</span>
        </div>

        <label><input type="checkbox" id="cge-multi-msg">Only chats with more than one user message</label>
      </div>

      <div class="cge-section">
        <div class="cge-row">
          <span style="font-size:13px;">Download format:</span>
          <select id="cge-format">
            <option value="json">JSON</option>
            <option value="markdown">Markdown</option>
            <option value="both">JSON + Markdown</option>
          </select>
          <label><input type="checkbox" id="cge-save-manual-download">Download after manual sync</label>
        </div>

        <div class="cge-row">
          <span style="font-size:13px;">Storage:</span>
          <select id="cge-storage-target">
            <option value="local">Local browser storage only</option>
            <option value="local_cloud">Local storage + cloud endpoint</option>
          </select>
        </div>

        <div id="cge-cloud-row">
          <div class="cge-row">
            <span style="font-size:13px;">Cloud URL</span>
            <input type="text" id="cge-cloud-url" placeholder="https://your-endpoint.example/upload">
          </div>
          <div class="cge-row">
            <span style="font-size:13px;">Cloud bearer token (optional)</span>
            <input type="password" id="cge-cloud-token" placeholder="token">
          </div>
        </div>

        <div class="cge-muted">
          Local IndexedDB storage is always on for crash-safe resume. The exporter checks existing transcripts first and only refetches chats that changed.
        </div>
      </div>

      <div class="cge-section">
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="cge-primary" id="cge-run-now">Run Sync Now</button>
          <button class="cge-secondary" id="cge-download-now">Download Snapshot Now</button>
          <button class="cge-secondary" id="cge-auto-toggle">Turn Auto ON</button>
          <button class="cge-danger" id="cge-cancel" style="display:none;">Cancel</button>
          <button class="cge-secondary" id="cge-minimize">Minimize</button>
          <button class="cge-secondary" id="cge-close2">Close &amp; Stop</button>
        </div>

        <div class="cge-progress-outer"><div class="cge-progress-inner" id="cge-progress"></div></div>
        <div class="cge-metric" id="cge-coverage">Coverage: 0% (0/0)</div>
        <div class="cge-metric" id="cge-covered-until">Covered continuously until: n/a</div>
        <div class="cge-metric" id="cge-auto-state">Auto: OFF</div>
        <div class="cge-metric" id="cge-stats"></div>
        <div class="cge-status" id="cge-status">Ready. Log in to ChatGPT and run a sync.</div>
      </div>
    `;

    document.body.appendChild(panel);

    statusEl = document.getElementById("cge-status");
    progressBarEl = document.getElementById("cge-progress");
    coverageEl = document.getElementById("cge-coverage");
    coverageDateEl = document.getElementById("cge-covered-until");
    autoStateEl = document.getElementById("cge-auto-state");
    statsEl = document.getElementById("cge-stats");

    document.getElementById("cge-close").addEventListener("click", minimizePanel);
    document.getElementById("cge-close2").addEventListener("click", closePanel);
    document.getElementById("cge-minimize").addEventListener("click", minimizePanel);
    document.getElementById("cge-cancel").addEventListener("click", cancelCurrentRun);

    document.getElementById("cge-run-now").addEventListener("click", async () => {
      await runSyncCycle({ trigger: "manual_button", isAuto: false });
    });

    document.getElementById("cge-download-now").addEventListener("click", async () => {
      await downloadCurrentSnapshotWithoutSync();
    });

    document.getElementById("cge-auto-toggle").addEventListener("click", async () => {
      readSettingsFromUI();
      persistSettings();

      if (settings.mode !== "auto") {
        setStatus('Switch mode to "Auto sync while ChatGPT tab is open" first.');
        return;
      }

      if (settings.autoEnabled) {
        stopAutoSync("user toggled");
        setStatus("Auto sync is now OFF.");
      } else {
        settings.autoEnabled = true;
        persistSettings();
        writeSettingsToUI();
        updateControlVisibility();
        setStatus("Auto sync is now ON.");
        await startAutoSync();
      }
    });

    const watchedIds = [
      "cge-limit-check",
      "cge-limit-num",
      "cge-min-date",
      "cge-multi-msg",
      "cge-format",
      "cge-mode",
      "cge-auto-enabled",
      "cge-auto-interval",
      "cge-auto-batch",
      "cge-save-manual-download",
      "cge-storage-target",
      "cge-cloud-url",
      "cge-cloud-token",
    ];

    for (const id of watchedIds) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.addEventListener("change", handleSettingsChange);
      if (el.tagName === "INPUT" && (el.type === "text" || el.type === "password" || el.type === "number")) {
        el.addEventListener("input", handleSettingsChange);
      }
    }

    writeSettingsToUI();
    updateControlVisibility();
    updateCoverageUI(runtime.lastCoverage);
    updateStatsLine();
    setProgress(0, 0);
  }

  // -------------------------
  // startup
  // -------------------------
  async function preflight() {
    try {
      await getAccessToken();
      const data = await apiFetchJson("/backend-api/conversations?offset=0&limit=1&order=updated");
      const total = data.total ?? data.items?.length ?? "?";
      setStatus(
        `Ready. ${total} conversations available. Configure your preset params and run sync.`
      );
    } catch {
      setStatus("Ready. Log in to ChatGPT first, then run sync.");
    }
  }

  function destroy(reason) {
    clearTimeout(autoTimer);
    autoTimer = null;
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    if (panel) {
      panel.remove();
      panel = null;
    }
    if (badge) {
      badge.remove();
      badge = null;
    }
    if (reason) {
      console.info(`[ChatGPT Export] destroyed (${reason}).`);
    }
  }

  buildBadge();
  buildUI();
  panel.style.display = "none";
  preflight();
  updateBadge();

  // Auto-activate: start syncing immediately on page load.
  if (settings.mode === "auto" && settings.autoEnabled) {
    startAutoSync().catch((err) => {
      console.error("[ChatGPT Export] failed to resume auto sync:", err);
      setStatus(`Auto resume failed: ${err.message}`);
    });
  } else {
    setAutoState("OFF");
  }

  window.__CHATGPT_HISTORY_EXPORTER__ = {
    version: SCRIPT_VERSION,
    startAutoSync,
    stopAutoSync,
    runManualSync: () => runSyncCycle({ trigger: "external_call", isAuto: false }),
    showPanel,
    minimizePanel,
    destroy,
  };
})();
