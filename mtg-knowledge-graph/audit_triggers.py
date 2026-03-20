"""Audit script: identify hub cards and check if trigger connections make sense."""

import json
import os
import sys
import re
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from backend.scryfall import fetch_subset
from backend.ontology import (
    build_graph, TRIGGER_RESPONSE_PATTERNS, TRIGGER_SOURCE_PATTERNS,
    TRIGGER_LABELS,
)

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
CARDS_CACHE = os.path.join(DATA_DIR, "cards.json")


def load_cards():
    os.makedirs(DATA_DIR, exist_ok=True)
    if os.path.exists(CARDS_CACHE):
        with open(CARDS_CACHE) as f:
            cards = json.load(f)
        if isinstance(cards, list) and len(cards) > 0:
            print(f"Loaded {len(cards)} cards from cache")
            return cards
    print("Fetching cards from Scryfall API...")
    cards = fetch_subset()
    with open(CARDS_CACHE, "w") as f:
        json.dump(cards, f)
    print(f"Fetched {len(cards)} cards")
    return cards


def audit():
    cards = load_cards()
    G = build_graph(cards)

    card_info = {}
    for n, d in G.nodes(data=True):
        if d.get("node_type") == "Card":
            card_info[n] = d

    trigger_sources = defaultdict(list)
    trigger_responders = defaultdict(list)
    for s, t, d in G.edges(data=True):
        if d.get("rel") == "TRIGGERS":
            trigger_sources[t].append(s)
        elif d.get("rel") == "IS_TRIGGERED_BY":
            trigger_responders[t].append(s)

    print("\n" + "=" * 80)
    print("TRIGGER AUDIT REPORT")
    print("=" * 80)

    print("\n── Trigger Node Summary ─────────────────────────────────────────")
    all_trigger_ids = set(trigger_sources.keys()) | set(trigger_responders.keys())
    for tid in sorted(all_trigger_ids):
        label = G.nodes[tid].get("label", tid)
        src_count = len(trigger_sources.get(tid, []))
        resp_count = len(trigger_responders.get(tid, []))
        cross = src_count * resp_count
        print(f"  {label:30s}  sources={src_count:4d}  responders={resp_count:4d}  cross={cross:8d}")

    MAX_EDGES_PER_TRIGGER = 2000
    pair_triggers = defaultdict(list)
    for trigger_id in set(trigger_sources) & set(trigger_responders):
        sources = trigger_sources[trigger_id]
        responders = trigger_responders[trigger_id]
        if len(sources) * len(responders) > MAX_EDGES_PER_TRIGGER:
            print(f"\n  ⚠ SKIPPED {G.nodes[trigger_id].get('label', trigger_id)}: "
                  f"{len(sources)}×{len(responders)}={len(sources)*len(responders)} > {MAX_EDGES_PER_TRIGGER}")
            continue
        trigger_label = G.nodes[trigger_id].get("label", trigger_id)
        for src in sources:
            for resp in responders:
                if src == resp:
                    continue
                pair_triggers[(src, resp)].append(trigger_label)

    degree_out = Counter()
    degree_in = Counter()
    for (src, resp), triggers in pair_triggers.items():
        degree_out[src] += 1
        degree_in[resp] += 1

    degree_total = Counter()
    for card_id in set(degree_out.keys()) | set(degree_in.keys()):
        degree_total[card_id] = degree_out.get(card_id, 0) + degree_in.get(card_id, 0)

    print("\n── Top 30 Hub Cards (by TRIGGER_LINK degree) ─────────────────────")
    print(f"  {'Card':50s} {'Out':>5s} {'In':>5s} {'Total':>6s}")
    print("  " + "-" * 70)
    for card_id, total in degree_total.most_common(30):
        name = card_info.get(card_id, {}).get("label", card_id)
        out = degree_out.get(card_id, 0)
        inp = degree_in.get(card_id, 0)
        print(f"  {name:50s} {out:5d} {inp:5d} {total:6d}")

    print("\n── Detailed Audit of Top 10 Hubs ─────────────────────────────────")
    for card_id, total in degree_total.most_common(10):
        info = card_info.get(card_id, {})
        name = info.get("label", card_id)
        oracle = info.get("oracle_text", "")
        type_line = info.get("type_line", "")

        print(f"\n{'─' * 80}")
        print(f"  CARD: {name}")
        print(f"  Type: {type_line}")
        print(f"  Oracle: {oracle[:200]}")
        print(f"  Out-degree: {degree_out.get(card_id, 0)}, In-degree: {degree_in.get(card_id, 0)}")

        source_triggers = []
        resp_triggers = []
        for s, t, d in G.edges(card_id, data=True):
            if d.get("rel") == "TRIGGERS":
                source_triggers.append(G.nodes[t].get("label", t))
            elif d.get("rel") == "IS_TRIGGERED_BY":
                resp_triggers.append(G.nodes[t].get("label", t))

        if source_triggers:
            print(f"  → PRODUCES events: {', '.join(source_triggers)}")
        if resp_triggers:
            print(f"  → RESPONDS TO events: {', '.join(resp_triggers)}")

        # Check specific false-positive patterns
        issues = check_card_issues(card_id, info, G, trigger_sources, trigger_responders, pair_triggers)
        if issues:
            print(f"  ⚠ ISSUES FOUND:")
            for issue in issues:
                print(f"    - {issue}")

    # Pattern-level audit
    print("\n\n" + "=" * 80)
    print("PATTERN-LEVEL AUDIT")
    print("=" * 80)

    audit_etb_self_reference(G, card_info, trigger_sources, trigger_responders)
    audit_lifelink_text_vs_keyword(G, card_info)
    audit_damage_conflation(G, card_info, trigger_responders)
    audit_draw_over_broad(G, card_info)
    audit_missing_source_patterns(trigger_sources, trigger_responders, G)


def check_card_issues(card_id, info, G, trigger_sources, trigger_responders, pair_triggers):
    """Check for known false-positive issues on a specific card."""
    issues = []
    oracle = info.get("oracle_text", "")
    name = info.get("label", "")

    # Check ETB self-reference: card says "When CARDNAME enters" but is connected
    # as if any ETB source triggers it
    self_etb = re.search(
        r"(?:when|whenever)\s+" + re.escape(name.split(",")[0].split("//")[0].strip())
        + r".{0,20}enters? (?:the battlefield|under)",
        oracle, re.I
    )
    if self_etb:
        tid = "trigger:ETB"
        if tid in trigger_sources:
            sources_for_etb = trigger_sources[tid]
            issue_count = sum(1 for s in sources_for_etb if (s, card_id) in pair_triggers)
            if issue_count > 0:
                issues.append(
                    f"Self-only ETB (\"When {name.split(',')[0]} enters...\") but linked "
                    f"to {issue_count} ETB sources. These won't actually trigger this card."
                )

    # Check lifelink in text vs as keyword
    if "lifelink" in oracle.lower() and "lifelink" not in info.get("keywords", "").lower():
        for s, t, d in G.edges(card_id, data=True):
            if d.get("rel") == "TRIGGERS" and "Life" in G.nodes[t].get("label", ""):
                issues.append(
                    f"Mentions 'lifelink' in oracle text but doesn't have Lifelink keyword. "
                    f"Marked as Life Gain source but the card itself may not gain life."
                )
                break

    return issues


def audit_etb_self_reference(G, card_info, trigger_sources, trigger_responders):
    """Audit ETB connections: cards with self-only ETB shouldn't be linked to token creators."""
    print("\n── ETB Self-Reference Audit ─────────────────────────────────────")

    etb_tid = "trigger:ETB"
    if etb_tid not in trigger_responders:
        print("  No ETB responders found.")
        return

    self_only_etb = []
    any_etb = []

    for card_id in trigger_responders[etb_tid]:
        info = card_info.get(card_id, {})
        oracle = info.get("oracle_text", "")
        name = info.get("label", "")
        short_name = name.split(",")[0].split("//")[0].strip()

        has_self_ref = bool(re.search(
            r"(?:when|whenever)\s+" + re.escape(short_name)
            + r".{0,20}enters? (?:the battlefield|under)",
            oracle, re.I
        ))

        has_any_ref = bool(re.search(
            r"(?:when|whenever)\s+(?:a|an|another)\s+\w+.{0,30}enters? (?:the battlefield|under)",
            oracle, re.I
        ))

        if has_any_ref:
            any_etb.append((card_id, name))
        elif has_self_ref:
            self_only_etb.append((card_id, name))

    print(f"  Self-only ETB responders: {len(self_only_etb)}")
    print(f"  Any-creature ETB responders: {len(any_etb)}")
    print(f"  Total ETB responders: {len(trigger_responders[etb_tid])}")

    if self_only_etb:
        print(f"\n  FALSE POSITIVES: These {len(self_only_etb)} cards have self-only ETB but are "
              f"connected to ALL ETB sources (token creators, etc.):")
        for cid, name in self_only_etb[:15]:
            oracle = card_info.get(cid, {}).get("oracle_text", "")[:100]
            print(f"    - {name}: \"{oracle}...\"")


def audit_lifelink_text_vs_keyword(G, card_info):
    """Audit cards matching lifelink pattern that don't have Lifelink keyword."""
    print("\n── Lifelink Text vs Keyword Audit ──────────────────────────────")

    lifelink_pat = re.compile(r"\blifelink\b", re.I)
    false_positives = []

    for card_id, info in card_info.items():
        oracle = info.get("oracle_text", "")
        keywords = info.get("keywords", "")

        if lifelink_pat.search(oracle) and "lifelink" not in keywords.lower():
            for s, t, d in G.edges(card_id, data=True):
                if d.get("rel") == "TRIGGERS" and "Life" in G.nodes.get(t, {}).get("label", ""):
                    false_positives.append((card_id, info.get("label", ""), oracle[:120]))
                    break

    print(f"  Cards mentioning 'lifelink' in text but NOT having Lifelink keyword: {len(false_positives)}")
    if false_positives:
        print(f"  These are FALSE Life Gain sources:")
        for cid, name, oracle in false_positives[:15]:
            print(f"    - {name}: \"{oracle}...\"")


def audit_damage_conflation(G, card_info, trigger_responders):
    """Audit Damage trigger conflation between 'deals damage' and 'is dealt damage'."""
    print("\n── Damage Pattern Conflation Audit ──────────────────────────────")

    dmg_tid = "trigger:Damage"
    if dmg_tid not in trigger_responders:
        print("  No Damage responders found.")
        return

    deals_dmg_responders = []
    is_dealt_dmg_responders = []

    for card_id in trigger_responders[dmg_tid]:
        oracle = card_info.get(card_id, {}).get("oracle_text", "")
        if re.search(r"(?:when|whenever)\b.{0,40}deals? damage", oracle, re.I):
            deals_dmg_responders.append((card_id, card_info[card_id].get("label", "")))
        if re.search(r"(?:when|whenever)\b.{0,40}is dealt damage", oracle, re.I):
            is_dealt_dmg_responders.append((card_id, card_info[card_id].get("label", "")))

    print(f"  'Deals damage' responders: {len(deals_dmg_responders)}")
    print(f"  'Is dealt damage' responders: {len(is_dealt_dmg_responders)}")
    if deals_dmg_responders:
        print(f"  ⚠ 'Deals damage' responders are WRONGLY linked to damage source cards.")
        print(f"    (A card that 'deals 3 damage' does NOT cause another card to deal damage)")
        for cid, name in deals_dmg_responders[:10]:
            print(f"    - {name}")


def audit_draw_over_broad(G, card_info):
    """Check how many cards are Draw sources and if the connections are reasonable."""
    print("\n── Draw Source Breadth Audit ────────────────────────────────────")

    draw_source_count = 0
    draw_source_examples = []
    for s, t, d in G.edges(data=True):
        if d.get("rel") == "TRIGGERS" and "Draw" in G.nodes.get(t, {}).get("trigger_key", ""):
            draw_source_count += 1
            if len(draw_source_examples) < 10:
                name = card_info.get(s, {}).get("label", s)
                oracle = card_info.get(s, {}).get("oracle_text", "")[:80]
                draw_source_examples.append((name, oracle))

    print(f"  Total Draw sources: {draw_source_count}")
    if draw_source_examples:
        print(f"  Sample Draw sources:")
        for name, oracle in draw_source_examples:
            print(f"    - {name}: \"{oracle}...\"")


def audit_missing_source_patterns(trigger_sources, trigger_responders, G):
    """Report triggers with responders but no sources."""
    print("\n── Missing Source Patterns ──────────────────────────────────────")

    responder_only = set(trigger_responders.keys()) - set(trigger_sources.keys())
    if responder_only:
        for tid in sorted(responder_only):
            label = G.nodes[tid].get("label", tid)
            count = len(trigger_responders[tid])
            print(f"  {label}: {count} responders but NO source pattern → no TRIGGER_LINK edges generated")
    else:
        print("  All triggers with responders also have source patterns.")


if __name__ == "__main__":
    audit()
