"""Scryfall API client with rate limiting."""

import time
import requests

BASE_URL = "https://api.scryfall.com"
REQUEST_DELAY = 0.1  # 100ms between requests per Scryfall guidelines


class ScryfallClient:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "MTGKnowledgeGraph/1.0",
            "Accept": "application/json",
        })
        self._last_request = 0

    def _throttle(self):
        elapsed = time.time() - self._last_request
        if elapsed < REQUEST_DELAY:
            time.sleep(REQUEST_DELAY - elapsed)
        self._last_request = time.time()

    def _get(self, endpoint, params=None):
        self._throttle()
        resp = self.session.get(f"{BASE_URL}{endpoint}", params=params)
        resp.raise_for_status()
        return resp.json()

    def search_cards(self, query, max_pages=3):
        """Search cards and paginate through results."""
        cards = []
        params = {"q": query, "page": 1}
        for _ in range(max_pages):
            data = self._get("/cards/search", params=params)
            cards.extend(data.get("data", []))
            if not data.get("has_more"):
                break
            params["page"] += 1
        return cards

    def search_oracle_ids(self, query, max_pages=40):
        """Search cards and return only oracle_ids.  Handles rate-limit retries."""
        oracle_ids = set()
        page = 1
        for _ in range(max_pages):
            data = self._get_with_retry("/cards/search",
                                        params={"q": query, "page": page})
            if data is None:
                break
            for card in data.get("data", []):
                oracle_ids.add(card.get("oracle_id", card["id"]))
            if not data.get("has_more"):
                break
            page += 1
        return oracle_ids

    def _get_with_retry(self, endpoint, params=None, max_retries=4):
        """GET with rate-limit retry.  Returns None on 404."""
        for attempt in range(max_retries + 1):
            self._throttle()
            resp = self.session.get(f"{BASE_URL}{endpoint}", params=params)
            if resp.status_code == 404:
                return None
            if resp.status_code == 429:
                wait = 2 ** (attempt + 1)
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json()
        resp.raise_for_status()
        return None

    def get_card_by_name(self, name):
        return self._get("/cards/named", params={"fuzzy": name})

    def get_set(self, set_code):
        return self._get(f"/sets/{set_code}")

    def get_sets(self):
        return self._get("/sets").get("data", [])


# Scryfall oracle tags for RESPONDER classification (IS_TRIGGERED_BY).
# These community-curated tags precisely identify which trigger a card responds
# to.  Source classification (TRIGGERS) stays regex-based because source otags
# like otag:removal are too broad (they include exile/bounce which don't cause
# "dies" triggers).
TRIGGER_OTAG_QUERIES = {
    "resp:Dies":         "otag:death-trigger",
    "resp:Landfall":     "otag:landfall",
    "resp:Attack":       "otag:attack-trigger",
    "resp:Spell Cast":   "otag:cast-trigger",
    "resp:Discard":      "otag:discard-matters",
    "resp:Mill":         "otag:mill",
}

# All keys NOT in TRIGGER_OTAG_QUERIES use regex fallback automatically.
# No explicit fallback set needed.


def fetch_subset(queries=None):
    """Fetch a curated subset of cards spanning multiple archetypes."""
    client = ScryfallClient()

    if queries is None:
        queries = [
            "t:legendary t:creature c:wu",    # Azorius legends
            "t:legendary t:creature c:br",    # Rakdos legends
            "t:legendary t:creature c:g",     # Green legends
            "t:instant c:u cmc<=3",           # Blue interaction
            "t:sorcery c:r",                  # Red sorceries
            "t:enchantment c:w",              # White enchantments
            "t:artifact cmc<=4",              # Cheap artifacts
            "t:planeswalker",                 # Planeswalkers
        ]

    all_cards = []
    seen_ids = set()
    for q in queries:
        try:
            cards = client.search_cards(q, max_pages=1)
            for card in cards:
                oid = card.get("oracle_id", card["id"])
                if oid not in seen_ids:
                    seen_ids.add(oid)
                    all_cards.append(card)
        except requests.HTTPError as e:
            print(f"Warning: query '{q}' failed: {e}")
    return all_cards


def fetch_trigger_tags(card_oracle_ids=None, max_pages_per_tag=40):
    """Fetch Scryfall oracle tags for trigger classification.

    Returns a dict mapping tag keys (e.g. "resp:Dies", "src:Draw")
    to sets of oracle_ids that match.  When *card_oracle_ids* is given,
    only IDs in that set are retained (intersection with our card subset).
    """
    client = ScryfallClient()
    result = {}

    for tag_key, query in TRIGGER_OTAG_QUERIES.items():
        try:
            oracle_ids = client.search_oracle_ids(query, max_pages=max_pages_per_tag)
        except requests.HTTPError:
            oracle_ids = set()

        if card_oracle_ids is not None:
            oracle_ids &= card_oracle_ids

        result[tag_key] = oracle_ids
        print(f"  otag {tag_key}: {len(oracle_ids)} cards",
              flush=True)

    return result
