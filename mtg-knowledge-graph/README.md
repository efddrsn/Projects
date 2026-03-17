# MTG Knowledge Graph

An interactive knowledge graph of Magic: The Gathering cards, built from the [Scryfall API](https://scryfall.com/docs/api) and connected by a rich ontology.

**[Live Demo →](https://efddrsn.github.io/Projects/)**

## Ontology

Cards are connected through typed relationships to shared concept nodes:

| Node Type    | Examples                             |
|--------------|--------------------------------------|
| **Card**     | Lightning Bolt, Thalia, …            |
| **Color**    | White, Blue, Black, Red, Green       |
| **CardType** | Creature, Instant, Enchantment       |
| **Subtype**  | Elf, Wizard, Dragon, Equipment       |
| **Supertype**| Legendary, Basic, Snow               |
| **Keyword**  | Flying, Trample, Haste               |
| **Set**      | Modern Horizons 2, Wilds of Eldraine |

Edges: `HAS_COLOR`, `HAS_COLOR_IDENTITY`, `HAS_TYPE`, `HAS_SUBTYPE`, `HAS_SUPERTYPE`, `HAS_KEYWORD`, `IN_SET`, `PRODUCES_MANA`, and `SYNERGY` (cards sharing ≥2 subtypes/keywords).

## Features

- **Interactive graph visualization** – Cytoscape.js with force-directed, circle, and concentric layouts
- **Mobile-friendly** – responsive sidebar drawer, touch-optimized controls
- **Search** – find any card, keyword, type, or concept node
- **Structured queries** – filter by color, type, subtype, keyword
- **Path finder** – shortest-path between any two nodes
- **Neighborhood explorer** – tap any node to see its connections
- **View modes** – isolate specific relationship types (colors, synergies, keywords, …)
- **Static site** – runs entirely client-side, deployed to GitHub Pages

## Running Locally

### Static site (no backend needed)

```bash
cd mtg-knowledge-graph/site
python3 -m http.server 8000
# Open http://localhost:8000
```

### With Flask backend (for development / rebuilding data)

```bash
cd mtg-knowledge-graph
pip install -r requirements.txt
python3 -m backend.server
# Open http://localhost:5000
```

### Rebuilding the static graph data

```bash
cd mtg-knowledge-graph
pip install -r requirements.txt
python3 build_static.py
```

This fetches ~1,350 cards from Scryfall and generates `site/graph.json`.

## Project Structure

```
mtg-knowledge-graph/
├── site/                # Static site (deployed to GitHub Pages)
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── graph.json       # Pre-built graph data
├── backend/             # Python backend (development only)
│   ├── scryfall.py      # Scryfall API client
│   ├── ontology.py      # Graph builder + ontology
│   └── server.py        # Flask API server
├── frontend/            # Original Flask-served frontend
├── build_static.py      # Builds site/graph.json from Scryfall
├── data/                # Cached raw data (gitignored)
├── requirements.txt
└── README.md
```

## Deployment

The static site deploys to GitHub Pages automatically via GitHub Actions when changes are pushed to `main` in the `mtg-knowledge-graph/site/` directory. Manual deployment can be triggered from the Actions tab.
