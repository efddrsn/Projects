# Video Analyzer

Analyze Google Drive videos with LLMs (Gemini, GPT-4o, Claude). Accessible via mobile-friendly web UI, REST API, or MCP server.

## Features

- **Google Drive integration** — paste any shared Drive link
- **Multi-provider LLM support** — Google Gemini, OpenAI GPT-4o, Anthropic Claude
- **Smart video chunking** — automatically handles long videos exceeding model context limits
- **4 strategies for long videos**:
  - `sequential_summary` — analyze chunks with accumulated context, then synthesize (best for full coverage)
  - `keyframe_summary` — extract keyframes as images (fast, works with all providers)
  - `user_segments` — analyze only a specific time range
  - `fail_if_too_long` — strict mode, error if video exceeds model limit
- **Encrypted API key storage** — save keys once, reuse across sessions
- **Mobile-friendly PWA** — use from your phone
- **MCP server** — integrate with Claude Desktop, Cursor, or any MCP client
- **Railway deployment** — persistent, free-tier friendly

## How Long Video Handling Works

Different LLMs have different video capabilities:

| Provider | Native Video | Max Duration | Fallback |
|----------|-------------|-------------|----------|
| Google Gemini | Yes | ~60 min | Chunking with context carry |
| OpenAI GPT-4o | No (frames) | ~10 min | Keyframe extraction |
| Anthropic Claude | No (frames) | ~10 min | Keyframe extraction |

**Sequential Summary Strategy** (recommended for long videos):
1. Video is split into overlapping chunks (default: 5 min with 10s overlap)
2. Each chunk is analyzed with the full prompt + summaries from all prior chunks
3. After all chunks: a synthesis call combines all chunk analyses into a final answer
4. This ensures full context coverage — no information is lost between chunks

**Keyframe Summary Strategy** (faster, less detail):
1. Extracts ~30 keyframes at regular intervals
2. Sends all frames as images in a single LLM call
3. Good for visual analysis, misses audio/motion details

## Quick Start

### Local Development

```bash
cd video-analyzer/backend

# Create virtual environment
python -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Generate encryption key
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

# Set environment variables
export VA_ENCRYPTION_KEY="your-generated-key"
export VA_DEBUG=true

# Run the server
python run.py
```

Open http://localhost:8000 in your browser.

### Deploy to Railway

1. Push this repo to GitHub
2. Create a new project on [Railway](https://railway.app)
3. Connect your GitHub repo and select the `video-analyzer` directory
4. Add environment variables:
   - `VA_ENCRYPTION_KEY` — generate with the command above
   - `PORT` — Railway sets this automatically
5. Add a persistent volume mounted at `/app/data`
6. Deploy!

Railway provides persistent storage (volume mount), always-on hosting, and automatic HTTPS.

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VA_ENCRYPTION_KEY` | Yes | — | Fernet key for encrypting stored API keys |
| `VA_PORT` | No | 8000 | Server port |
| `VA_DEBUG` | No | false | Enable debug logging |
| `VA_MAX_VIDEO_SIZE_MB` | No | 500 | Max video file size |
| `VA_DEFAULT_CHUNK_DURATION_SECONDS` | No | 300 | Default chunk size for long videos |
| `PORT` | No | — | Railway port override |

## API Reference

### Analyze Video (Async)
```bash
POST /api/analyze
```
Starts analysis in the background, returns a job ID for polling.

```bash
curl -X POST https://your-app.railway.app/api/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "google_drive_url": "https://drive.google.com/file/d/ABC123/view",
    "prompt": "Summarize this video",
    "model": "gemini-2.0-flash",
    "user_token": "your-token",
    "strategy": "sequential_summary"
  }'
```

### Analyze Video (Sync)
```bash
POST /api/analyze/sync
```
Waits for the result. Useful for MCP and scripts.

### Check Job Status
```bash
GET /api/job/{job_id}
```

### Store API Key
```bash
POST /api/store-key
{
  "user_token": "your-token",
  "provider": "google",
  "api_key": "AIza..."
}
```

### Generate User Token
```bash
POST /api/generate-token
```

### List Stored Keys
```bash
GET /api/keys/{user_token}
```

### Delete Stored Key
```bash
DELETE /api/delete-key/{user_token}/{provider}
```

## MCP Server

### As HTTP/SSE (remote)

Add to your MCP client config:
```json
{
  "mcpServers": {
    "video-analyzer": {
      "url": "https://your-app.railway.app/mcp",
      "transport": "sse"
    }
  }
}
```

### As stdio (local)

```json
{
  "mcpServers": {
    "video-analyzer": {
      "command": "python",
      "args": ["mcp_stdio.py"],
      "cwd": "/path/to/video-analyzer/backend",
      "env": {
        "VA_ENCRYPTION_KEY": "your-key"
      }
    }
  }
}
```

### Available MCP Tools

- `analyze_video` — Analyze a Google Drive video with an LLM
- `store_api_key` — Store an API key for future use
- `generate_user_token` — Generate a user token
- `list_stored_keys` — List stored provider keys

## Architecture

```
video-analyzer/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI app with lifespan
│   │   ├── routes.py         # REST API endpoints
│   │   ├── analyzer.py       # Core analysis orchestration
│   │   ├── video_processing.py  # ffmpeg video ops
│   │   ├── llm_providers.py  # Google/OpenAI/Anthropic adapters
│   │   ├── gdrive.py         # Google Drive download
│   │   ├── crypto.py         # Fernet encryption for API keys
│   │   ├── database.py       # SQLite async storage
│   │   ├── models.py         # Pydantic schemas
│   │   ├── config.py         # Settings
│   │   └── mcp_server.py     # MCP tool definitions
│   ├── run.py                # HTTP server entry point
│   ├── mcp_stdio.py          # MCP stdio entry point
│   └── requirements.txt
├── frontend/
│   ├── index.html            # Mobile-friendly PWA
│   ├── styles.css
│   ├── app.js
│   └── manifest.json
├── Dockerfile
├── railway.toml
└── README.md
```

## Tech Stack

- **Backend**: Python, FastAPI, uvicorn
- **Video Processing**: ffmpeg (via subprocess)
- **Database**: SQLite (aiosqlite) with persistent volume
- **Encryption**: Fernet (cryptography library)
- **Frontend**: Vanilla HTML/CSS/JS (no build step)
- **Deployment**: Railway with Docker
- **MCP**: mcp[server] SDK
