/* MTG Knowledge Graph – Frontend */

const API = "";
let cy;
let currentLayout = "fcose";
let selectedNode = null;
let localMode = false;
let localElements = null;
let activeColors = new Set();
let colorMode = "type";
let nodeLabel = "name";

const NODE_COLORS = {
  Card: "#58a6ff",
  Color: "#f0c040",
  CardType: "#3fb950",
  Supertype: "#3fb950",
  Subtype: "#bc8cff",
  Keyword: "#f85149",
  Set: "#d29922",
  Rarity: "#8b949e",
  ManaValue: "#8b949e",
  Format: "#f778ba",
  Trigger: "#79c0ff",
};

const NODE_SIZES = {
  Card: 20,
  Color: 35,
  CardType: 30,
  Supertype: 22,
  Subtype: 24,
  Keyword: 24,
  Set: 18,
  Rarity: 18,
  ManaValue: 16,
  Format: 22,
  Trigger: 26,
};

const MANA_HEX = {
  W: "#f9faf4",
  U: "#0e68ab",
  B: "#150b00",
  R: "#d3202a",
  G: "#00733e",
};

// ── Initialization ──────────────────────────────────────────────────────────

async function init() {
  cy = cytoscape({
    container: document.getElementById("cy"),
    style: cyStyle(),
    wheelSensitivity: 0.3,
    minZoom: 0.05,
    maxZoom: 5,
  });

  cy.on("tap", "node", onNodeTap);
  cy.on("tap", (e) => { if (e.target === cy) clearSelection(); });

  setupSidebar();
  setupSearch();
  setupFilters();
  setupControls();
  setupLegend();

  await loadStats();
  await loadInitialView();
}

function cyStyle() {
  return [
    {
      selector: "node",
      style: {
        label: (el) => getNodeLabel(el),
        "font-size": 8,
        "text-valign": "center",
        "text-halign": "center",
        "text-margin-y": 0,
        color: (el) => getNodeLabelColor(el),
        "text-outline-width": 0,
        "text-outline-color": "#0d1117",
        "background-color": (el) => getNodeColor(el),
        width: (el) => NODE_SIZES[el.data("node_type")] || 18,
        height: (el) => NODE_SIZES[el.data("node_type")] || 18,
        "border-width": 0,
        "overlay-padding": 4,
        "text-wrap": "ellipsis",
        "text-max-width": (el) => (NODE_SIZES[el.data("node_type")] || 18) - 4 + "px",
        "pie-size": "100%",
        "pie-1-background-color": (el) => getPieColor(el, 0),
        "pie-1-background-size": (el) => getPieSize(el, 0),
        "pie-2-background-color": (el) => getPieColor(el, 1),
        "pie-2-background-size": (el) => getPieSize(el, 1),
        "pie-3-background-color": (el) => getPieColor(el, 2),
        "pie-3-background-size": (el) => getPieSize(el, 2),
        "pie-4-background-color": (el) => getPieColor(el, 3),
        "pie-4-background-size": (el) => getPieSize(el, 3),
        "pie-5-background-color": (el) => getPieColor(el, 4),
        "pie-5-background-size": (el) => getPieSize(el, 4),
      },
    },
    {
      selector: "node[node_type='Card']",
      style: { shape: "round-rectangle", width: 22, height: 30 },
    },
    {
      selector: "node[node_type='Trigger']",
      style: { shape: "diamond", width: 26, height: 26 },
    },
    {
      selector: "node:selected",
      style: { "border-width": 3, "border-color": "#fff" },
    },
    {
      selector: "edge",
      style: {
        width: (el) => Math.min(0.5 + (el.data("weight") || 1) * 0.5, 5),
        "line-color": "#30363d",
        "target-arrow-color": "#30363d",
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
        "arrow-scale": 0.6,
        opacity: (el) => Math.min(0.3 + (el.data("weight") || 1) * 0.1, 1),
      },
    },
    {
      selector: "edge[rel='SYNERGY']",
      style: {
        "line-color": "#d29922", "target-arrow-color": "#d29922", "line-style": "dashed",
        width: (el) => Math.min(1 + (el.data("weight") || 1) * 0.5, 5),
        opacity: (el) => Math.min(0.4 + (el.data("weight") || 1) * 0.15, 1),
      },
    },
    { selector: "edge[rel='HAS_COLOR']", style: { "line-color": "#f0c040", "target-arrow-color": "#f0c040" } },
    { selector: "edge[rel='HAS_TYPE']", style: { "line-color": "#3fb950", "target-arrow-color": "#3fb950" } },
    { selector: "edge[rel='HAS_KEYWORD']", style: { "line-color": "#f85149", "target-arrow-color": "#f85149" } },
    {
      selector: "edge[rel='HAS_TRIGGER']",
      style: { "line-color": "#79c0ff", "target-arrow-color": "#79c0ff", "line-style": "dotted" },
    },
    {
      selector: ".highlighted",
      style: { "border-width": 3, "border-color": "#58a6ff", "z-index": 10, opacity: 1 },
    },
    { selector: ".dimmed", style: { opacity: 0.15 } },
    {
      selector: ".path-node",
      style: { "border-width": 3, "border-color": "#3fb950", "z-index": 10 },
    },
    {
      selector: ".path-edge",
      style: { "line-color": "#3fb950", "target-arrow-color": "#3fb950", width: 3, opacity: 1, "z-index": 10 },
    },
  ];
}

// ── Color Identity Helpers ──────────────────────────────────────────────────

function getNodeColor(el) {
  if (colorMode === "identity" && el.data("node_type") === "Card") {
    const ci = el.data("color_identity");
    if (!ci) return "#8b949e";
    const colors = ci.split(",").filter(Boolean);
    if (colors.length === 0) return "#8b949e";
    if (colors.length === 1) return MANA_HEX[colors[0]] || "#8b949e";
    return "transparent";
  }
  return NODE_COLORS[el.data("node_type")] || "#8b949e";
}

function getPieColor(el, index) {
  if (colorMode !== "identity" || el.data("node_type") !== "Card") return "#000";
  const ci = el.data("color_identity");
  if (!ci) return "#000";
  const colors = ci.split(",").filter(Boolean);
  if (colors.length <= 1) return "#000";
  return index < colors.length ? (MANA_HEX[colors[index]] || "#8b949e") : "#000";
}

function getPieSize(el, index) {
  if (colorMode !== "identity" || el.data("node_type") !== "Card") return 0;
  const ci = el.data("color_identity");
  if (!ci) return 0;
  const colors = ci.split(",").filter(Boolean);
  if (colors.length <= 1) return 0;
  return index < colors.length ? (100 / colors.length) : 0;
}

function getNodeLabel(el) {
  const nt = el.data("node_type");
  if (nt !== "Card") return el.data("label") || "";
  switch (nodeLabel) {
    case "name": return el.data("label") || "";
    case "mana_value": { const c = el.data("cmc"); return c != null ? String(Math.round(c)) : ""; }
    case "power_toughness": { const p = el.data("power"), t = el.data("toughness"); return (p && t) ? `${p}/${t}` : ""; }
    case "none": return "";
    default: return el.data("label") || "";
  }
}

function getNodeLabelColor(el) {
  if (colorMode === "identity" && el.data("node_type") === "Card") {
    const ci = el.data("color_identity");
    if (!ci) return "#e6edf3";
    const colors = ci.split(",").filter(Boolean);
    if (colors.length !== 1) return "#e6edf3";
    const c = colors[0];
    return (c === "W" || c === "G") ? "#111" : "#e6edf3";
  }
  return "#8b949e";
}

// ── API Helpers ──────────────────────────────────────────────────────────────

async function fetchJSON(url) {
  const resp = await fetch(API + url);
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return resp.json();
}

// ── Reading UI state ────────────────────────────────────────────────────────

function getViewState() {
  return {
    rel: document.getElementById("viewRel").value,
    nodeType: document.getElementById("viewNodeType").value,
  };
}

function getActiveFilterState() {
  return {
    colors: activeColors,
    type: document.getElementById("filterType").value,
    keyword: document.getElementById("filterKeyword").value.trim(),
    subtype: document.getElementById("filterSubtype").value.trim(),
    format: document.getElementById("filterFormat").value,
  };
}

function hasActiveFilters() {
  const f = getActiveFilterState();
  return f.colors.size > 0 || f.type || f.keyword || f.subtype || f.format;
}

// ── Unified filter pipeline ─────────────────────────────────────────────────
// raw elements → applyViewToElements (rel, nodeType) → applyCardFilters → render

function applyViewToElements(elements, rel, nodeType) {
  if (!rel && !nodeType) return elements;

  const nodeMap = {};
  const edges = [];
  for (const el of elements) {
    if (el.group === "nodes") nodeMap[el.data.id] = el;
    else edges.push(el);
  }

  let keptEdges = edges;
  if (rel) {
    keptEdges = keptEdges.filter((e) => e.data.rel === rel);
  }

  let anchorNodeIds = null;
  if (nodeType) {
    anchorNodeIds = new Set(
      Object.values(nodeMap)
        .filter((n) => n.data.node_type === nodeType)
        .map((n) => n.data.id)
    );
    keptEdges = keptEdges.filter(
      (e) => anchorNodeIds.has(e.data.source) || anchorNodeIds.has(e.data.target)
    );
  }

  const resultNodeIds = new Set();
  for (const e of keptEdges) {
    resultNodeIds.add(e.data.source);
    resultNodeIds.add(e.data.target);
  }

  const result = [];
  for (const nid of resultNodeIds) {
    if (nodeMap[nid]) result.push(nodeMap[nid]);
  }
  result.push(...keptEdges);
  return result;
}

function applyCardFilters(elements, filters) {
  const f = filters;
  if (!f.colors.size && !f.type && !f.keyword && !f.subtype && !f.format) {
    return elements;
  }

  const nodeMap = {};
  const edges = [];
  for (const el of elements) {
    if (el.group === "nodes") nodeMap[el.data.id] = el;
    else edges.push(el);
  }

  const cardNodes = Object.values(nodeMap).filter((n) => n.data.node_type === "Card");
  const matchingCardIds = new Set();

  for (const card of cardNodes) {
    const d = card.data;
    let pass = true;

    if (f.colors.size > 0) {
      const ci = (d.color_identity || "").split(",").filter(Boolean);
      let colorMatch = false;
      for (const c of f.colors) { if (ci.includes(c)) { colorMatch = true; break; } }
      if (!colorMatch) {
        const cardEdges = edges.filter(
          (e) => e.data.source === d.id && e.data.rel === "HAS_COLOR_IDENTITY"
        );
        const edgeColors = new Set(cardEdges.map((e) => e.data.target.replace("color:", "")));
        colorMatch = false;
        for (const c of f.colors) { if (edgeColors.has(c)) { colorMatch = true; break; } }
        if (!colorMatch) pass = false;
      }
    }

    if (pass && f.type) {
      const typeEdges = edges.filter((e) => e.data.source === d.id && e.data.rel === "HAS_TYPE");
      const types = typeEdges.map((e) => { const t = nodeMap[e.data.target]; return t ? t.data.label : ""; });
      if (!types.some((t) => t.toLowerCase() === f.type.toLowerCase())) pass = false;
    }

    if (pass && f.keyword) {
      const kwEdges = edges.filter((e) => e.data.source === d.id && e.data.rel === "HAS_KEYWORD");
      const kws = kwEdges.map((e) => { const t = nodeMap[e.data.target]; return t ? t.data.label.toLowerCase() : ""; });
      if (!kws.some((k) => k.includes(f.keyword.toLowerCase()))) pass = false;
    }

    if (pass && f.subtype) {
      const subEdges = edges.filter((e) => e.data.source === d.id && e.data.rel === "HAS_SUBTYPE");
      const subs = subEdges.map((e) => { const t = nodeMap[e.data.target]; return t ? t.data.label.toLowerCase() : ""; });
      if (!subs.some((s) => s.includes(f.subtype.toLowerCase()))) pass = false;
    }

    if (pass && f.format) {
      const fmtEdges = edges.filter((e) => e.data.source === d.id && e.data.rel === "LEGAL_IN");
      const fmts = fmtEdges.map((e) => { const t = nodeMap[e.data.target]; return t ? t.data.label.toLowerCase() : ""; });
      if (!fmts.some((fn) => fn.includes(f.format.toLowerCase()))) pass = false;
    }

    if (pass) matchingCardIds.add(d.id);
  }

  if (matchingCardIds.size === 0) return [];

  const resultNodeIds = new Set(matchingCardIds);
  const resultEdges = [];
  for (const edge of edges) {
    if (matchingCardIds.has(edge.data.source) || matchingCardIds.has(edge.data.target)) {
      resultNodeIds.add(edge.data.source);
      resultNodeIds.add(edge.data.target);
      resultEdges.push(edge);
    }
  }

  const result = [];
  for (const nid of resultNodeIds) { if (nodeMap[nid]) result.push(nodeMap[nid]); }
  result.push(...resultEdges);
  return result;
}

function runLocalPipeline() {
  if (!localElements) return;
  const view = getViewState();
  const filters = getActiveFilterState();

  let elements = localElements;
  elements = applyViewToElements(elements, view.rel, view.nodeType);
  elements = applyCardFilters(elements, filters);

  if (!elements.length) {
    toast("No cards in this neighborhood match the current view/filters.");
    return;
  }

  const cardCount = elements.filter((e) => e.group === "nodes" && e.data.node_type === "Card").length;
  renderGraph(elements);
  toast(`Local view: ${cardCount} card(s) shown.`);
}

// ── Data Loading ────────────────────────────────────────────────────────────

async function loadStats() {
  try {
    const stats = await fetchJSON("/api/stats");
    document.getElementById("headerStats").textContent =
      `${stats.total_nodes} nodes · ${stats.total_edges} edges · ${stats.node_types.Card || 0} cards`;
  } catch (e) {
    document.getElementById("headerStats").textContent = "Error loading stats";
  }
}

async function loadInitialView() {
  exitLocalMode();
  showLoading("Loading trigger overview…");
  try {
    const elements = await fetchJSON("/api/graph?rel=HAS_TRIGGER");
    renderGraph(elements);
    toast("Showing cards connected by trigger type. Use filters to explore.");
  } catch (e) {
    toast("Failed to load graph: " + e.message);
  }
  hideLoading();
}

async function loadNeighborhood(nodeId) {
  showLoading("Loading neighborhood…");
  try {
    const elements = await fetchJSON(`/api/node/${encodeURIComponent(nodeId)}`);
    enterLocalMode(elements);
    runLocalPipeline();
    setTimeout(() => {
      const n = cy.getElementById(nodeId);
      if (n.length) {
        n.select();
        cy.animate({ center: { eles: n }, zoom: 1.5 }, { duration: 300 });
      }
    }, 200);
  } catch (e) {
    toast("Failed to load neighborhood: " + e.message);
  }
  hideLoading();
}

// ── Local Mode ──────────────────────────────────────────────────────────────

function enterLocalMode(elements) {
  localMode = true;
  localElements = elements;
  document.getElementById("localModeBanner").classList.remove("hidden");
}

function exitLocalMode() {
  localMode = false;
  localElements = null;
  document.getElementById("localModeBanner").classList.add("hidden");
}

// ── Graph Rendering ─────────────────────────────────────────────────────────

function renderGraph(elements) {
  cy.elements().remove();

  const MAX_NODES = 1500;
  const nodes = elements.filter((e) => e.group === "nodes");
  const edges = elements.filter((e) => e.group === "edges");

  let nodeSet;
  if (nodes.length > MAX_NODES) {
    const cards = nodes.filter((n) => n.data.node_type === "Card");
    const nonCards = nodes.filter((n) => n.data.node_type !== "Card");
    const subset = cards.slice(0, MAX_NODES - nonCards.length);
    nodeSet = new Set([...subset, ...nonCards].map((n) => n.data.id));
    toast(`Showing ${nodeSet.size} of ${nodes.length} nodes (capped for performance)`);
  } else {
    nodeSet = new Set(nodes.map((n) => n.data.id));
  }

  const filteredNodes = nodes.filter((n) => nodeSet.has(n.data.id));
  const filteredEdges = edges.filter(
    (e) => nodeSet.has(e.data.source) && nodeSet.has(e.data.target)
  );

  const minWeight = parseFloat(document.getElementById("weightSlider").value);
  const finalEdges = minWeight > 1
    ? filteredEdges.filter((e) => (e.data.weight || 1) >= minWeight)
    : filteredEdges;

  cy.add(filteredNodes);
  cy.add(finalEdges);
  runLayout();
}

function runLayout(name) {
  if (name) currentLayout = name;
  cy.layout(layoutOptions(currentLayout)).run();
}

function layoutOptions(name) {
  switch (name) {
    case "fcose":
      return {
        name: "fcose", animate: true, animationDuration: 600,
        nodeDimensionsIncludeLabels: true, idealEdgeLength: 80,
        nodeRepulsion: 8000, edgeElasticity: 0.1, gravity: 0.3,
        numIter: 2500, quality: "default", randomize: true,
      };
    case "circle":
      return { name: "circle", animate: true, animationDuration: 400 };
    case "concentric":
      return {
        name: "concentric", animate: true, animationDuration: 400,
        concentric: (n) => (n.data("node_type") === "Card" ? 1 : 2),
        levelWidth: () => 2,
      };
    case "grid":
      return { name: "grid", animate: true, animationDuration: 400, rows: undefined };
    case "compact": {
      const container = document.getElementById("cy");
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 600;
      const isVertical = h > w;
      return {
        name: "fcose", animate: true, animationDuration: 600,
        nodeDimensionsIncludeLabels: false,
        idealEdgeLength: isVertical ? 40 : 50,
        nodeRepulsion: isVertical ? 3000 : 4000,
        edgeElasticity: 0.2,
        gravity: isVertical ? 0.8 : 0.6,
        gravityRange: isVertical ? 2.0 : 1.5,
        numIter: 3000, quality: "default", randomize: true, tile: true,
        tilingPaddingVertical: isVertical ? 4 : 8,
        tilingPaddingHorizontal: isVertical ? 8 : 4,
      };
    }
    default:
      return { name: "fcose", animate: true };
  }
}

// ── Node Selection ──────────────────────────────────────────────────────────

function onNodeTap(evt) {
  const node = evt.target;
  selectedNode = node.id();
  cy.elements().removeClass("highlighted dimmed");
  const neighborhood = node.neighborhood().add(node);
  cy.elements().not(neighborhood).addClass("dimmed");
  neighborhood.addClass("highlighted");
  showDetail(node);
}

function clearSelection() {
  selectedNode = null;
  cy.elements().removeClass("highlighted dimmed path-node path-edge");
  document.getElementById("detailPanel").classList.remove("visible");
}

async function showDetail(node) {
  const d = node.data();
  const panel = document.getElementById("detailPanel");
  panel.classList.add("visible");

  const img = document.getElementById("detailImage");
  if (d.image) { img.src = d.image; img.style.display = "block"; }
  else { img.style.display = "none"; }

  document.getElementById("detailName").textContent = d.label || d.id;

  const metaParts = [];
  if (d.node_type) metaParts.push(d.node_type);
  if (d.mana_cost) metaParts.push(d.mana_cost);
  if (d.rarity) metaParts.push(d.rarity);
  if (d.set_name) metaParts.push(d.set_name);
  if (d.power && d.toughness) metaParts.push(`${d.power}/${d.toughness}`);
  if (d.loyalty) metaParts.push(`Loyalty: ${d.loyalty}`);
  if (d.color_identity) metaParts.push(`Colors: ${d.color_identity}`);
  document.getElementById("detailMeta").textContent = metaParts.join(" · ");

  const oracle = document.getElementById("detailOracle");
  if (d.oracle_text) { oracle.textContent = d.oracle_text; oracle.style.display = "block"; }
  else { oracle.style.display = "none"; }

  const rels = document.getElementById("detailRelations");
  rels.innerHTML = "";
  const relMap = {};
  node.connectedEdges().forEach((edge) => {
    const rel = edge.data("rel") || "CONNECTED";
    const other = edge.source().id() === node.id() ? edge.target() : edge.source();
    if (!relMap[rel]) relMap[rel] = [];
    relMap[rel].push({ node: other, weight: edge.data("weight") });
  });

  for (const [rel, items] of Object.entries(relMap)) {
    const group = document.createElement("div");
    group.className = "rel-group";
    const valuesHtml = items.map((item) => {
      const n = item.node;
      const wBadge = item.weight && item.weight > 1
        ? ` <span style="font-size:9px;opacity:0.7">×${item.weight}</span>` : "";
      return `<span class="rel-tag" data-id="${n.id()}" style="border-left:3px solid ${
        NODE_COLORS[n.data("node_type")] || "#8b949e"
      }">${n.data("label") || n.id()}${wBadge}</span>`;
    }).join("");
    group.innerHTML = `<div class="rel-label">${rel}</div><div class="rel-values">${valuesHtml}</div>`;
    rels.appendChild(group);
  }

  rels.querySelectorAll(".rel-tag").forEach((tag) => {
    tag.addEventListener("click", () => {
      const n = cy.getElementById(tag.dataset.id);
      if (n.length) { n.emit("tap"); cy.animate({ center: { eles: n } }, { duration: 300 }); }
    });
  });

  document.getElementById("btnExplore").onclick = () => {
    loadNeighborhood(d.id);
    closeSidebarOnMobile();
  };
}

// ── Sidebar ─────────────────────────────────────────────────────────────────

function setupSidebar() {
  const toggle = document.getElementById("sidebarToggle");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");

  toggle.addEventListener("click", () => {
    sidebar.classList.toggle("open");
    overlay.classList.toggle("visible");
  });
  overlay.addEventListener("click", closeSidebarOnMobile);

  document.getElementById("btnExitLocal").addEventListener("click", () => {
    exitLocalMode();
    loadInitialView();
  });
}

function closeSidebarOnMobile() {
  if (window.innerWidth <= 768) {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebarOverlay").classList.remove("visible");
  }
}

// ── Legend ───────────────────────────────────────────────────────────────────

function setupLegend() {
  const toggle = document.getElementById("legendToggle");
  const items = document.getElementById("legendItems");
  if (window.innerWidth <= 768) items.classList.add("collapsed");
  toggle.addEventListener("click", () => {
    items.classList.toggle("collapsed");
    toggle.textContent = items.classList.contains("collapsed") ? "Legend ▸" : "Legend ▾";
  });
}

// ── Search ──────────────────────────────────────────────────────────────────

function setupSearch() {
  const input = document.getElementById("searchInput");
  const results = document.getElementById("searchResults");
  let debounce;

  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 2) { results.classList.remove("visible"); return; }
      try {
        const items = await fetchJSON(`/api/search?q=${encodeURIComponent(q)}`);
        results.innerHTML = items.map((item) =>
          `<div class="search-result-item" data-id="${item.id}">
            <span class="node-badge" style="background:${
              NODE_COLORS[item.node_type] || "#8b949e"
            };color:#fff">${item.node_type || "?"}</span>
            ${item.label || item.id}
          </div>`
        ).join("");
        results.classList.add("visible");
      } catch { results.classList.remove("visible"); }
    }, 250);
  });

  results.addEventListener("click", (e) => {
    const item = e.target.closest(".search-result-item");
    if (!item) return;
    const id = item.dataset.id;
    results.classList.remove("visible");
    input.value = "";
    const existing = cy.getElementById(id);
    if (existing.length) {
      existing.emit("tap");
      cy.animate({ center: { eles: existing }, zoom: 1.5 }, { duration: 300 });
    } else {
      loadNeighborhood(id);
    }
    closeSidebarOnMobile();
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-box")) results.classList.remove("visible");
  });
}

// ── Filters & View ──────────────────────────────────────────────────────────

function setupFilters() {
  // Color filter buttons
  document.querySelectorAll(".color-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const c = btn.dataset.color;
      if (activeColors.has(c)) { activeColors.delete(c); btn.classList.remove("active"); }
      else { activeColors.add(c); btn.classList.add("active"); }
    });
  });

  // Weight slider
  const weightSlider = document.getElementById("weightSlider");
  const weightValue = document.getElementById("weightValue");
  weightSlider.addEventListener("input", () => { weightValue.textContent = weightSlider.value; });
  weightSlider.addEventListener("change", applyWeightFilter);

  // Display: color mode
  const colorModeSelect = document.getElementById("colorModeSelect");
  if (colorModeSelect) {
    colorModeSelect.addEventListener("change", () => { colorMode = colorModeSelect.value; cy.style(cyStyle()); });
  }

  // Display: node label
  const nodeLabelSelect = document.getElementById("nodeLabelSelect");
  if (nodeLabelSelect) {
    nodeLabelSelect.addEventListener("change", () => { nodeLabel = nodeLabelSelect.value; cy.style(cyStyle()); });
  }

  // ── Apply filters button ──────────────────────────────────────────────────
  document.getElementById("btnQuery").addEventListener("click", async () => {
    if (localMode) {
      runLocalPipeline();
      closeSidebarOnMobile();
      return;
    }

    // Global mode: query API
    const f = getActiveFilterState();
    const params = new URLSearchParams();
    if (f.colors.size) params.set("color", [...f.colors][0]);
    if (f.type) params.set("card_type", f.type);
    if (f.keyword) params.set("keyword", f.keyword);
    if (f.subtype) params.set("subtype", f.subtype);
    if (f.format) params.set("format", f.format);

    showLoading("Querying…");
    try {
      const cards = await fetchJSON(`/api/query?${params}`);
      if (!cards.length) { toast("No cards match those filters."); hideLoading(); return; }
      toast(`Found ${cards.length} card(s). Loading subgraph…`);

      const nodeIds = cards.map((c) => c.id);
      const allElements = [];
      for (let i = 0; i < Math.min(nodeIds.length, 30); i++) {
        const els = await fetchJSON(`/api/node/${encodeURIComponent(nodeIds[i])}`);
        allElements.push(...els);
      }
      const seen = new Set();
      const deduped = allElements.filter((el) => {
        if (seen.has(el.data.id)) return false;
        seen.add(el.data.id);
        return true;
      });
      renderGraph(deduped);
    } catch (e) {
      toast("Query failed: " + e.message);
    }
    hideLoading();
    closeSidebarOnMobile();
  });

  // ── Reset button ──────────────────────────────────────────────────────────
  document.getElementById("btnReset").addEventListener("click", () => {
    activeColors.clear();
    document.querySelectorAll(".color-btn").forEach((b) => b.classList.remove("active"));
    document.getElementById("filterType").value = "";
    document.getElementById("filterKeyword").value = "";
    document.getElementById("filterSubtype").value = "";
    document.getElementById("filterFormat").value = "";
    weightSlider.value = "1";
    weightValue.textContent = "1";

    if (localMode && localElements) {
      runLocalPipeline();
      toast("Filters reset – showing neighborhood with current view.");
    } else {
      loadInitialView();
    }
  });

  // ── Update view button ────────────────────────────────────────────────────
  document.getElementById("btnView").addEventListener("click", async () => {
    if (localMode) {
      runLocalPipeline();
      closeSidebarOnMobile();
      return;
    }

    // Global mode: fetch from API
    const view = getViewState();
    const minWeight = parseFloat(weightSlider.value);
    const params = new URLSearchParams();
    if (view.rel) params.set("rel", view.rel);
    if (view.nodeType) params.set("node_type", view.nodeType);
    if (minWeight > 1) params.set("min_weight", minWeight);

    showLoading("Updating view…");
    try {
      const url = params.toString() ? `/api/graph?${params}` : "/api/graph";
      let elements = await fetchJSON(url);

      if (hasActiveFilters()) {
        elements = applyCardFilters(elements, getActiveFilterState());
        if (!elements.length) {
          toast("No nodes match current filters in this view.");
          hideLoading();
          return;
        }
      }

      renderGraph(elements);
      toast(
        view.rel || view.nodeType
          ? `View: ${view.rel || "all rels"} × ${view.nodeType || "all types"}`
          : "Showing full graph"
      );
    } catch (e) {
      toast("View update failed: " + e.message);
    }
    hideLoading();
    closeSidebarOnMobile();
  });

  // ── Path finder ───────────────────────────────────────────────────────────
  document.getElementById("btnPath").addEventListener("click", async () => {
    const from = document.getElementById("pathFrom").value.trim();
    const to = document.getElementById("pathTo").value.trim();
    if (!from || !to) { toast("Enter both source and target node IDs"); return; }

    showLoading("Finding path…");
    try {
      const data = await fetchJSON(
        `/api/path?source=${encodeURIComponent(from)}&target=${encodeURIComponent(to)}`
      );
      if (data.error) { toast(data.error); hideLoading(); return; }
      renderGraph(data.elements);
      setTimeout(() => { cy.elements().addClass("path-node"); cy.edges().addClass("path-edge"); }, 300);
      toast(`Path found: ${data.path.length} hops`);
    } catch (e) {
      toast("Path search failed: " + e.message);
    }
    hideLoading();
    closeSidebarOnMobile();
  });
}

function applyWeightFilter() {
  const minWeight = parseFloat(document.getElementById("weightSlider").value);
  if (minWeight <= 1) { cy.edges().style("display", "element"); return; }
  cy.edges().forEach((edge) => {
    edge.style("display", (edge.data("weight") || 1) >= minWeight ? "element" : "none");
  });
  toast(`Showing connections with weight ≥ ${minWeight}`);
}

// ── Controls ────────────────────────────────────────────────────────────────

function setupControls() {
  document.getElementById("btnZoomIn").addEventListener("click", () => {
    cy.zoom({ level: cy.zoom() * 1.3, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  });
  document.getElementById("btnZoomOut").addEventListener("click", () => {
    cy.zoom({ level: cy.zoom() / 1.3, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  });
  document.getElementById("btnFit").addEventListener("click", () => cy.fit(undefined, 40));
  document.querySelectorAll(".layout-picker .btn").forEach((btn) => {
    btn.addEventListener("click", () => runLayout(btn.dataset.layout));
  });
}

// ── UI Helpers ──────────────────────────────────────────────────────────────

function showLoading(msg) {
  document.getElementById("loadingText").textContent = msg || "Loading…";
  document.getElementById("loadingOverlay").classList.remove("hidden");
}
function hideLoading() { document.getElementById("loadingOverlay").classList.add("hidden"); }

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("visible");
  setTimeout(() => el.classList.remove("visible"), 3000);
}

// ── Boot ────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", init);
