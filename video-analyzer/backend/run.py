#!/usr/bin/env python3
"""Entry point for the Video Analyzer service."""
import os
import uvicorn
from app.config import settings

if __name__ == "__main__":
    port = int(os.environ.get("PORT", settings.port))
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=port,
        reload=settings.debug,
        workers=1 if settings.debug else max(settings.web_concurrency, 1),
    )
