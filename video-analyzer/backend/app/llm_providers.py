import base64
import logging
import json
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


def detect_provider(model: str) -> str:
    model_lower = model.lower()
    if any(x in model_lower for x in ["gemini", "gemma"]):
        return "google"
    if any(x in model_lower for x in ["gpt", "o1", "o3", "o4"]):
        return "openai"
    if any(x in model_lower for x in ["claude", "sonnet", "haiku", "opus"]):
        return "anthropic"
    return "google"


async def analyze_with_google(
    api_key: str,
    model: str,
    prompt: str,
    video_path: Optional[Path] = None,
    frames: Optional[list[bytes]] = None,
    frame_timestamps: Optional[list[float]] = None,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
) -> str:
    import google.generativeai as genai

    genai.configure(api_key=api_key)
    gen_model = genai.GenerativeModel(model)

    generation_config = {}
    if temperature is not None:
        generation_config["temperature"] = temperature
    if max_tokens is not None:
        generation_config["max_output_tokens"] = max_tokens

    parts = []

    if video_path and video_path.exists():
        video_bytes = video_path.read_bytes()
        parts.append({"mime_type": "video/mp4", "data": video_bytes})
    elif frames:
        for i, frame in enumerate(frames):
            ts_label = f" (t={frame_timestamps[i]:.1f}s)" if frame_timestamps else ""
            parts.append(f"Frame {i + 1}{ts_label}:")
            parts.append({"mime_type": "image/jpeg", "data": frame})

    parts.append(prompt)

    response = await gen_model.generate_content_async(
        parts,
        generation_config=generation_config or None,
    )
    return response.text


async def analyze_with_openai(
    api_key: str,
    model: str,
    prompt: str,
    video_path: Optional[Path] = None,
    frames: Optional[list[bytes]] = None,
    frame_timestamps: Optional[list[float]] = None,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
) -> str:
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=api_key)

    content = []

    if frames:
        for i, frame in enumerate(frames):
            b64 = base64.b64encode(frame).decode("utf-8")
            ts_label = f" (t={frame_timestamps[i]:.1f}s)" if frame_timestamps else ""
            content.append({"type": "text", "text": f"Frame {i + 1}{ts_label}:"})
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "low"},
            })
    elif video_path and video_path.exists():
        from app.video_processing import extract_keyframes
        kf = extract_keyframes(video_path, max_frames=20)
        for i, frame in enumerate(kf.frames):
            b64 = base64.b64encode(frame).decode("utf-8")
            content.append({"type": "text", "text": f"Frame {i + 1} (t={kf.timestamps[i]:.1f}s):"})
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "low"},
            })

    content.append({"type": "text", "text": prompt})

    kwargs = {"model": model, "messages": [{"role": "user", "content": content}]}
    if temperature is not None:
        kwargs["temperature"] = temperature
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens

    response = await client.chat.completions.create(**kwargs)
    return response.choices[0].message.content


async def analyze_with_anthropic(
    api_key: str,
    model: str,
    prompt: str,
    video_path: Optional[Path] = None,
    frames: Optional[list[bytes]] = None,
    frame_timestamps: Optional[list[float]] = None,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
) -> str:
    from anthropic import AsyncAnthropic

    client = AsyncAnthropic(api_key=api_key)

    content = []

    if frames:
        for i, frame in enumerate(frames):
            b64 = base64.b64encode(frame).decode("utf-8")
            ts_label = f" (t={frame_timestamps[i]:.1f}s)" if frame_timestamps else ""
            content.append({"type": "text", "text": f"Frame {i + 1}{ts_label}:"})
            content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": "image/jpeg", "data": b64},
            })
    elif video_path and video_path.exists():
        from app.video_processing import extract_keyframes
        kf = extract_keyframes(video_path, max_frames=20)
        for i, frame in enumerate(kf.frames):
            b64 = base64.b64encode(frame).decode("utf-8")
            content.append({"type": "text", "text": f"Frame {i + 1} (t={kf.timestamps[i]:.1f}s):"})
            content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": "image/jpeg", "data": b64},
            })

    content.append({"type": "text", "text": prompt})

    kwargs = {
        "model": model,
        "max_tokens": max_tokens or 4096,
        "messages": [{"role": "user", "content": content}],
    }
    if temperature is not None:
        kwargs["temperature"] = temperature

    response = await client.messages.create(**kwargs)
    return response.content[0].text


PROVIDER_HANDLERS = {
    "google": analyze_with_google,
    "openai": analyze_with_openai,
    "anthropic": analyze_with_anthropic,
}
