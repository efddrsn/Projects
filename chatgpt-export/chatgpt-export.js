// ChatGPT Full History Export
// Paste this entire script into your browser console while on https://chatgpt.com
// It will open a floating panel with export options.

(async function ChatGPTExport() {
  "use strict";

  if (!location.hostname.includes("chatgpt.com") && !location.hostname.includes("chat.openai.com")) {
    alert("Please run this script on https://chatgpt.com");
    return;
  }

  const BATCH_DELAY_MS = 350;
  const CONVERSATION_LIST_PAGE_SIZE = 100;
  const MAX_RETRIES = 4;

  // ── State ──────────────────────────────────────────────────────────
  let accessToken = null;
  let abortController = null;

  // ── Auth ───────────────────────────────────────────────────────────
  async function getAccessToken() {
    if (accessToken) return accessToken;
    const res = await fetch("/api/auth/session");
    if (!res.ok) throw new Error("Failed to get session – are you logged in?");
    const data = await res.json();
    accessToken = data.accessToken;
    if (!accessToken) throw new Error("No access token found in session.");
    return accessToken;
  }

  function authHeaders() {
    return { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
  }

  // ── API helpers with retry ─────────────────────────────────────────
  async function apiFetch(url, retries = MAX_RETRIES) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (abortController?.signal.aborted) throw new Error("Export cancelled.");
      try {
        const res = await fetch(url, { headers: authHeaders(), signal: abortController?.signal });
        if (res.status === 429) {
          const wait = Math.min(2000 * Math.pow(2, attempt), 30000);
          setStatus(`Rate-limited, waiting ${(wait / 1000).toFixed(0)}s…`);
          await sleep(wait);
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return await res.json();
      } catch (err) {
        if (err.name === "AbortError" || abortController?.signal.aborted) throw new Error("Export cancelled.");
        if (attempt === retries) throw err;
        await sleep(1000 * Math.pow(2, attempt));
      }
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ── Fetch conversation list (paginated) ────────────────────────────
  async function fetchAllConversationMetas(limit) {
    const metas = [];
    let offset = 0;
    let total = Infinity;

    while (offset < total) {
      if (abortController?.signal.aborted) throw new Error("Export cancelled.");
      const pageSize = limit ? Math.min(CONVERSATION_LIST_PAGE_SIZE, limit - metas.length) : CONVERSATION_LIST_PAGE_SIZE;
      if (pageSize <= 0) break;

      setStatus(`Fetching conversation list (${metas.length} so far)…`);
      const data = await apiFetch(
        `/backend-api/conversations?offset=${offset}&limit=${pageSize}&order=updated`
      );

      if (data.total != null) total = data.total;
      if (!data.items || data.items.length === 0) break;

      metas.push(...data.items);
      offset += data.items.length;

      if (limit && metas.length >= limit) {
        metas.length = limit;
        break;
      }
      await sleep(BATCH_DELAY_MS);
    }

    return metas;
  }

  // ── Fetch single conversation detail ───────────────────────────────
  async function fetchConversation(id) {
    return apiFetch(`/backend-api/conversation/${id}`);
  }

  // ── Traverse message tree in order ─────────────────────────────────
  // Follows the primary conversation thread (current_node -> root path)
  // to avoid interleaving messages from different regeneration branches.
  function extractMessages(conv) {
    if (!conv.mapping) return [];

    const mapping = conv.mapping;

    // Determine the leaf of the active branch
    let leafId = conv.current_node;
    if (!leafId) {
      // Fallback: find deepest leaf by walking from any root
      for (const [id, node] of Object.entries(mapping)) {
        if (!node.children || node.children.length === 0) {
          leafId = id;
        }
      }
    }
    if (!leafId) return [];

    // Walk from leaf to root, collecting the linear path
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
      if (!node?.message) continue;

      const msg = node.message;
      const role = msg.author?.role;
      if (role === "user" || role === "assistant" || role === "tool") {
        let text = "";
        if (msg.content?.parts) {
          text = msg.content.parts
            .filter((p) => typeof p === "string")
            .join("\n");
        } else if (msg.content?.text) {
          text = msg.content.text;
        }
        ordered.push({
          id: msg.id,
          role,
          text,
          create_time: msg.create_time || null,
          model_slug: msg.metadata?.model_slug || null,
        });
      }
    }

    return ordered;
  }

  // ── Formatting helpers ─────────────────────────────────────────────
  function fmtTime(unix) {
    if (!unix) return "unknown";
    return new Date(unix * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  }

  function conversationToMarkdown(conv, messages) {
    const lines = [];
    lines.push(`# ${conv.title || "Untitled"}`);
    lines.push("");
    lines.push(`- **Created:** ${fmtTime(conv.create_time)}`);
    lines.push(`- **Updated:** ${fmtTime(conv.update_time)}`);
    lines.push(`- **ID:** ${conv.conversation_id || conv.id}`);
    if (conv.model?.slug) lines.push(`- **Model:** ${conv.model.slug}`);
    lines.push("");
    lines.push("---");
    lines.push("");

    for (const m of messages) {
      const roleLabel = m.role === "user" ? "**You**" : m.role === "assistant" ? "**ChatGPT**" : `**${m.role}**`;
      const ts = m.create_time ? ` _(${fmtTime(m.create_time)})_` : "";
      const model = m.model_slug && m.role === "assistant" ? ` [${m.model_slug}]` : "";
      lines.push(`### ${roleLabel}${model}${ts}`);
      lines.push("");
      lines.push(m.text || "_(empty)_");
      lines.push("");
    }

    return lines.join("\n");
  }

  function conversationToJSON(conv, messages) {
    return {
      id: conv.conversation_id || conv.id,
      title: conv.title || "Untitled",
      create_time: conv.create_time,
      create_time_iso: fmtTime(conv.create_time),
      update_time: conv.update_time,
      update_time_iso: fmtTime(conv.update_time),
      model: conv.model?.slug || null,
      messages: messages.map((m) => ({
        role: m.role,
        text: m.text,
        create_time: m.create_time,
        create_time_iso: fmtTime(m.create_time),
        model: m.model_slug,
      })),
    };
  }

  // ── File download ──────────────────────────────────────────────────
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

  // ── UI ─────────────────────────────────────────────────────────────
  let statusEl, progressBarEl, panel;

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function setProgress(current, total) {
    if (progressBarEl) {
      const pct = total ? Math.round((current / total) * 100) : 0;
      progressBarEl.style.width = pct + "%";
      progressBarEl.textContent = `${current}/${total}`;
    }
  }

  function buildUI() {
    if (document.getElementById("chatgpt-export-panel")) {
      document.getElementById("chatgpt-export-panel").remove();
    }

    panel = document.createElement("div");
    panel.id = "chatgpt-export-panel";
    panel.innerHTML = `
      <style>
        #chatgpt-export-panel {
          position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
          z-index: 999999; background: #1e1e2e; color: #cdd6f4;
          border-radius: 16px; padding: 28px 32px; width: 440px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          box-shadow: 0 25px 60px rgba(0,0,0,0.5); border: 1px solid #313244;
        }
        #chatgpt-export-panel h2 { margin: 0 0 18px 0; font-size: 20px; color: #cba6f7; }
        #chatgpt-export-panel label { display: flex; align-items: center; gap: 8px; margin: 8px 0; font-size: 14px; cursor: pointer; }
        #chatgpt-export-panel input[type="number"] {
          width: 80px; background: #313244; border: 1px solid #45475a; color: #cdd6f4;
          border-radius: 6px; padding: 5px 8px; font-size: 14px;
        }
        #chatgpt-export-panel select {
          background: #313244; border: 1px solid #45475a; color: #cdd6f4;
          border-radius: 6px; padding: 5px 8px; font-size: 14px;
        }
        #chatgpt-export-panel .cge-row { display: flex; align-items: center; gap: 10px; margin: 10px 0; }
        #chatgpt-export-panel button {
          padding: 10px 20px; border: none; border-radius: 8px; cursor: pointer;
          font-size: 14px; font-weight: 600; transition: background 0.2s;
        }
        #chatgpt-export-panel .cge-primary { background: #cba6f7; color: #1e1e2e; }
        #chatgpt-export-panel .cge-primary:hover { background: #b4befe; }
        #chatgpt-export-panel .cge-danger { background: #f38ba8; color: #1e1e2e; }
        #chatgpt-export-panel .cge-danger:hover { background: #eba0ac; }
        #chatgpt-export-panel .cge-secondary { background: #45475a; color: #cdd6f4; }
        #chatgpt-export-panel .cge-secondary:hover { background: #585b70; }
        #chatgpt-export-panel .cge-progress-outer {
          height: 24px; background: #313244; border-radius: 6px; overflow: hidden; margin: 12px 0;
        }
        #chatgpt-export-panel .cge-progress-inner {
          height: 100%; background: #a6e3a1; color: #1e1e2e; font-size: 12px;
          display: flex; align-items: center; justify-content: center;
          transition: width 0.3s; width: 0%;
        }
        #chatgpt-export-panel .cge-status { font-size: 13px; color: #a6adc8; min-height: 20px; margin: 8px 0; }
        #chatgpt-export-panel .cge-close {
          position: absolute; top: 12px; right: 16px; background: none; border: none;
          color: #6c7086; font-size: 22px; cursor: pointer; padding: 4px;
        }
        #chatgpt-export-panel .cge-close:hover { color: #cdd6f4; }
        #chatgpt-export-panel input[type="checkbox"] { accent-color: #cba6f7; width: 16px; height: 16px; }
      </style>
      <button class="cge-close" id="cge-close">&times;</button>
      <h2>ChatGPT History Export</h2>

      <div class="cge-row">
        <label>
          <input type="checkbox" id="cge-limit-check">
          Limit to last
        </label>
        <input type="number" id="cge-limit-num" value="50" min="1" max="99999" disabled>
        <span>chats</span>
      </div>

      <label>
        <input type="checkbox" id="cge-multi-msg">
        Only chats with &gt;1 user message
      </label>

      <div class="cge-row">
        <span>Format:</span>
        <select id="cge-format">
          <option value="json">JSON (complete data)</option>
          <option value="markdown">Markdown (readable)</option>
          <option value="both">Both JSON + Markdown</option>
        </select>
      </div>

      <div style="margin-top: 16px; display: flex; gap: 10px;">
        <button class="cge-primary" id="cge-start">Export All</button>
        <button class="cge-danger" id="cge-cancel" style="display:none;">Cancel</button>
        <button class="cge-secondary" id="cge-close2">Close</button>
      </div>

      <div class="cge-progress-outer"><div class="cge-progress-inner" id="cge-progress"></div></div>
      <div class="cge-status" id="cge-status">Ready. Make sure you are logged in to ChatGPT.</div>
    `;

    document.body.appendChild(panel);

    statusEl = document.getElementById("cge-status");
    progressBarEl = document.getElementById("cge-progress");

    const limitCheck = document.getElementById("cge-limit-check");
    const limitNum = document.getElementById("cge-limit-num");
    limitCheck.addEventListener("change", () => { limitNum.disabled = !limitCheck.checked; });

    document.getElementById("cge-close").addEventListener("click", closePanel);
    document.getElementById("cge-close2").addEventListener("click", closePanel);
    document.getElementById("cge-start").addEventListener("click", startExport);
    document.getElementById("cge-cancel").addEventListener("click", cancelExport);
  }

  function closePanel() {
    cancelExport();
    panel?.remove();
  }

  function cancelExport() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    document.getElementById("cge-cancel").style.display = "none";
    document.getElementById("cge-start").style.display = "";
    setStatus("Cancelled.");
  }

  // ── Main export logic ──────────────────────────────────────────────
  async function startExport() {
    abortController = new AbortController();
    document.getElementById("cge-start").style.display = "none";
    document.getElementById("cge-cancel").style.display = "";

    const limitEnabled = document.getElementById("cge-limit-check").checked;
    const limitNum = limitEnabled ? parseInt(document.getElementById("cge-limit-num").value, 10) : null;
    const multiMsgOnly = document.getElementById("cge-multi-msg").checked;
    const format = document.getElementById("cge-format").value;

    try {
      setStatus("Authenticating…");
      await getAccessToken();

      setStatus("Fetching conversation list…");
      const metas = await fetchAllConversationMetas(limitNum);

      if (metas.length === 0) {
        setStatus("No conversations found.");
        document.getElementById("cge-cancel").style.display = "none";
        document.getElementById("cge-start").style.display = "";
        return;
      }

      setStatus(`Found ${metas.length} conversation(s). Downloading details…`);
      const allConversations = [];
      let skipped = 0;

      for (let i = 0; i < metas.length; i++) {
        if (abortController.signal.aborted) throw new Error("Export cancelled.");
        setProgress(i + 1, metas.length);
        setStatus(`Downloading ${i + 1}/${metas.length}: ${metas[i].title || "Untitled"}…`);

        let conv;
        try {
          conv = await fetchConversation(metas[i].id);
        } catch (e) {
          if (e.message === "Export cancelled.") throw e;
          setStatus(`Warning: failed to fetch "${metas[i].title}" – skipping.`);
          skipped++;
          await sleep(BATCH_DELAY_MS);
          continue;
        }

        const messages = extractMessages(conv);

        if (multiMsgOnly) {
          const userMsgCount = messages.filter((m) => m.role === "user").length;
          if (userMsgCount <= 1) {
            skipped++;
            await sleep(BATCH_DELAY_MS);
            continue;
          }
        }

        allConversations.push({ meta: metas[i], conv, messages });
        await sleep(BATCH_DELAY_MS);
      }

      if (allConversations.length === 0) {
        setStatus(`No conversations matched your filters (${skipped} skipped).`);
        document.getElementById("cge-cancel").style.display = "none";
        document.getElementById("cge-start").style.display = "";
        return;
      }

      setStatus(`Preparing download… (${allConversations.length} conversations, ${skipped} skipped)`);

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

      if (format === "json" || format === "both") {
        const jsonData = allConversations.map(({ conv, messages }) =>
          conversationToJSON(conv, messages)
        );
        const jsonStr = JSON.stringify(jsonData, null, 2);
        downloadFile(`chatgpt-export-${timestamp}.json`, jsonStr, "application/json");
      }

      if (format === "markdown" || format === "both") {
        const mdParts = allConversations.map(({ conv, messages }) =>
          conversationToMarkdown(conv, messages)
        );
        const mdStr = mdParts.join("\n\n---\n\n");
        downloadFile(`chatgpt-export-${timestamp}.md`, mdStr, "text/markdown");
      }

      setStatus(
        `Done! Exported ${allConversations.length} conversation(s)` +
        (skipped ? `, ${skipped} skipped` : "") + "."
      );
    } catch (err) {
      if (err.message === "Export cancelled.") {
        setStatus("Export cancelled by user.");
      } else {
        setStatus(`Error: ${err.message}`);
        console.error("[ChatGPT Export]", err);
      }
    } finally {
      document.getElementById("cge-cancel").style.display = "none";
      document.getElementById("cge-start").style.display = "";
    }
  }

  // ── Launch ─────────────────────────────────────────────────────────
  buildUI();
})();
