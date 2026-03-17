"""
MTG Knowledge Graph Ontology

Node types:
  Card        – an individual MTG card (oracle-level)
  Color       – W / U / B / R / G
  CardType    – Creature, Instant, Sorcery, Enchantment, Artifact, Planeswalker, Land
  Subtype     – Elf, Wizard, Goblin, Angel, Dragon, Equipment, Aura, …
  Supertype   – Legendary, Basic, Snow, World
  Keyword     – Flying, Trample, Haste, Deathtouch, …
  Set         – A card set (e.g. MH2, ONE, WOE)
  Rarity      – common, uncommon, rare, mythic
  Format      – Standard, Modern, Pioneer, Legacy, Vintage, Commander, …
  ManaValue   – integer converted mana cost bucket (0, 1, 2, …)

Edge types (relationships):
  Card  -[HAS_COLOR]->       Color
  Card  -[HAS_COLOR_IDENTITY]-> Color
  Card  -[HAS_TYPE]->        CardType
  Card  -[HAS_SUBTYPE]->     Subtype
  Card  -[HAS_SUPERTYPE]->   Supertype
  Card  -[HAS_KEYWORD]->     Keyword
  Card  -[IN_SET]->          Set
  Card  -[HAS_RARITY]->      Rarity
  Card  -[LEGAL_IN]->        Format
  Card  -[HAS_MANA_VALUE]->  ManaValue
  Card  -[PRODUCES_MANA]->   Color  (for lands / mana dorks)
  Card  -[SYNERGY]->         Card   (shared keywords / subtypes)
"""

import re
import networkx as nx

COLOR_MAP = {
    "W": "White", "U": "Blue", "B": "Black", "R": "Red", "G": "Green",
}

KNOWN_SUPERTYPES = {"Legendary", "Basic", "Snow", "World", "Ongoing"}

KNOWN_CARD_TYPES = {
    "Creature", "Instant", "Sorcery", "Enchantment", "Artifact",
    "Planeswalker", "Land", "Battle", "Kindred", "Tribal",
}

MANA_SYMBOL_RE = re.compile(r"\{([WUBRGC])\}")


def _parse_type_line(type_line):
    """Split type_line into supertypes, types, and subtypes."""
    supertypes, card_types, subtypes = [], [], []
    if not type_line:
        return supertypes, card_types, subtypes

    front_faces = type_line.split("//")
    for face in front_faces:
        face = face.strip()
        if "—" in face:
            left, right = face.split("—", 1)
        elif "-" in face and not face.startswith("-"):
            left, right = face.split("-", 1)
        else:
            left, right = face, ""

        for word in left.split():
            w = word.strip().title()
            if w in KNOWN_SUPERTYPES:
                supertypes.append(w)
            elif w in KNOWN_CARD_TYPES:
                card_types.append(w)

        for word in right.split():
            w = word.strip().title()
            if w and w not in {"—", "-", "//"}:
                subtypes.append(w)

    return supertypes, card_types, subtypes


def build_graph(cards):
    """Build a NetworkX knowledge graph from Scryfall card objects."""
    G = nx.MultiDiGraph()

    for c in COLOR_MAP:
        G.add_node(f"color:{c}", label=COLOR_MAP[c], node_type="Color", code=c)

    for card in cards:
        card_id = card.get("oracle_id", card["id"])
        name = card["name"]
        image = ""
        if "image_uris" in card:
            image = card["image_uris"].get("normal", card["image_uris"].get("small", ""))
        elif "card_faces" in card and card["card_faces"]:
            face = card["card_faces"][0]
            if "image_uris" in face:
                image = face["image_uris"].get("normal", face["image_uris"].get("small", ""))

        G.add_node(f"card:{card_id}", **{
            "node_type": "Card",
            "label": name,
            "oracle_id": card_id,
            "mana_cost": card.get("mana_cost", ""),
            "cmc": card.get("cmc", 0),
            "oracle_text": card.get("oracle_text", ""),
            "power": card.get("power", ""),
            "toughness": card.get("toughness", ""),
            "loyalty": card.get("loyalty", ""),
            "rarity": card.get("rarity", ""),
            "set_code": card.get("set", ""),
            "set_name": card.get("set_name", ""),
            "image": image,
        })

        # Colors
        for c in (card.get("colors") or []):
            G.add_edge(f"card:{card_id}", f"color:{c}", rel="HAS_COLOR")
        for c in (card.get("color_identity") or []):
            G.add_edge(f"card:{card_id}", f"color:{c}", rel="HAS_COLOR_IDENTITY")

        # Type line
        type_line = card.get("type_line", "")
        supertypes, card_types, subtypes = _parse_type_line(type_line)

        for st in supertypes:
            nid = f"supertype:{st}"
            if nid not in G:
                G.add_node(nid, label=st, node_type="Supertype")
            G.add_edge(f"card:{card_id}", nid, rel="HAS_SUPERTYPE")

        for ct in card_types:
            nid = f"cardtype:{ct}"
            if nid not in G:
                G.add_node(nid, label=ct, node_type="CardType")
            G.add_edge(f"card:{card_id}", nid, rel="HAS_TYPE")

        for sub in subtypes:
            nid = f"subtype:{sub}"
            if nid not in G:
                G.add_node(nid, label=sub, node_type="Subtype")
            G.add_edge(f"card:{card_id}", nid, rel="HAS_SUBTYPE")

        # Keywords
        for kw in card.get("keywords", []):
            nid = f"keyword:{kw}"
            if nid not in G:
                G.add_node(nid, label=kw, node_type="Keyword")
            G.add_edge(f"card:{card_id}", nid, rel="HAS_KEYWORD")

        # Set
        set_code = card.get("set", "")
        if set_code:
            nid = f"set:{set_code}"
            if nid not in G:
                G.add_node(nid, label=card.get("set_name", set_code), node_type="Set", code=set_code)
            G.add_edge(f"card:{card_id}", nid, rel="IN_SET")

        # Rarity
        rarity = card.get("rarity", "")
        if rarity:
            nid = f"rarity:{rarity}"
            if nid not in G:
                G.add_node(nid, label=rarity.title(), node_type="Rarity")
            G.add_edge(f"card:{card_id}", nid, rel="HAS_RARITY")

        # Mana value bucket
        cmc = int(card.get("cmc", 0))
        nid = f"mv:{cmc}"
        if nid not in G:
            G.add_node(nid, label=f"MV {cmc}", node_type="ManaValue", value=cmc)
        G.add_edge(f"card:{card_id}", nid, rel="HAS_MANA_VALUE")

        # Legalities
        for fmt, status in card.get("legalities", {}).items():
            if status == "legal":
                nid = f"format:{fmt}"
                if nid not in G:
                    G.add_node(nid, label=fmt.replace("_", " ").title(), node_type="Format")
                G.add_edge(f"card:{card_id}", nid, rel="LEGAL_IN")

        # Mana production (heuristic: look for "Add {X}" in oracle text)
        oracle = card.get("oracle_text", "") or ""
        for sym in MANA_SYMBOL_RE.findall(oracle):
            if sym in COLOR_MAP and "add" in oracle.lower():
                G.add_edge(f"card:{card_id}", f"color:{sym}", rel="PRODUCES_MANA")

    _add_synergy_edges(G)
    return G


def _add_synergy_edges(G):
    """Add SYNERGY edges between cards sharing >=2 subtypes or >=2 keywords."""
    card_nodes = [n for n, d in G.nodes(data=True) if d.get("node_type") == "Card"]

    subtype_map = {}
    keyword_map = {}
    for cn in card_nodes:
        for _, target, data in G.out_edges(cn, data=True):
            if data.get("rel") == "HAS_SUBTYPE":
                subtype_map.setdefault(target, []).append(cn)
            elif data.get("rel") == "HAS_KEYWORD":
                keyword_map.setdefault(target, []).append(cn)

    synergy_pairs = set()

    for group in [subtype_map, keyword_map]:
        for _, members in group.items():
            if len(members) > 50:
                continue
            for i, a in enumerate(members):
                for b in members[i + 1:]:
                    pair = tuple(sorted([a, b]))
                    if pair not in synergy_pairs:
                        shared = _shared_traits(G, a, b)
                        if len(shared) >= 2:
                            synergy_pairs.add(pair)

    for a, b in synergy_pairs:
        shared = _shared_traits(G, a, b)
        G.add_edge(a, b, rel="SYNERGY", shared=", ".join(shared))
        G.add_edge(b, a, rel="SYNERGY", shared=", ".join(shared))


def _shared_traits(G, a, b):
    """Return shared subtype/keyword labels between two card nodes."""
    def _targets(node, rel_type):
        return {t for _, t, d in G.out_edges(node, data=True) if d.get("rel") == rel_type}

    shared_sub = _targets(a, "HAS_SUBTYPE") & _targets(b, "HAS_SUBTYPE")
    shared_kw = _targets(a, "HAS_KEYWORD") & _targets(b, "HAS_KEYWORD")
    labels = []
    for n in shared_sub | shared_kw:
        labels.append(G.nodes[n].get("label", n))
    return labels


def graph_to_cytoscape(G):
    """Convert NetworkX graph to Cytoscape.js JSON format."""
    elements = []
    for node_id, data in G.nodes(data=True):
        safe = {k: v for k, v in data.items() if k != "id"}
        elements.append({
            "group": "nodes",
            "data": {"id": node_id, **safe},
        })
    edge_counter = {}
    for source, target, data in G.edges(data=True):
        rel = data.get("rel", "")
        base_id = f"{source}->{target}:{rel}"
        edge_counter[base_id] = edge_counter.get(base_id, 0) + 1
        eid = base_id if edge_counter[base_id] == 1 else f"{base_id}#{edge_counter[base_id]}"
        elements.append({
            "group": "edges",
            "data": {
                "id": eid,
                "source": source,
                "target": target,
                **{k: v for k, v in data.items()},
            },
        })
    return elements


def graph_stats(G):
    """Return summary statistics about the graph."""
    node_types = {}
    for _, d in G.nodes(data=True):
        nt = d.get("node_type", "Unknown")
        node_types[nt] = node_types.get(nt, 0) + 1

    edge_types = {}
    for _, _, d in G.edges(data=True):
        et = d.get("rel", "Unknown")
        edge_types[et] = edge_types.get(et, 0) + 1

    return {
        "total_nodes": G.number_of_nodes(),
        "total_edges": G.number_of_edges(),
        "node_types": node_types,
        "edge_types": edge_types,
    }
