import re
import httpx
import tempfile
import logging
from pathlib import Path
from app.config import settings

logger = logging.getLogger(__name__)


def extract_file_id(url: str) -> str:
    """Extract Google Drive file ID from various URL formats."""
    patterns = [
        r"/file/d/([a-zA-Z0-9_-]+)",
        r"id=([a-zA-Z0-9_-]+)",
        r"/d/([a-zA-Z0-9_-]+)",
        r"^([a-zA-Z0-9_-]{20,})$",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    raise ValueError(f"Could not extract Google Drive file ID from: {url}")


async def download_from_gdrive(url: str, timeout: float = 600.0) -> Path:
    """Download a video file from Google Drive. Supports large files with virus scan warning bypass."""
    file_id = extract_file_id(url)
    settings.temp_dir.mkdir(parents=True, exist_ok=True)
    output_path = settings.temp_dir / f"{file_id}.mp4"

    if output_path.exists():
        logger.info(f"Using cached file: {output_path}")
        return output_path

    download_url = f"https://drive.google.com/uc?export=download&id={file_id}"

    async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
        response = await client.get(download_url)

        if "confirm=" in str(response.url) or b"virus scan" in response.content.lower()[:1000]:
            confirm_url = f"https://drive.google.com/uc?export=download&confirm=t&id={file_id}"
            response = await client.get(confirm_url)

        if response.status_code != 200:
            alt_url = f"https://drive.usercontent.google.com/download?id={file_id}&export=download&confirm=t"
            response = await client.get(alt_url)

        if response.status_code != 200:
            raise RuntimeError(
                f"Failed to download from Google Drive (HTTP {response.status_code}). "
                "Make sure the file is shared publicly (Anyone with the link)."
            )

        content_type = response.headers.get("content-type", "")
        if "text/html" in content_type and len(response.content) < 100_000:
            if b"<title>Sign in" in response.content or b"accounts.google.com" in response.content:
                raise RuntimeError(
                    "Google Drive requires sign-in for this file. "
                    "Please ensure the file sharing is set to 'Anyone with the link'."
                )

        with open(output_path, "wb") as f:
            f.write(response.content)

    file_size_mb = output_path.stat().st_size / (1024 * 1024)
    logger.info(f"Downloaded {file_size_mb:.1f} MB to {output_path}")

    if file_size_mb > settings.max_video_size_mb:
        output_path.unlink()
        raise ValueError(f"Video exceeds maximum size of {settings.max_video_size_mb} MB ({file_size_mb:.1f} MB)")

    return output_path
