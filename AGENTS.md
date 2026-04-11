# AGENTS.md

## Cursor Cloud specific instructions

### Repository Overview

This is a monorepo with 4 independent applications (no shared DB or message bus). Each project can be developed and tested in isolation.

| Project | Tech | Port | Dev Command |
|---------|------|------|-------------|
| `mtg-eventos-sp` | Next.js 14 / TypeScript | 3000 | `cd mtg-eventos-sp && npm run dev` |
| `mtg-mcp-server` | Express / TypeScript / MCP SDK | 3001 | `cd mtg-mcp-server && npm run dev` |
| `mtg-knowledge-graph` | Flask / Python / NetworkX | 5000 | `cd mtg-knowledge-graph && python3 -m backend.server` |
| `video-analyzer` | FastAPI / Python / uvicorn | 8000 | `cd video-analyzer/backend && python3 run.py` |

### Running services

- **mtg-eventos-sp**: No external dependencies. Firecrawl API key is optional (entered in browser UI).
- **mtg-mcp-server**: Depends on Scryfall API (public, rate-limited 10 req/s). Build with `npm run build` (TypeScript), run dev with `npm run dev`.
- **mtg-knowledge-graph**: On first launch, fetches ~1000 cards from Scryfall (~30s). Caches in `data/` directory. Uses Flask debug mode by default.
- **video-analyzer**: Requires `VA_ENCRYPTION_KEY` env var (Fernet key). Generate with: `python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`. Also requires `ffmpeg` (pre-installed). Set `VA_DEBUG=true` for reload mode. LLM API keys (Gemini/OpenAI/Anthropic) are optional — only needed for actual video analysis.

### Lint and Build

- **mtg-eventos-sp**: `npm run lint` (ESLint via Next.js). Requires `.eslintrc.json` — if missing, create with `{"extends": "next/core-web-vitals"}`.
- **mtg-mcp-server**: `npm run build` compiles TypeScript to `dist/`. No separate lint script.
- Python projects: No configured linters in repo.

### Package managers

- Node projects use `npm` (lockfile: `package-lock.json`).
- Python projects use `pip` with `requirements.txt`.

### Key gotchas

- The `mtg-eventos-sp` lint command (`next lint`) prompts interactively if `.eslintrc.json` is missing. Always ensure the config file exists before running lint.
- The `video-analyzer` will fail to start without `VA_ENCRYPTION_KEY`. Generate a fresh Fernet key each session if not persisted.
- The `mtg-knowledge-graph` Flask server runs in debug mode with auto-reload by default. On first start, expect ~30s delay while it fetches cards from Scryfall.
