#!/usr/bin/env python3
"""Build a compact static graph JSON for GitHub Pages deployment."""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from backend.scryfall import fetch_subset
from backend.ontology import build_graph, graph_stats

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
SITE_DIR = os.path.join(os.path.dirname(__file__), "site")
CARDS_CACHE = os.path.join(DATA_DIR, "cards.json")

KEEP_CARD_FIELDS = {
    "label", "node_type", "oracle_id", "mana_cost", "cmc",
    "oracle_text", "power", "toughness", "loyalty",
    "rarity", "set_code", "set_name", "image",
}

SKIP_RELS = {"LEGAL_IN", "HAS_MANA_VALUE", "HAS_RARITY"}


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(SITE_DIR, exist_ok=True)

    if os.path.exists(CARDS_CACHE):
        print(f"Loading cached cards from {CARDS_CACHE}")
        with open(CARDS_CACHE) as f:
            cards = json.load(f)
    else:
        print("Fetching cards from Scryfall API…")
        cards = fetch_subset()
        with open(CARDS_CACHE, "w") as f:
            json.dump(cards, f)

    print(f"  → {len(cards)} cards loaded")
    G = build_graph(cards)
    stats = graph_stats(G)
    print(f"  → Full graph: {stats['total_nodes']} nodes, {stats['total_edges']} edges")

    elements = []
    skip_node_types = {"ManaValue", "Rarity", "Format"}
    kept_nodes = set()

    for node_id, data in G.nodes(data=True):
        nt = data.get("node_type", "")
        if nt in skip_node_types:
            continue
        kept_nodes.add(node_id)
        d = {"id": node_id}
        if nt == "Card":
            for k in KEEP_CARD_FIELDS:
                if k in data and data[k]:
                    d[k] = data[k]
        else:
            d["label"] = data.get("label", "")
            d["node_type"] = nt
            if "code" in data:
                d["code"] = data["code"]
        elements.append({"group": "nodes", "data": d})

    edge_seen = set()
    for src, tgt, data in G.edges(data=True):
        rel = data.get("rel", "")
        if rel in SKIP_RELS:
            continue
        if src not in kept_nodes or tgt not in kept_nodes:
            continue
        eid = f"{src}|{tgt}|{rel}"
        if eid in edge_seen:
            continue
        edge_seen.add(eid)
        ed = {"source": src, "target": tgt, "rel": rel}
        if "shared" in data:
            ed["shared"] = data["shared"]
        elements.append({"group": "edges", "data": ed})

    card_count = sum(1 for e in elements
                     if e["group"] == "nodes" and e["data"].get("node_type") == "Card")
    edge_count = sum(1 for e in elements if e["group"] == "edges")
    print(f"  → Compact graph: {len(elements) - edge_count} nodes, {edge_count} edges, {card_count} cards")

    out = os.path.join(SITE_DIR, "graph.json")
    with open(out, "w") as f:
        json.dump(elements, f, separators=(",", ":"))
    size_mb = os.path.getsize(out) / (1024 * 1024)
    print(f"  → Written to {out} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
