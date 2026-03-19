"""Flask API server for the MTG Knowledge Graph."""

import json
import os
import sys

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import networkx as nx

from backend.scryfall import fetch_subset
from backend.ontology import build_graph, graph_to_cytoscape, graph_stats

app = Flask(__name__, static_folder=None)
CORS(app)

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
CARDS_CACHE = os.path.join(DATA_DIR, "cards.json")
GRAPH_CACHE = os.path.join(DATA_DIR, "graph.json")

_graph = None  # in-memory NetworkX graph
_elements = None  # cached Cytoscape.js elements


def _ensure_data():
    global _graph, _elements
    if _graph is not None:
        return

    os.makedirs(DATA_DIR, exist_ok=True)

    if os.path.exists(GRAPH_CACHE):
        with open(GRAPH_CACHE) as f:
            _elements = json.load(f)
        _graph = _rebuild_nx(_elements)
        return

    print("Fetching cards from Scryfall API…", file=sys.stderr)
    if os.path.exists(CARDS_CACHE):
        with open(CARDS_CACHE) as f:
            cards = json.load(f)
    else:
        cards = fetch_subset()
        with open(CARDS_CACHE, "w") as f:
            json.dump(cards, f)
    print(f"  → {len(cards)} cards loaded", file=sys.stderr)

    _graph = build_graph(cards)
    _elements = graph_to_cytoscape(_graph)

    with open(GRAPH_CACHE, "w") as f:
        json.dump(_elements, f)
    print(f"  → graph built: {_graph.number_of_nodes()} nodes, {_graph.number_of_edges()} edges",
          file=sys.stderr)


def _rebuild_nx(elements):
    G = nx.MultiDiGraph()
    for el in elements:
        if el["group"] == "nodes":
            d = dict(el["data"])
            nid = d.pop("id")
            G.add_node(nid, **d)
        else:
            d = dict(el["data"])
            d.pop("id", None)
            src = d.pop("source")
            tgt = d.pop("target")
            G.add_edge(src, tgt, **d)
    return G


# ── Frontend ─────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/styles.css")
def styles():
    return send_from_directory(FRONTEND_DIR, "styles.css")


@app.route("/app.js")
def app_js():
    return send_from_directory(FRONTEND_DIR, "app.js")


# ── API ──────────────────────────────────────────────────────────────────────

@app.route("/api/graph")
def api_graph():
    """Return full graph as Cytoscape.js elements (optionally filtered)."""
    _ensure_data()
    node_type = request.args.get("node_type")
    rel = request.args.get("rel")
    min_weight = request.args.get("min_weight", type=float)

    if not node_type and not rel and min_weight is None:
        return jsonify(_elements)

    filtered = _filter_elements(node_type, rel, min_weight)
    return jsonify(filtered)


@app.route("/api/stats")
def api_stats():
    _ensure_data()
    return jsonify(graph_stats(_graph))


@app.route("/api/node/<path:node_id>")
def api_node(node_id):
    """Return a node and its immediate neighborhood."""
    _ensure_data()
    if node_id not in _graph:
        return jsonify({"error": "Node not found"}), 404

    subgraph_nodes = {node_id}
    for _, t in _graph.out_edges(node_id):
        subgraph_nodes.add(t)
    for s, _ in _graph.in_edges(node_id):
        subgraph_nodes.add(s)

    elements = []
    for n in subgraph_nodes:
        elements.append({
            "group": "nodes",
            "data": {"id": n, **dict(_graph.nodes[n])},
        })
    seen_edges = set()
    for s, t, d in _graph.edges(data=True):
        if s in subgraph_nodes and t in subgraph_nodes:
            rel = d.get("rel", "")
            eid = f"{s}->{t}:{rel}"
            if eid in seen_edges:
                continue
            seen_edges.add(eid)
            elements.append({
                "group": "edges",
                "data": {
                    "id": eid,
                    "source": s, "target": t, **dict(d),
                },
            })
    return jsonify(elements)


@app.route("/api/search")
def api_search():
    """Search nodes by label substring."""
    _ensure_data()
    q = request.args.get("q", "").lower()
    if not q:
        return jsonify([])

    matches = []
    for nid, data in _graph.nodes(data=True):
        label = data.get("label", "")
        if q in label.lower():
            matches.append({"id": nid, **data})
    matches.sort(key=lambda x: x.get("label", ""))
    return jsonify(matches[:100])


@app.route("/api/query")
def api_query():
    """
    Structured query endpoint.
    Params:
      card_name   – partial card name match
      color       – W/U/B/R/G
      card_type   – Creature/Instant/…
      subtype     – Elf/Wizard/…
      keyword     – Flying/Trample/…
      format      – standard/modern/…
      set_code    – set code
      min_cmc / max_cmc – mana value range
    Returns matching card nodes.
    """
    _ensure_data()
    candidates = set()
    first = True

    filters = {
        "color": ("HAS_COLOR_IDENTITY", lambda v: f"color:{v.upper()}"),
        "card_type": ("HAS_TYPE", lambda v: f"cardtype:{v.title()}"),
        "subtype": ("HAS_SUBTYPE", lambda v: f"subtype:{v.title()}"),
        "keyword": ("HAS_KEYWORD", lambda v: f"keyword:{v.title()}"),
        "format": ("LEGAL_IN", lambda v: f"format:{v.lower()}"),
        "set_code": ("IN_SET", lambda v: f"set:{v.lower()}"),
        "rarity": ("HAS_RARITY", lambda v: f"rarity:{v.lower()}"),
    }

    for param, (rel_type, make_target) in filters.items():
        val = request.args.get(param)
        if not val:
            continue
        target = make_target(val)
        cards_with_rel = {s for s, t, d in _graph.edges(data=True)
                         if t == target and d.get("rel") == rel_type}
        if first:
            candidates = cards_with_rel
            first = False
        else:
            candidates &= cards_with_rel

    card_name = request.args.get("card_name", "").lower()
    min_cmc = request.args.get("min_cmc", type=float)
    max_cmc = request.args.get("max_cmc", type=float)

    if first:
        candidates = {n for n, d in _graph.nodes(data=True) if d.get("node_type") == "Card"}

    results = []
    for cid in candidates:
        data = _graph.nodes.get(cid, {})
        if data.get("node_type") != "Card":
            continue
        if card_name and card_name not in data.get("label", "").lower():
            continue
        cmc = data.get("cmc", 0)
        if min_cmc is not None and cmc < min_cmc:
            continue
        if max_cmc is not None and cmc > max_cmc:
            continue
        results.append({"id": cid, **data})

    results.sort(key=lambda x: x.get("label", ""))
    return jsonify(results[:200])


@app.route("/api/path")
def api_path():
    """Find shortest path between two nodes."""
    _ensure_data()
    source = request.args.get("source")
    target = request.args.get("target")
    if not source or not target:
        return jsonify({"error": "source and target required"}), 400
    if source not in _graph or target not in _graph:
        return jsonify({"error": "Node not found"}), 404

    undirected = _graph.to_undirected()
    try:
        path = nx.shortest_path(undirected, source, target)
    except nx.NetworkXNoPath:
        return jsonify({"error": "No path found", "path": []})

    path_nodes = set(path)
    elements = []
    for n in path_nodes:
        elements.append({
            "group": "nodes",
            "data": {"id": n, **dict(_graph.nodes[n])},
        })
    for i in range(len(path) - 1):
        s, t = path[i], path[i + 1]
        edge_dict = _graph.get_edge_data(s, t) or _graph.get_edge_data(t, s) or {}
        edge_data = next(iter(edge_dict.values()), {}) if edge_dict else {}
        elements.append({
            "group": "edges",
            "data": {
                "id": f"path:{s}->{t}",
                "source": s, "target": t, **dict(edge_data),
            },
        })
    return jsonify({"path": path, "elements": elements})


@app.route("/api/neighbors")
def api_neighbors():
    """Get neighbors of a node filtered by relationship type."""
    _ensure_data()
    node_id = request.args.get("node_id")
    rel = request.args.get("rel")
    if not node_id:
        return jsonify({"error": "node_id required"}), 400
    if node_id not in _graph:
        return jsonify({"error": "Node not found"}), 404

    neighbors = []
    for _, t, d in _graph.out_edges(node_id, data=True):
        if rel and d.get("rel") != rel:
            continue
        neighbors.append({"id": t, "rel": d.get("rel"), **dict(_graph.nodes.get(t, {}))})
    for s, _, d in _graph.in_edges(node_id, data=True):
        if rel and d.get("rel") != rel:
            continue
        neighbors.append({"id": s, "rel": d.get("rel"), **dict(_graph.nodes.get(s, {}))})
    return jsonify(neighbors)


@app.route("/api/graph/cards-by-trigger")
def api_cards_by_trigger():
    """Return directional card-to-card connections through trigger relationships.
    Cards that produce/enable a trigger event (sources) link to cards with
    triggered abilities that respond to that event (responders).
    Multiple shared triggers between the same pair are aggregated."""
    _ensure_data()

    MAX_EDGES_PER_TRIGGER = 2000

    trigger_sources = {}
    trigger_responders = {}
    for s, t, d in _graph.edges(data=True):
        if d.get("rel") == "TRIGGERS":
            trigger_sources.setdefault(t, []).append(s)
        elif d.get("rel") == "IS_TRIGGERED_BY":
            trigger_responders.setdefault(t, []).append(s)

    pair_triggers = {}
    for trigger_id in set(trigger_sources) & set(trigger_responders):
        sources = trigger_sources[trigger_id]
        responders = trigger_responders[trigger_id]
        if len(sources) * len(responders) > MAX_EDGES_PER_TRIGGER:
            continue
        trigger_label = _graph.nodes[trigger_id].get("label", trigger_id)
        for src in sources:
            for resp in responders:
                if src == resp:
                    continue
                pair = (src, resp)
                pair_triggers.setdefault(pair, []).append(trigger_label)

    card_ids = set()
    edge_elements = []
    for (src, resp), triggers in pair_triggers.items():
        card_ids.add(src)
        card_ids.add(resp)
        edge_elements.append({
            "group": "edges",
            "data": {
                "id": f"{src}->{resp}:TRIGGER_LINK",
                "source": src,
                "target": resp,
                "rel": "TRIGGER_LINK",
                "trigger": ", ".join(sorted(set(triggers))),
                "weight": len(set(triggers)),
            },
        })

    elements = []
    for n in card_ids:
        elements.append({
            "group": "nodes",
            "data": {"id": n, **dict(_graph.nodes[n])},
        })
    elements.extend(edge_elements)
    return jsonify(elements)


@app.route("/api/refresh", methods=["POST"])
def api_refresh():
    """Re-fetch cards from Scryfall and rebuild the graph."""
    global _graph, _elements
    _graph = None
    _elements = None
    for f in [CARDS_CACHE, GRAPH_CACHE]:
        if os.path.exists(f):
            os.remove(f)
    _ensure_data()
    return jsonify({"status": "ok", "stats": graph_stats(_graph)})


def _filter_elements(node_type=None, rel=None, min_weight=None):
    edge_elements = []
    edge_node_ids = set()

    if rel:
        for s, t, d in _graph.edges(data=True):
            if d.get("rel") == rel:
                w = d.get("weight", 1)
                if min_weight is not None and w < min_weight:
                    continue
                edge_node_ids.add(s)
                edge_node_ids.add(t)
                edge_elements.append({
                    "group": "edges",
                    "data": {
                        "id": f"{s}->{t}:{d.get('rel', '')}",
                        "source": s, "target": t, **dict(d),
                    },
                })

    if node_type:
        type_nodes = {n for n, d in _graph.nodes(data=True)
                      if d.get("node_type") == node_type}
        if rel:
            anchor_nodes = edge_node_ids & type_nodes
            keep_edges = []
            keep_node_ids = set()
            for e in edge_elements:
                s, t = e["data"]["source"], e["data"]["target"]
                if s in anchor_nodes or t in anchor_nodes:
                    keep_edges.append(e)
                    keep_node_ids.add(s)
                    keep_node_ids.add(t)
            edge_elements = keep_edges
            edge_node_ids = keep_node_ids
        else:
            edge_node_ids = set(type_nodes)
            for s, t, d in _graph.edges(data=True):
                if s in edge_node_ids or t in edge_node_ids:
                    w = d.get("weight", 1)
                    if min_weight is not None and w < min_weight:
                        continue
                    edge_node_ids.add(s)
                    edge_node_ids.add(t)
                    edge_elements.append({
                        "group": "edges",
                        "data": {
                            "id": f"{s}->{t}:{d.get('rel', '')}",
                            "source": s, "target": t, **dict(d),
                        },
                    })

    if not rel and not node_type and min_weight is not None:
        for s, t, d in _graph.edges(data=True):
            w = d.get("weight", 1)
            if w >= min_weight:
                edge_node_ids.add(s)
                edge_node_ids.add(t)
                edge_elements.append({
                    "group": "edges",
                    "data": {
                        "id": f"{s}->{t}:{d.get('rel', '')}",
                        "source": s, "target": t, **dict(d),
                    },
                })

    elements = []
    for n in edge_node_ids:
        elements.append({
            "group": "nodes",
            "data": {"id": n, **dict(_graph.nodes[n])},
        })
    elements.extend(edge_elements)
    return elements


if __name__ == "__main__":
    _ensure_data()
    app.run(host="0.0.0.0", port=5000, debug=True)
