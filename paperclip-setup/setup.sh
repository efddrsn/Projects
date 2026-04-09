#!/usr/bin/env bash
# Paperclip quick setup script
# Usage: ./setup.sh [local|railway]

set -euo pipefail

MODE="${1:-local}"

case "$MODE" in
  local)
    echo "=== Local Docker Setup ==="
    if ! command -v docker &>/dev/null; then
      echo "Error: Docker is required. Install from https://docs.docker.com/get-docker/"
      exit 1
    fi
    if [ ! -f .env ]; then
      cp .env.example .env
      echo "Created .env from template - edit it to add your API keys"
    fi
    docker compose up -d
    echo ""
    echo "Paperclip is starting at http://localhost:3100"
    echo "Visit http://localhost:3100/setup to create your admin account"
    echo ""
    echo "To access from your phone on the same Wi-Fi network:"
    LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "<your-local-ip>")
    echo "  http://${LOCAL_IP}:3100"
    ;;

  railway)
    echo "=== Railway Cloud Deploy ==="
    echo ""
    echo "1. Go to: https://railway.com/new/template"
    echo "2. Search for 'Paperclip' and click the official template"
    echo "3. Click 'Deploy Now' (requires GitHub login)"
    echo "4. Add environment variables:"
    echo "   - ANTHROPIC_API_KEY (for Claude agents)"
    echo "   - OPENAI_API_KEY   (for GPT agents)"
    echo "5. Railway gives you a public URL like:"
    echo "   https://paperclip-abc123.up.railway.app"
    echo "6. Visit <your-url>/setup to create admin account"
    echo "7. Bookmark that URL on your phone!"
    echo ""
    echo "Cost: Free \$5 trial (30 days), then \$5/month Hobby plan"
    ;;

  *)
    echo "Usage: ./setup.sh [local|railway]"
    echo "  local   - Run with Docker on this machine"
    echo "  railway - Instructions for Railway cloud deploy"
    exit 1
    ;;
esac
