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
  Trigger     – ETB, Landfall, Dies, DealtDamage, Attack, SpellCast, …

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
  Card  -[TRIGGERS]->        Trigger (card produces/enables this event)
  Card  -[IS_TRIGGERED_BY]-> Trigger (card has triggered ability for event)
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

TRIGGER_RESPONSE_PATTERNS = {
    "ETB": [
        re.compile(r"(?:when|whenever)\s+(?:a|an|another)\s+(?!land\b).{0,40}enters? (?:the battlefield|under)", re.I),
    ],
    "Landfall": [
        re.compile(r"(?:when|whenever)\s+a land.{0,30}enters?\b", re.I),
        re.compile(r"\blandfall\b", re.I),
    ],
    "Dies": [
        re.compile(r"(?:when|whenever)\b.{0,30}\bdies\b", re.I),
        re.compile(r"(?:when|whenever)\b.{0,40}put into .{0,10}graveyard from the battlefield", re.I),
    ],
    "LTB": [
        re.compile(r"(?:when|whenever)\b.{0,40}leaves the battlefield", re.I),
    ],
    "Attack": [
        re.compile(r"(?:when|whenever)\b.{0,30}attacks?\b", re.I),
    ],
    "Combat Damage": [
        re.compile(r"(?:when|whenever)\b.{0,40}deals combat damage", re.I),
    ],
    "Dealt Damage": [
        re.compile(r"(?:when|whenever)\b.{0,40}is dealt damage", re.I),
    ],
    "Spell Cast": [
        re.compile(r"(?:when|whenever)\b.{0,30}casts?\b", re.I),
    ],
    "Upkeep": [
        re.compile(r"(?:at the )?beginning of (?:your |each )?upkeep", re.I),
    ],
    "End Step": [
        re.compile(r"(?:at the )?beginning of (?:your |each |the )?end step", re.I),
    ],
    "Draw": [
        re.compile(r"(?:when|whenever)\b.{0,20}draws? a card", re.I),
    ],
    "Discard": [
        re.compile(r"(?:when|whenever)\b.{0,20}discards?", re.I),
    ],
    "Sacrifice": [
        re.compile(r"(?:when|whenever)\b[^,\n]{0,30}(?:is )?sacrifice", re.I),
    ],
    "Life Gain": [
        re.compile(r"(?:when|whenever)\b.{0,20}gains? life", re.I),
    ],
    "Life Loss": [
        re.compile(r"(?:when|whenever)\b.{0,20}loses? life", re.I),
    ],
    "Token": [
        re.compile(r"(?:when|whenever)\b[^,\n]{0,30}creates? .{0,20}token", re.I),
    ],
    "Mill": [
        re.compile(r"(?:when|whenever)\b.{0,30}(?:mills?|cards? .{0,20}put into .{0,10}graveyard from .{0,10}library)", re.I),
    ],
}

TRIGGER_SOURCE_PATTERNS = {
    "ETB": [
        re.compile(r"create[s]? .{0,30}tokens?", re.I),
        re.compile(r"put .{0,40}(?:creature|permanent|artifact|enchantment).{0,20}onto the battlefield", re.I),
        re.compile(r"return .{0,40}(?:creature|permanent|artifact|enchantment).{0,20}to the battlefield", re.I),
    ],
    "Landfall": [
        re.compile(r"put .{0,30}land.{0,20}onto the battlefield", re.I),
        re.compile(r"search .{0,40}land.{0,30}onto the battlefield", re.I),
    ],
    "Dies": [
        re.compile(r"destroy (?:target |all |each )?(?:\w+ )?(?:creature|permanent)", re.I),
    ],
    "Sacrifice": [
        re.compile(r"sacrifice (?:a |an |another )", re.I),
    ],
    "Discard": [
        re.compile(r"(?:target |each )?(?:player|opponent) discards?", re.I),
        re.compile(r"discard (?:a |your |their |\d+ )", re.I),
    ],
    "Draw": [
        re.compile(r"(?:target (?:player|opponent) )?draws? (?:a |two |three |\d+ )?cards?", re.I),
    ],
    "Life Gain": [
        re.compile(r"gains? (?:\d+|X) life", re.I),
    ],
    "Life Loss": [
        re.compile(r"(?:loses?|lose) (?:\d+|X) life", re.I),
    ],
    "Dealt Damage": [
        re.compile(r"deals? (?:\d+|X) damage", re.I),
    ],
    "Token": [
        re.compile(r"create[s]? .{0,30}tokens?", re.I),
    ],
    "Mill": [
        re.compile(r"mills? (?:\d+|X)", re.I),
    ],
}

TRIGGER_LABELS = {
    "ETB": "Enters the Battlefield",
    "Landfall": "Landfall",
    "Dies": "Dies",
    "LTB": "Leaves the Battlefield",
    "Attack": "Attacks",
    "Combat Damage": "Deals Combat Damage",
    "Dealt Damage": "Is Dealt Damage",
    "Spell Cast": "Spell Cast",
    "Upkeep": "Upkeep Trigger",
    "End Step": "End Step Trigger",
    "Draw": "Card Draw",
    "Discard": "Discard",
    "Sacrifice": "Sacrifice",
    "Life Gain": "Life Gain",
    "Life Loss": "Life Loss",
    "Token": "Token Creation",
    "Mill": "Mill",
}


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

        color_identity = card.get("color_identity") or []

        type_line = card.get("type_line", "")
        supertypes, card_types, subtypes = _parse_type_line(type_line)
        keywords_list = card.get("keywords", [])
        legalities = card.get("legalities", {})
        legal_formats = [fmt for fmt, status in legalities.items() if status == "legal"]

        G.add_node(f"card:{card_id}", **{
            "node_type": "Card",
            "label": name,
            "oracle_id": card_id,
            "mana_cost": card.get("mana_cost") or "",
            "cmc": card.get("cmc") or 0,
            "color_identity": ",".join(sorted(color_identity)),
            "oracle_text": card.get("oracle_text") or "",
            "power": card.get("power") or "",
            "toughness": card.get("toughness") or "",
            "loyalty": card.get("loyalty") or "",
            "rarity": card.get("rarity") or "",
            "set_code": card.get("set") or "",
            "set_name": card.get("set_name") or "",
            "image": image,
            "type_line": type_line,
            "card_types": ",".join(card_types),
            "subtypes": ",".join(subtypes),
            "keywords": ",".join(keywords_list),
            "formats": ",".join(legal_formats),
        })

        # Colors
        for c in (card.get("colors") or []):
            G.add_edge(f"card:{card_id}", f"color:{c}", rel="HAS_COLOR", weight=1)
        for c in (card.get("color_identity") or []):
            G.add_edge(f"card:{card_id}", f"color:{c}", rel="HAS_COLOR_IDENTITY", weight=1)

        for st in supertypes:
            nid = f"supertype:{st}"
            if nid not in G:
                G.add_node(nid, label=st, node_type="Supertype")
            G.add_edge(f"card:{card_id}", nid, rel="HAS_SUPERTYPE", weight=1)

        for ct in card_types:
            nid = f"cardtype:{ct}"
            if nid not in G:
                G.add_node(nid, label=ct, node_type="CardType")
            G.add_edge(f"card:{card_id}", nid, rel="HAS_TYPE", weight=1)

        for sub in subtypes:
            nid = f"subtype:{sub}"
            if nid not in G:
                G.add_node(nid, label=sub, node_type="Subtype")
            G.add_edge(f"card:{card_id}", nid, rel="HAS_SUBTYPE", weight=1)

        # Keywords
        for kw in card.get("keywords", []):
            nid = f"keyword:{kw}"
            if nid not in G:
                G.add_node(nid, label=kw, node_type="Keyword")
            G.add_edge(f"card:{card_id}", nid, rel="HAS_KEYWORD", weight=1)

        # Set
        set_code = card.get("set", "")
        if set_code:
            nid = f"set:{set_code}"
            if nid not in G:
                G.add_node(nid, label=card.get("set_name") or set_code, node_type="Set", code=set_code)
            G.add_edge(f"card:{card_id}", nid, rel="IN_SET", weight=1)

        # Rarity
        rarity = card.get("rarity", "")
        if rarity:
            nid = f"rarity:{rarity}"
            if nid not in G:
                G.add_node(nid, label=rarity.title(), node_type="Rarity")
            G.add_edge(f"card:{card_id}", nid, rel="HAS_RARITY", weight=1)

        # Mana value bucket
        cmc = int(card.get("cmc") or 0)
        nid = f"mv:{cmc}"
        if nid not in G:
            G.add_node(nid, label=f"MV {cmc}", node_type="ManaValue", value=cmc)
        G.add_edge(f"card:{card_id}", nid, rel="HAS_MANA_VALUE", weight=1)

        # Legalities
        for fmt, status in card.get("legalities", {}).items():
            if status == "legal":
                nid = f"format:{fmt}"
                if nid not in G:
                    G.add_node(nid, label=fmt.replace("_", " ").title(), node_type="Format")
                G.add_edge(f"card:{card_id}", nid, rel="LEGAL_IN", weight=1)

        oracle = card.get("oracle_text") or ""
        for sym in MANA_SYMBOL_RE.findall(oracle):
            if sym in COLOR_MAP and "add" in oracle.lower():
                G.add_edge(f"card:{card_id}", f"color:{sym}", rel="PRODUCES_MANA", weight=1)

        # Trigger events – responders (cards with triggered abilities)
        for trigger_key, patterns in TRIGGER_RESPONSE_PATTERNS.items():
            for pat in patterns:
                if pat.search(oracle):
                    nid = f"trigger:{trigger_key}"
                    if nid not in G:
                        G.add_node(nid,
                                   label=TRIGGER_LABELS.get(trigger_key, trigger_key),
                                   node_type="Trigger",
                                   trigger_key=trigger_key)
                    G.add_edge(f"card:{card_id}", nid, rel="IS_TRIGGERED_BY", weight=1)
                    break

        # Trigger events – sources (cards that produce/enable events)
        for trigger_key, patterns in TRIGGER_SOURCE_PATTERNS.items():
            for pat in patterns:
                if pat.search(oracle):
                    nid = f"trigger:{trigger_key}"
                    if nid not in G:
                        G.add_node(nid,
                                   label=TRIGGER_LABELS.get(trigger_key, trigger_key),
                                   node_type="Trigger",
                                   trigger_key=trigger_key)
                    G.add_edge(f"card:{card_id}", nid, rel="TRIGGERS", weight=1)
                    break

        # Lifelink keyword → Life Gain source (only via keyword, not oracle text mentions)
        if "Lifelink" in keywords_list:
            nid = "trigger:Life Gain"
            if nid not in G:
                G.add_node(nid,
                           label=TRIGGER_LABELS.get("Life Gain", "Life Gain"),
                           node_type="Trigger",
                           trigger_key="Life Gain")
            G.add_edge(f"card:{card_id}", nid, rel="TRIGGERS", weight=1)

    _add_synergy_edges(G)
    _add_edge_weights(G)
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
        w = len(shared)
        G.add_edge(a, b, rel="SYNERGY", shared=", ".join(shared), weight=w)
        G.add_edge(b, a, rel="SYNERGY", shared=", ".join(shared), weight=w)


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


def _add_edge_weights(G):
    """Enhance edge weights: SYNERGY weight is already set by shared trait count.
    For taxonomy edges (HAS_SUBTYPE, HAS_KEYWORD, TRIGGERS, IS_TRIGGERED_BY), weight is
    inversely proportional to the target's in-degree (rarer = stronger).
    """
    boost_rels = {"HAS_SUBTYPE", "HAS_KEYWORD", "TRIGGERS", "IS_TRIGGERED_BY"}
    in_degrees = {}
    for _, t, d in G.edges(data=True):
        if d.get("rel") in boost_rels:
            in_degrees[t] = in_degrees.get(t, 0) + 1

    if not in_degrees:
        return
    max_deg = max(in_degrees.values())
    if max_deg <= 1:
        return

    for s, t, k, d in G.edges(data=True, keys=True):
        if d.get("rel") in boost_rels:
            deg = in_degrees.get(t, 1)
            d["weight"] = round(max(1, (max_deg / deg)), 1)


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
