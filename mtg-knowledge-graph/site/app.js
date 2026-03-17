/* MTG Knowledge Graph – Static Client-Side App */

let cy;
let allElements = [];
let nodeIndex = {};      // id → node data
let adjOut = {};         // id → [{target, rel, data}]
let adjIn = {};          // id → [{source, rel, data}]
let currentLayout = "fcose";

const NODE_COLORS = {
  Card: "#58a6ff",
  Color: "#f0c040",
  CardType: "#3fb950",
  Supertype: "#3fb950",
  Subtype: "#bc8cff",
  Keyword: "#f85149",
  Set: "#d29922",
};

const NODE_SIZES = {
  Card: 20, Color: 35, CardType: 30, Supertype: 22,
  Subtype: 24, Keyword: 24, Set: 18,
};

const DEFAULT_COLOR = "#8b949e";

// ── Boot ────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", init);

async function init() {
  initCytoscape();
  setupSidebar();
  setupSearch();
  setupFilters();
  setupControls();
  setupLegend();
  await loadGraph();
}

function initCytoscape() {
  cy = cytoscape({
    container: document.getElementById("cy"),
    style: cyStyle(),
    wheelSensitivity: 0.3,
    minZoom: 0.03,
    maxZoom: 5,
  });
  cy.on("tap", "node", onNodeTap);
  cy.on("tap", (e) => { if (e.target === cy) clearSelection(); });
}

function cyStyle() {
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "font-size": 8,
        "text-valign": "bottom",
        "text-margin-y": 4,
        color: "#8b949e",
        "text-outline-width": 2,
        "text-outline-color": "#0d1117",
        "background-color": (el) => NODE_COLORS[el.data("node_type")] || DEFAULT_COLOR,
        width: (el) => NODE_SIZES[el.data("node_type")] || 18,
        height: (el) => NODE_SIZES[el.data("node_type")] || 18,
        "border-width": 0,
        "overlay-padding": 6,
      },
    },
    {
      selector: "node[node_type='Card']",
      style: { shape: "round-rectangle", width: 22, height: 30 },
    },
    {
      selector: "node:selected",
      style: { "border-width": 3, "border-color": "#fff" },
    },
    {
      selector: "edge",
      style: {
        width: 1,
        "line-color": "#30363d",
        "target-arrow-color": "#30363d",
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
        "arrow-scale": 0.6,
        opacity: 0.4,
      },
    },
    {
      selector: "edge[rel='SYNERGY']",
      style: {
        "line-color": "#d29922",
        "target-arrow-color": "#d29922",
        "line-style": "dashed",
        width: 1.5,
        opacity: 0.6,
      },
    },
    {
      selector: "edge[rel='HAS_COLOR']",
      style: { "line-color": "#f0c040", "target-arrow-color": "#f0c040" },
    },
    {
      selector: "edge[rel='HAS_TYPE']",
      style: { "line-color": "#3fb950", "target-arrow-color": "#3fb950" },
    },
    {
      selector: "edge[rel='HAS_KEYWORD']",
      style: { "line-color": "#f85149", "target-arrow-color": "#f85149" },
    },
    { selector: ".highlighted", style: { "border-width": 3, "border-color": "#58a6ff", "z-index": 10, opacity: 1 } },
    { selector: ".dimmed", style: { opacity: 0.12 } },
    { selector: ".path-node", style: { "border-width": 3, "border-color": "#3fb950", "z-index": 10 } },
    { selector: ".path-edge", style: { "line-color": "#3fb950", "target-arrow-color": "#3fb950", width: 3, opacity: 1, "z-index": 10 } },
  ];
}

// ── Data Loading ────────────────────────────────────────────────────────────

async function loadGraph() {
  showLoading("Downloading knowledge graph…");
  try {
    const resp = await fetch("graph.json");
    allElements = await resp.json();
    buildIndex();
    const stats = getStats();
    document.getElementById("headerStats").textContent =
      `${stats.nodes} nodes · ${stats.edges} edges · ${stats.cards} cards`;
    showView("HAS_TYPE");
    toast("Loaded! Showing card-type relationships.");
  } catch (e) {
    toast("Failed to load graph: " + e.message);
  }
  hideLoading();
}

function buildIndex() {
  nodeIndex = {};
  adjOut = {};
  adjIn = {};
  for (const el of allElements) {
    if (el.group === "nodes") {
      nodeIndex[el.data.id] = el.data;
    } else {
      const { source, target, rel } = el.data;
      if (!adjOut[source]) adjOut[source] = [];
      adjOut[source].push({ target, rel, data: el.data });
      if (!adjIn[target]) adjIn[target] = [];
      adjIn[target].push({ source, rel, data: el.data });
    }
  }
}

function getStats() {
  let nodes = 0, edges = 0, cards = 0;
  for (const el of allElements) {
    if (el.group === "nodes") {
      nodes++;
      if (el.data.node_type === "Card") cards++;
    } else {
      edges++;
    }
  }
  return { nodes, edges, cards };
}

// ── Client-Side Queries ─────────────────────────────────────────────────────

function searchNodes(q) {
  q = q.toLowerCase();
  const results = [];
  for (const id in nodeIndex) {
    const d = nodeIndex[id];
    if ((d.label || "").toLowerCase().includes(q)) {
      results.push(d);
    }
  }
  results.sort((a, b) => (a.label || "").localeCompare(b.label || ""));
  return results.slice(0, 60);
}

function getNeighborhood(nodeId) {
  const nodes = new Set([nodeId]);
  for (const e of (adjOut[nodeId] || [])) nodes.add(e.target);
  for (const e of (adjIn[nodeId] || [])) nodes.add(e.source);

  const elements = [];
  for (const nid of nodes) {
    if (nodeIndex[nid]) {
      elements.push({ group: "nodes", data: { id: nid, ...nodeIndex[nid] } });
    }
  }
  for (const el of allElements) {
    if (el.group === "edges") {
      const { source, target } = el.data;
      if (nodes.has(source) && nodes.has(target)) {
        elements.push(el);
      }
    }
  }
  return elements;
}

function filterByRel(rel) {
  const nodes = new Set();
  const edges = [];
  for (const el of allElements) {
    if (el.group === "edges" && el.data.rel === rel) {
      nodes.add(el.data.source);
      nodes.add(el.data.target);
      edges.push(el);
    }
  }
  const elements = [];
  for (const nid of nodes) {
    if (nodeIndex[nid]) {
      elements.push({ group: "nodes", data: { id: nid, ...nodeIndex[nid] } });
    }
  }
  return elements.concat(edges);
}

function queryCards(filters) {
  let candidates = null;

  const relFilters = [
    { param: filters.color, rel: "HAS_COLOR_IDENTITY", target: (v) => `color:${v}` },
    { param: filters.cardType, rel: "HAS_TYPE", target: (v) => `cardtype:${v}` },
    { param: filters.subtype, rel: "HAS_SUBTYPE", target: (v) => `subtype:${v}` },
    { param: filters.keyword, rel: "HAS_KEYWORD", target: (v) => `keyword:${v}` },
  ];

  for (const f of relFilters) {
    if (!f.param) continue;
    const targetId = f.target(f.param);
    const matching = new Set();
    for (const e of (adjIn[targetId] || [])) {
      if (e.rel === f.rel) matching.add(e.source);
    }
    candidates = candidates ? intersect(candidates, matching) : matching;
  }

  if (!candidates) {
    candidates = new Set();
    for (const id in nodeIndex) {
      if (nodeIndex[id].node_type === "Card") candidates.add(id);
    }
  }

  return [...candidates].filter((id) => nodeIndex[id]?.node_type === "Card");
}

function findShortestPath(sourceId, targetId) {
  if (!nodeIndex[sourceId] || !nodeIndex[targetId]) return null;

  const undirectedAdj = {};
  for (const el of allElements) {
    if (el.group !== "edges") continue;
    const { source, target } = el.data;
    if (!undirectedAdj[source]) undirectedAdj[source] = [];
    if (!undirectedAdj[target]) undirectedAdj[target] = [];
    undirectedAdj[source].push(target);
    undirectedAdj[target].push(source);
  }

  const visited = new Set([sourceId]);
  const queue = [[sourceId]];
  while (queue.length) {
    const path = queue.shift();
    const node = path[path.length - 1];
    if (node === targetId) return path;
    for (const neighbor of (undirectedAdj[node] || [])) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
    if (visited.size > 5000) break;
  }
  return null;
}

function intersect(a, b) {
  const result = new Set();
  for (const x of a) if (b.has(x)) result.add(x);
  return result;
}

// ── Rendering ───────────────────────────────────────────────────────────────

function renderGraph(elements) {
  cy.elements().remove();

  const MAX = 1200;
  const nodes = elements.filter((e) => e.group === "nodes");
  const edges = elements.filter((e) => e.group === "edges");

  let nodeSet;
  if (nodes.length > MAX) {
    const cards = nodes.filter((n) => n.data.node_type === "Card");
    const others = nodes.filter((n) => n.data.node_type !== "Card");
    const sub = cards.slice(0, MAX - others.length);
    nodeSet = new Set([...sub, ...others].map((n) => n.data.id));
    toast(`Showing ${nodeSet.size} of ${nodes.length} nodes`);
  } else {
    nodeSet = new Set(nodes.map((n) => n.data.id));
  }

  const addedEdges = new Set();
  const filtered = nodes.filter((n) => nodeSet.has(n.data.id));
  const filteredEdges = [];
  for (const e of edges) {
    if (nodeSet.has(e.data.source) && nodeSet.has(e.data.target)) {
      const eid = `${e.data.source}|${e.data.target}|${e.data.rel}`;
      if (!addedEdges.has(eid)) {
        addedEdges.add(eid);
        filteredEdges.push({
          group: "edges",
          data: { id: eid, ...e.data },
        });
      }
    }
  }

  cy.add(filtered);
  cy.add(filteredEdges);
  runLayout();
}

function runLayout(name) {
  if (name) currentLayout = name;
  cy.layout(layoutOpts(currentLayout)).run();
}

function layoutOpts(name) {
  const base = { animate: true, animationDuration: 500 };
  switch (name) {
    case "fcose":
      return {
        ...base, name: "fcose",
        nodeDimensionsIncludeLabels: true,
        idealEdgeLength: 80,
        nodeRepulsion: 8000,
        edgeElasticity: 0.1,
        gravity: 0.3,
        numIter: 2500,
        quality: "default",
        randomize: true,
      };
    case "circle":
      return { ...base, name: "circle" };
    case "concentric":
      return {
        ...base, name: "concentric",
        concentric: (n) => (n.data("node_type") === "Card" ? 1 : 2),
        levelWidth: () => 2,
      };
    default:
      return { ...base, name: "fcose" };
  }
}

// ── Interaction ─────────────────────────────────────────────────────────────

function onNodeTap(evt) {
  const node = evt.target;
  cy.elements().removeClass("highlighted dimmed");
  const hood = node.neighborhood().add(node);
  cy.elements().not(hood).addClass("dimmed");
  hood.addClass("highlighted");
  showDetail(node);

  if (window.innerWidth <= 768) {
    openSidebar();
  }
}

function clearSelection() {
  cy.elements().removeClass("highlighted dimmed path-node path-edge");
  document.getElementById("detailPanel").classList.remove("visible");
}

function showDetail(node) {
  const d = node.data();
  const panel = document.getElementById("detailPanel");
  panel.classList.add("visible");

  const img = document.getElementById("detailImage");
  if (d.image) { img.src = d.image; img.style.display = "block"; }
  else { img.style.display = "none"; }

  document.getElementById("detailName").textContent = d.label || d.id;

  const meta = [];
  if (d.node_type) meta.push(d.node_type);
  if (d.mana_cost) meta.push(d.mana_cost);
  if (d.rarity) meta.push(d.rarity);
  if (d.set_name) meta.push(d.set_name);
  if (d.power && d.toughness) meta.push(`${d.power}/${d.toughness}`);
  if (d.loyalty) meta.push(`Loyalty: ${d.loyalty}`);
  document.getElementById("detailMeta").textContent = meta.join(" · ");

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
    relMap[rel].push(other);
  });

  for (const [rel, nodes] of Object.entries(relMap)) {
    const group = document.createElement("div");
    group.className = "rel-group";
    group.innerHTML = `<div class="rel-label">${rel}</div><div class="rel-values">${nodes
      .map(
        (n) =>
          `<span class="rel-tag" data-id="${n.id()}" style="border-left:3px solid ${
            NODE_COLORS[n.data("node_type")] || DEFAULT_COLOR
          }">${n.data("label") || n.id()}</span>`
      )
      .join("")}</div>`;
    rels.appendChild(group);
  }

  rels.querySelectorAll(".rel-tag").forEach((tag) => {
    tag.addEventListener("click", () => {
      const n = cy.getElementById(tag.dataset.id);
      if (n.length) {
        n.emit("tap");
        cy.animate({ center: { eles: n } }, { duration: 300 });
      }
    });
  });

  document.getElementById("btnExplore").onclick = () => {
    const els = getNeighborhood(d.id);
    renderGraph(els);
    setTimeout(() => {
      const n = cy.getElementById(d.id);
      if (n.length) {
        n.select();
        cy.animate({ center: { eles: n }, zoom: 1.2 }, { duration: 300 });
      }
    }, 600);
    if (window.innerWidth <= 768) closeSidebar();
  };
}

// ── Sidebar ─────────────────────────────────────────────────────────────────

function setupSidebar() {
  const toggle = document.getElementById("menuToggle");
  const overlay = document.getElementById("sidebarOverlay");
  const close = document.getElementById("closeDetail");

  toggle.addEventListener("click", () => {
    const sidebar = document.getElementById("sidebar");
    if (sidebar.classList.contains("open")) closeSidebar();
    else openSidebar();
  });

  overlay.addEventListener("click", closeSidebar);

  close.addEventListener("click", () => {
    document.getElementById("detailPanel").classList.remove("visible");
  });
}

function openSidebar() {
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("sidebarOverlay").classList.add("open");
}

function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebarOverlay").classList.remove("open");
}

// ── Search ──────────────────────────────────────────────────────────────────

function setupSearch() {
  const input = document.getElementById("searchInput");
  const results = document.getElementById("searchResults");
  let debounce;

  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const q = input.value.trim();
      if (q.length < 2) { results.classList.remove("visible"); return; }

      const items = searchNodes(q);
      results.innerHTML = items
        .map(
          (item) =>
            `<div class="search-result-item" data-id="${item.id}">
              <span class="node-badge" style="background:${
                NODE_COLORS[item.node_type] || DEFAULT_COLOR
              }">${item.node_type || "?"}</span>
              ${item.label || item.id}
            </div>`
        )
        .join("");
      results.classList.toggle("visible", items.length > 0);
    }, 200);
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
      const els = getNeighborhood(id);
      renderGraph(els);
      setTimeout(() => {
        const n = cy.getElementById(id);
        if (n.length) {
          n.select();
          cy.animate({ center: { eles: n }, zoom: 1.2 }, { duration: 300 });
        }
      }, 600);
    }
    if (window.innerWidth <= 768) closeSidebar();
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-box")) results.classList.remove("visible");
  });
}

// ── Filters ─────────────────────────────────────────────────────────────────

function setupFilters() {
  const activeColors = new Set();

  document.querySelectorAll(".color-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const c = btn.dataset.color;
      if (activeColors.has(c)) { activeColors.delete(c); btn.classList.remove("active"); }
      else { activeColors.add(c); btn.classList.add("active"); }
    });
  });

  document.getElementById("btnQuery").addEventListener("click", () => {
    const filters = {
      color: activeColors.size ? [...activeColors][0] : "",
      cardType: document.getElementById("filterType").value,
      keyword: titleCase(document.getElementById("filterKeyword").value.trim()),
      subtype: titleCase(document.getElementById("filterSubtype").value.trim()),
    };

    showLoading("Filtering…");
    setTimeout(() => {
      const cardIds = queryCards(filters);
      if (!cardIds.length) { toast("No cards match."); hideLoading(); return; }

      toast(`${cardIds.length} card(s) found`);
      const limit = Math.min(cardIds.length, 30);
      const nodeSet = new Set();
      const elements = [];
      for (let i = 0; i < limit; i++) {
        const hood = getNeighborhood(cardIds[i]);
        for (const el of hood) {
          const key = el.group === "nodes" ? el.data.id : `${el.data.source}|${el.data.target}|${el.data.rel}`;
          if (!nodeSet.has(key)) { nodeSet.add(key); elements.push(el); }
        }
      }
      renderGraph(elements);
      hideLoading();
      if (window.innerWidth <= 768) closeSidebar();
    }, 50);
  });

  document.getElementById("btnReset").addEventListener("click", () => {
    activeColors.clear();
    document.querySelectorAll(".color-btn").forEach((b) => b.classList.remove("active"));
    document.getElementById("filterType").value = "";
    document.getElementById("filterKeyword").value = "";
    document.getElementById("filterSubtype").value = "";
    document.getElementById("viewRel").value = "";
    showView("HAS_TYPE");
    if (window.innerWidth <= 768) closeSidebar();
  });

  document.getElementById("btnView").addEventListener("click", () => {
    const rel = document.getElementById("viewRel").value;
    showView(rel);
    if (window.innerWidth <= 768) closeSidebar();
  });

  document.getElementById("btnPath").addEventListener("click", () => {
    const from = document.getElementById("pathFrom").value.trim();
    const to = document.getElementById("pathTo").value.trim();
    if (!from || !to) { toast("Enter both node IDs"); return; }

    showLoading("Finding path…");
    setTimeout(() => {
      const path = findShortestPath(from, to);
      if (!path) { toast("No path found"); hideLoading(); return; }

      const pathSet = new Set(path);
      const elements = [];
      const added = new Set();
      for (const nid of pathSet) {
        if (nodeIndex[nid]) {
          elements.push({ group: "nodes", data: { id: nid, ...nodeIndex[nid] } });
        }
      }
      for (const el of allElements) {
        if (el.group === "edges" && pathSet.has(el.data.source) && pathSet.has(el.data.target)) {
          const eid = `${el.data.source}|${el.data.target}|${el.data.rel}`;
          if (!added.has(eid)) { added.add(eid); elements.push({ ...el, data: { id: eid, ...el.data } }); }
        }
      }
      renderGraph(elements);
      setTimeout(() => {
        cy.elements("node").addClass("path-node");
        cy.elements("edge").addClass("path-edge");
      }, 600);
      toast(`Path: ${path.length} hops`);
      hideLoading();
      if (window.innerWidth <= 768) closeSidebar();
    }, 50);
  });
}

function showView(rel) {
  showLoading("Updating view…");
  setTimeout(() => {
    if (rel) {
      const els = filterByRel(rel);
      renderGraph(els);
      toast(`Showing ${rel} relationships`);
    } else {
      renderGraph(allElements);
      toast("Showing full graph");
    }
    hideLoading();
  }, 50);
}

// ── Controls ────────────────────────────────────────────────────────────────

function setupControls() {
  document.getElementById("btnZoomIn").addEventListener("click", () => {
    cy.zoom({ level: cy.zoom() * 1.3, renderedPosition: center() });
  });
  document.getElementById("btnZoomOut").addEventListener("click", () => {
    cy.zoom({ level: cy.zoom() / 1.3, renderedPosition: center() });
  });
  document.getElementById("btnFit").addEventListener("click", () => cy.fit(undefined, 30));

  document.querySelectorAll(".layout-picker .btn").forEach((btn) => {
    btn.addEventListener("click", () => runLayout(btn.dataset.layout));
  });
}

function setupLegend() {
  const legend = document.getElementById("legend");
  document.getElementById("legendToggle").addEventListener("click", () => {
    legend.classList.toggle("expanded");
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function center() {
  return { x: cy.width() / 2, y: cy.height() / 2 };
}

function showLoading(msg) {
  document.getElementById("loadingText").textContent = msg || "Loading…";
  document.getElementById("loadingOverlay").classList.remove("hidden");
}

function hideLoading() {
  document.getElementById("loadingOverlay").classList.add("hidden");
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("visible");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("visible"), 3000);
}

function titleCase(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}
