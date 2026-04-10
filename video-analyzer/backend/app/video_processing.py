import base64
import logging
import subprocess
import json
from pathlib import Path
from typing import Optional
from dataclasses import dataclass

from app.config import settings

logger = logging.getLogger(__name__)


@dataclass
class VideoInfo:
    duration: float
    width: int
    height: int
    fps: float
    size_mb: float
    codec: str


@dataclass
class VideoChunk:
    path: Path
    start_time: float
    end_time: float
    index: int
    total_chunks: int


@dataclass
class KeyframeSet:
    frames: list[bytes]  # JPEG bytes
    timestamps: list[float]
    audio_transcript: Optional[str] = None


def get_video_info(video_path: Path) -> VideoInfo:
    result = subprocess.run(
        [
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_streams", "-show_format", str(video_path),
        ],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr}")

    data = json.loads(result.stdout)
    video_stream = next(
        (s for s in data.get("streams", []) if s["codec_type"] == "video"), None
    )
    if not video_stream:
        raise ValueError("No video stream found in file")

    duration = float(data.get("format", {}).get("duration", 0))
    fps_parts = video_stream.get("r_frame_rate", "30/1").split("/")
    fps = float(fps_parts[0]) / float(fps_parts[1]) if len(fps_parts) == 2 else 30.0

    return VideoInfo(
        duration=duration,
        width=int(video_stream.get("width", 0)),
        height=int(video_stream.get("height", 0)),
        fps=fps,
        size_mb=video_path.stat().st_size / (1024 * 1024),
        codec=video_stream.get("codec_name", "unknown"),
    )


def split_video_into_chunks(
    video_path: Path,
    chunk_duration: int,
    overlap: int = 10,
    segment_start: Optional[float] = None,
    segment_end: Optional[float] = None,
) -> list[VideoChunk]:
    """Split video into overlapping chunks using ffmpeg for speed."""
    info = get_video_info(video_path)
    start = segment_start or 0.0
    end = segment_end or info.duration
    effective_step = max(chunk_duration - overlap, 60)

    chunks = []
    chunk_dir = settings.temp_dir / video_path.stem
    chunk_dir.mkdir(parents=True, exist_ok=True)

    current = start
    index = 0
    while current < end:
        chunk_end = min(current + chunk_duration, end)
        chunk_path = chunk_dir / f"chunk_{index:04d}.mp4"

        if not chunk_path.exists():
            subprocess.run(
                [
                    "ffmpeg", "-y", "-ss", str(current), "-i", str(video_path),
                    "-t", str(chunk_end - current),
                    "-c:v", "libx264", "-preset", "ultrafast",
                    "-c:a", "aac", "-movflags", "+faststart",
                    str(chunk_path),
                ],
                capture_output=True,
            )

        chunks.append(VideoChunk(
            path=chunk_path,
            start_time=current,
            end_time=chunk_end,
            index=index,
            total_chunks=0,
        ))
        current += effective_step
        index += 1

    for chunk in chunks:
        chunk.total_chunks = len(chunks)

    return chunks


def extract_keyframes(video_path: Path, max_frames: int = 30) -> KeyframeSet:
    """Extract keyframes at regular intervals as JPEG bytes."""
    info = get_video_info(video_path)
    interval = max(info.duration / max_frames, 1.0)
    frame_dir = settings.temp_dir / f"{video_path.stem}_frames"
    frame_dir.mkdir(parents=True, exist_ok=True)

    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(video_path),
            "-vf", f"fps=1/{interval},scale=1280:-2",
            "-q:v", "3",
            str(frame_dir / "frame_%04d.jpg"),
        ],
        capture_output=True,
    )

    frames = []
    timestamps = []
    for i, frame_path in enumerate(sorted(frame_dir.glob("frame_*.jpg"))):
        frames.append(frame_path.read_bytes())
        timestamps.append(i * interval)

    return KeyframeSet(frames=frames, timestamps=timestamps)


def video_to_base64(video_path: Path) -> str:
    return base64.b64encode(video_path.read_bytes()).decode("utf-8")


def frame_to_base64(frame_bytes: bytes) -> str:
    return base64.b64encode(frame_bytes).decode("utf-8")


MODEL_VIDEO_LIMITS = {
    "gemini": {"max_duration_seconds": 3600, "supports_video_upload": True},
    "gpt-4o": {"max_duration_seconds": 600, "supports_video_upload": False},
    "claude": {"max_duration_seconds": 600, "supports_video_upload": False},
}


def get_model_limits(model: str) -> dict:
    model_lower = model.lower()
    for prefix, limits in MODEL_VIDEO_LIMITS.items():
        if prefix in model_lower:
            return limits
    return {"max_duration_seconds": 300, "supports_video_upload": False}
