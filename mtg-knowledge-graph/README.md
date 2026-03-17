# MTG Knowledge Graph

An interactive knowledge graph of Magic: The Gathering cards, built from the [Scryfall API](https://scryfall.com/docs/api) and connected by a rich ontology.

## Ontology

Cards are connected through typed relationships to shared concept nodes:

| Node Type   | Examples                        |
|-------------|---------------------------------|
| **Card**    | Lightning Bolt, Thalia, …       |
| **Color**   | White, Blue, Black, Red, Green  |
| **CardType**| Creature, Instant, Enchantment  |
| **Subtype** | Elf, Wizard, Dragon, Equipment  |
| **Supertype**| Legendary, Basic, Snow         |
| **Keyword** | Flying, Trample, Haste          |
| **Set**     | Modern Horizons 2, Wilds of Eldraine |
| **Rarity**  | Common, Uncommon, Rare, Mythic  |
| **Format**  | Standard, Modern, Commander     |
| **ManaValue**| MV 0, MV 1, MV 2, …           |

Edges include `HAS_COLOR`, `HAS_TYPE`, `HAS_SUBTYPE`, `HAS_KEYWORD`, `IN_SET`, `LEGAL_IN`, `HAS_MANA_VALUE`, `PRODUCES_MANA`, and `SYNERGY` (cards sharing ≥2 subtypes/keywords).

## Quick Start

```bash
cd mtg-knowledge-graph
pip install -r requirements.txt
python -m backend.server
```

Open **http://localhost:5000** in your browser.

On first launch the server fetches ~1000 cards from Scryfall (takes ~30 s) and caches the result in `data/`.

## Features

- **Interactive graph visualization** – powered by Cytoscape.js with multiple layout options
- **Search** – find any card, keyword, type, or concept node
- **Structured queries** – filter by color, type, subtype, keyword, format, mana value
- **Path finder** – shortest-path between any two nodes in the graph
- **Neighborhood explorer** – click any node to see its connections
- **View modes** – isolate specific relationship types (colors, synergies, keywords, …)

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/graph` | Full graph (Cytoscape.js JSON). Params: `node_type`, `rel` |
| `GET /api/stats` | Graph statistics |
| `GET /api/search?q=…` | Search nodes by label |
| `GET /api/query?color=W&card_type=Creature&keyword=Flying` | Structured card query |
| `GET /api/node/<id>` | Node + immediate neighborhood |
| `GET /api/path?source=…&target=…` | Shortest path between nodes |
| `GET /api/neighbors?node_id=…&rel=…` | Neighbors filtered by relationship |
| `POST /api/refresh` | Re-fetch from Scryfall and rebuild |

## Project Structure

```
mtg-knowledge-graph/
├── backend/
│   ├── scryfall.py      # Scryfall API client
│   ├── ontology.py      # Graph builder + ontology
│   └── server.py        # Flask API + static serving
├── frontend/
│   ├── index.html       # Single-page app
│   ├── styles.css       # Dark theme styles
│   └── app.js           # Cytoscape.js visualization
├── data/                # Cached cards + graph (gitignored)
├── requirements.txt
└── README.md
```
