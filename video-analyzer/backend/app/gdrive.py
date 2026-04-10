import re
import httpx
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


def _parse_virus_scan_page(html: str, file_id: str) -> str | None:
    """Parse the Google Drive virus scan warning page and build the confirmed download URL."""
    action_match = re.search(r'action="([^"]+)"', html)
    if not action_match:
        return None

    base_url = action_match.group(1)
    params = {}
    for name, value in re.findall(r'<input type="hidden" name="(\w+)" value="([^"]*)"', html):
        params[name] = value

    if not params:
        return None

    query = "&".join(f"{k}={v}" for k, v in params.items())
    return f"{base_url}?{query}"


def _is_html_response(content_start: bytes) -> bool:
    return content_start.lstrip()[:15].lower().startswith(b"<!doctype") or \
           content_start.lstrip()[:6].lower().startswith(b"<html")


async def download_from_gdrive(url: str, timeout: float = 1800.0) -> Path:
    """Download a video file from Google Drive.

    Handles:
    - Direct small file downloads
    - Virus scan warning bypass for large files (parses the HTML form)
    - Streaming download to avoid memory issues with large files
    """
    file_id = extract_file_id(url)
    settings.temp_dir.mkdir(parents=True, exist_ok=True)
    output_path = settings.temp_dir / f"{file_id}.mp4"

    if output_path.exists() and output_path.stat().st_size > 10_000:
        logger.info(f"Using cached file: {output_path} ({output_path.stat().st_size / (1024*1024):.1f} MB)")
        return output_path

    if output_path.exists():
        output_path.unlink()

    download_urls = [
        f"https://drive.google.com/uc?export=download&id={file_id}",
        f"https://drive.usercontent.google.com/download?id={file_id}&export=download&confirm=t",
    ]

    async with httpx.AsyncClient(follow_redirects=True, timeout=httpx.Timeout(timeout, connect=30.0)) as client:
        for attempt_url in download_urls:
            logger.info(f"Trying download URL: {attempt_url}")
            async with client.stream("GET", attempt_url) as response:
                if response.status_code != 200:
                    logger.warning(f"HTTP {response.status_code} from {attempt_url}")
                    continue

                content_type = response.headers.get("content-type", "")
                byte_iter = response.aiter_bytes(chunk_size=8192 * 16)
                first_chunk = await anext(byte_iter, b"")
                content_start = first_chunk[:500]

                if "text/html" in content_type or _is_html_response(content_start):
                    html = (first_chunk + await response.aread()).decode("utf-8", errors="ignore")

                    if "<title>Sign in" in html or "accounts.google.com" in html:
                        raise RuntimeError(
                            "Google Drive requires sign-in. "
                            "Set file sharing to 'Anyone with the link'."
                        )

                    if "virus scan" in html.lower() or "download-form" in html:
                        confirmed_url = _parse_virus_scan_page(html, file_id)
                        if confirmed_url:
                            logger.info(f"Bypassing virus scan, downloading from: {confirmed_url}")
                            await _stream_download(client, confirmed_url, output_path)
                            break

                        logger.warning("Could not parse virus scan page, trying next URL")
                        continue

                    logger.warning(f"Received HTML response (not a video). Content-type: {content_type}")
                    continue

                logger.info("Direct download succeeded, streaming to disk...")
                await _write_stream_to_file(output_path, byte_iter, initial_chunk=first_chunk)
                break
        else:
            raise RuntimeError(
                "Failed to download from Google Drive after all attempts. "
                "Make sure the file is shared publicly ('Anyone with the link')."
            )

    if not output_path.exists() or output_path.stat().st_size == 0:
        if output_path.exists():
            output_path.unlink()
        raise RuntimeError("Download produced an empty file. The Drive link may be invalid.")

    file_size_mb = output_path.stat().st_size / (1024 * 1024)
    logger.info(f"Downloaded {file_size_mb:.1f} MB to {output_path}")

    if file_size_mb > settings.max_video_size_mb:
        output_path.unlink()
        raise ValueError(
            f"Video exceeds maximum size of {settings.max_video_size_mb} MB ({file_size_mb:.1f} MB)"
        )

    with open(output_path, "rb") as f:
        content_check = f.read(500)
    if _is_html_response(content_check):
        output_path.unlink()
        raise RuntimeError(
            "Downloaded file appears to be HTML, not a video. "
            "Ensure the file is shared publicly and is a video file."
        )

    return output_path


async def _stream_download(client: httpx.AsyncClient, url: str, output_path: Path):
    """Stream a large file download to disk to avoid memory issues."""
    async with client.stream("GET", url) as response:
        if response.status_code != 200:
            raise RuntimeError(f"Stream download failed with HTTP {response.status_code}")
        byte_iter = response.aiter_bytes(chunk_size=8192 * 16)
        first_chunk = await anext(byte_iter, b"")
        await _write_stream_to_file(output_path, byte_iter, initial_chunk=first_chunk)


async def _write_stream_to_file(output_path: Path, byte_iter, initial_chunk: bytes = b""):
    downloaded = 0
    with open(output_path, "wb") as f:
        if initial_chunk:
            f.write(initial_chunk)
            downloaded += len(initial_chunk)
        async for chunk in byte_iter:
            f.write(chunk)
            downloaded += len(chunk)
            if downloaded % (50 * 1024 * 1024) < 8192 * 16:
                logger.info(f"Downloaded {downloaded / (1024*1024):.0f} MB...")

    logger.info(f"Stream download complete: {downloaded / (1024*1024):.1f} MB")
