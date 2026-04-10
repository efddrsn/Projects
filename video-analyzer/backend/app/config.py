from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    app_name: str = "Video Analyzer"
    debug: bool = False

    database_url: str = "sqlite+aiosqlite:///./data/video_analyzer.db"
    data_dir: Path = Path("./data")
    temp_dir: Path = Path("./data/tmp")

    encryption_key: str = ""

    max_video_size_mb: int = 2000
    max_video_duration_seconds: int = 7200  # 2 hours

    # Default chunk settings
    default_chunk_duration_seconds: int = 300  # 5 min chunks
    overlap_seconds: int = 10  # overlap between chunks for context continuity

    # Rate limiting
    rate_limit_requests_per_minute: int = 30
    max_concurrent_analyses: int = 2
    max_context_summaries: int = 6
    context_summary_max_chars: int = 1800

    host: str = "0.0.0.0"
    port: int = 8000
    web_concurrency: int = 1

    model_config = {"env_prefix": "VA_", "env_file": ".env"}


settings = Settings()
