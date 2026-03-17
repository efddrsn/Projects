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

    def get_card_by_name(self, name):
        return self._get("/cards/named", params={"fuzzy": name})

    def get_set(self, set_code):
        return self._get(f"/sets/{set_code}")

    def get_sets(self):
        return self._get("/sets").get("data", [])


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
