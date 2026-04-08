# MTG MCP Server

A hosted [Model Context Protocol](https://modelcontextprotocol.io/) server that gives AI agents access to Magic: The Gathering data through the Scryfall API and other MTG APIs.

## Tools Available

### Scryfall API (Full Coverage)

| Tool | Description |
|------|-------------|
| `scryfall_search_cards` | Search cards with Scryfall's full query syntax |
| `scryfall_get_card_by_name` | Get a card by exact or fuzzy name |
| `scryfall_get_card` | Get card by Scryfall ID, set/number, Multiverse ID, MTGO ID, Arena ID, TCGPlayer ID, or Cardmarket ID |
| `scryfall_autocomplete` | Autocomplete card names (up to 20 suggestions) |
| `scryfall_random_card` | Get a random card, optionally filtered |
| `scryfall_card_collection` | Fetch up to 75 specific cards in one request |
| `scryfall_list_sets` | List all MTG sets |
| `scryfall_get_set` | Get set details by code or ID |
| `scryfall_get_rulings` | Get official rulings for a card |
| `scryfall_list_symbols` | List all mana symbols |
| `scryfall_parse_mana_cost` | Parse a mana cost string |
| `scryfall_get_catalog` | Get reference catalogs (creature types, keywords, etc.) |
| `scryfall_bulk_data` | Info about bulk data exports |
| `scryfall_migrations` | Card migration tracking |
| `scryfall_price_check` | Look up card prices (USD, EUR, tix) |
| `scryfall_check_legality` | Check format legality |

### Other MTG APIs

| Tool | Description |
|------|-------------|
| `mtg_generate_booster` | Simulate opening a booster pack for any set |

## Running Locally

### stdio mode (for local MCP clients like Claude Code)

```bash
npm install
npm run build
npm run start:stdio
```

Add to your MCP client config:
```json
{
  "mcpServers": {
    "mtg": {
      "command": "node",
      "args": ["/path/to/mtg-mcp-server/dist/index.js"]
    }
  }
}
```

### HTTP mode (for hosted/remote access)

```bash
npm install
npm run build
npm start
```

The server runs on `http://localhost:3001/mcp` with streamable HTTP transport.

Connect from a remote MCP client:
```json
{
  "mcpServers": {
    "mtg": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

## Deployment

### Render

Click "New Web Service" on Render and point to this repo. The `render.yaml` handles configuration. Free tier works fine.

### Fly.io

```bash
fly launch --config fly.toml
fly deploy
```

### Docker

```bash
docker build -t mtg-mcp-server .
docker run -p 3001:3001 mtg-mcp-server
```

### Railway / Other PaaS

Set build command to `npm ci && npm run build` and start command to `node dist/http-server.js`. Expose port 3001.

## API Rate Limits

- **Scryfall**: Max 10 requests/second (server enforces 100ms minimum between requests)
- **magicthegathering.io**: No documented rate limit, but please be respectful

## Health Check

`GET /health` returns `{ "status": "ok", "server": "mtg-mcp-server", "version": "1.0.0" }`
