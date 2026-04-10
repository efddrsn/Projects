import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import init_db
from app.routes import router

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.temp_dir.mkdir(parents=True, exist_ok=True)
    await init_db()
    logger.info("Video Analyzer started")
    yield
    logger.info("Video Analyzer shutting down")


app = FastAPI(
    title="Video Analyzer",
    description="Analyze Google Drive videos with LLMs. Supports Gemini, GPT-4o, and Claude.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

# Resolve frontend path: prefer the absolute container path, fall back to
# the relative path derived from this file's location so local dev still works.
_abs_frontend = Path("/app/frontend")
_rel_frontend = Path(__file__).parent.parent.parent / "frontend"
frontend_path = _abs_frontend if _abs_frontend.exists() else _rel_frontend

if frontend_path.exists():
    logger.info("Mounting frontend static files from %s", frontend_path)
    app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="frontend")
else:
    logger.warning(
        "Frontend directory not found at %s or %s — UI will not be served",
        _abs_frontend,
        _rel_frontend,
    )
