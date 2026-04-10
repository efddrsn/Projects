import logging
import asyncio
from pathlib import Path
from typing import Optional

from app.models import LongVideoStrategy
from app.video_processing import (
    get_video_info,
    split_video_into_chunks,
    extract_keyframes,
    get_model_limits,
)
from app.llm_providers import detect_provider, PROVIDER_HANDLERS

logger = logging.getLogger(__name__)


async def analyze_video(
    video_path: Path,
    prompt: str,
    model: str,
    api_key: str,
    provider: Optional[str] = None,
    strategy: LongVideoStrategy = LongVideoStrategy.SEQUENTIAL_SUMMARY,
    segment_start: Optional[float] = None,
    segment_end: Optional[float] = None,
    max_chunk_duration: Optional[int] = None,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
) -> dict:
    provider = provider or detect_provider(model)
    handler = PROVIDER_HANDLERS.get(provider)
    if not handler:
        raise ValueError(f"Unknown provider: {provider}. Use: google, openai, anthropic")

    info = await asyncio.to_thread(get_video_info, video_path)
    limits = get_model_limits(model)
    max_duration = limits["max_duration_seconds"]
    supports_video = limits["supports_video_upload"]

    logger.info(
        f"Video: {info.duration:.0f}s, {info.width}x{info.height}, {info.size_mb:.1f}MB | "
        f"Model: {model} ({provider}), limit: {max_duration}s, video_upload: {supports_video}"
    )

    effective_start = segment_start or 0.0
    effective_end = segment_end or info.duration
    effective_duration = effective_end - effective_start

    if effective_duration <= max_duration and supports_video:
        if segment_start is not None or segment_end is not None:
            chunks = await asyncio.to_thread(
                split_video_into_chunks,
                video_path,
                int(effective_duration) + 1,
                0,
                segment_start,
                segment_end,
            )
            video_to_send = chunks[0].path if chunks else video_path
        else:
            video_to_send = video_path

        result = await handler(
            api_key=api_key, model=model, prompt=prompt,
            video_path=video_to_send, temperature=temperature, max_tokens=max_tokens,
        )
        return {"result": result, "chunks_processed": 1, "total_chunks": 1, "strategy": "direct"}

    if strategy == LongVideoStrategy.FAIL_IF_TOO_LONG:
        return {
            "result": None,
            "error": (
                f"Video duration ({effective_duration:.0f}s) exceeds model limit ({max_duration}s). "
                f"Use a different strategy or shorten the video."
            ),
            "chunks_processed": 0,
            "total_chunks": 0,
            "strategy": "fail_if_too_long",
        }

    if strategy == LongVideoStrategy.USER_SEGMENTS:
        if segment_start is None or segment_end is None:
            return {
                "result": None,
                "error": "user_segments strategy requires segment_start and segment_end.",
                "chunks_processed": 0,
                "total_chunks": 0,
                "strategy": "user_segments",
            }

    if strategy == LongVideoStrategy.KEYFRAME_SUMMARY:
        return await _keyframe_strategy(
            video_path, prompt, model, api_key, provider, handler,
            segment_start, segment_end, temperature, max_tokens,
        )

    return await _sequential_summary_strategy(
        video_path, prompt, model, api_key, provider, handler,
        max_chunk_duration or min(max_duration, 300),
        segment_start, segment_end, temperature, max_tokens, supports_video,
    )


async def _sequential_summary_strategy(
    video_path, prompt, model, api_key, provider, handler,
    chunk_duration, segment_start, segment_end,
    temperature, max_tokens, supports_video,
):
    """
    Process each chunk, carry forward accumulated context, then synthesize.
    Each chunk sees: original prompt + all prior chunk summaries, ensuring full context coverage.
    """
    chunks = await asyncio.to_thread(
        split_video_into_chunks,
        video_path,
        chunk_duration,
        10,
        segment_start,
        segment_end,
    )

    if len(chunks) == 1:
        if supports_video:
            result = await handler(
                api_key=api_key, model=model, prompt=prompt,
                video_path=chunks[0].path, temperature=temperature, max_tokens=max_tokens,
            )
        else:
            kf = await asyncio.to_thread(extract_keyframes, chunks[0].path, 20)
            result = await handler(
                api_key=api_key, model=model, prompt=prompt,
                frames=kf.frames, frame_timestamps=kf.timestamps,
                temperature=temperature, max_tokens=max_tokens,
            )
        return {"result": result, "chunks_processed": 1, "total_chunks": 1, "strategy": "sequential_summary"}

    chunk_summaries = []

    for chunk in chunks:
        context_header = (
            f"You are analyzing part {chunk.index + 1} of {chunk.total_chunks} "
            f"of a video (time {chunk.start_time:.0f}s - {chunk.end_time:.0f}s).\n\n"
        )
        if chunk_summaries:
            context_header += "PRIOR CONTEXT from earlier parts of this video:\n"
            for i, s in enumerate(chunk_summaries):
                context_header += f"--- Part {i + 1} summary ---\n{s}\n\n"

        chunk_prompt = (
            f"{context_header}"
            f"USER PROMPT: {prompt}\n\n"
            f"Analyze this video segment thoroughly. Provide a detailed summary "
            f"relevant to the user's prompt. Include timestamps where relevant."
        )

        if supports_video:
            summary = await handler(
                api_key=api_key, model=model, prompt=chunk_prompt,
                video_path=chunk.path, temperature=temperature, max_tokens=max_tokens,
            )
        else:
            kf = await asyncio.to_thread(extract_keyframes, chunk.path, 15)
            summary = await handler(
                api_key=api_key, model=model, prompt=chunk_prompt,
                frames=kf.frames, frame_timestamps=kf.timestamps,
                temperature=temperature, max_tokens=max_tokens,
            )
        chunk_summaries.append(summary)
        logger.info(f"Chunk {chunk.index + 1}/{chunk.total_chunks} analyzed")

    synthesis_prompt = (
        f"You analyzed a video in {len(chunks)} parts. "
        f"Below are your detailed analyses of each part.\n\n"
    )
    for i, s in enumerate(chunk_summaries):
        c = chunks[i]
        synthesis_prompt += f"=== Part {i + 1} ({c.start_time:.0f}s - {c.end_time:.0f}s) ===\n{s}\n\n"

    synthesis_prompt += (
        f"USER'S ORIGINAL PROMPT: {prompt}\n\n"
        f"Now synthesize all the above into a single comprehensive response to the user's prompt. "
        f"Ensure you cover the entire video, not just individual parts. Reference specific timestamps."
    )

    # The synthesis call is text-only: all visual info is in the chunk summaries
    if supports_video:
        final_result = await handler(
            api_key=api_key, model=model, prompt=synthesis_prompt,
            temperature=temperature, max_tokens=max_tokens,
        )
    else:
        final_result = await handler(
            api_key=api_key, model=model, prompt=synthesis_prompt,
            temperature=temperature, max_tokens=max_tokens,
        )

    return {
        "result": final_result,
        "chunks_processed": len(chunks),
        "total_chunks": len(chunks),
        "strategy": "sequential_summary",
    }


async def _keyframe_strategy(
    video_path, prompt, model, api_key, provider, handler,
    segment_start, segment_end, temperature, max_tokens,
):
    """Extract keyframes from the entire video and send as images."""
    kf = await asyncio.to_thread(extract_keyframes, video_path, 30)

    keyframe_prompt = (
        f"These are {len(kf.frames)} keyframes extracted from a video at regular intervals.\n\n"
        f"USER PROMPT: {prompt}\n\n"
        f"Analyze these frames comprehensively to answer the user's question."
    )

    result = await handler(
        api_key=api_key, model=model, prompt=keyframe_prompt,
        frames=kf.frames, frame_timestamps=kf.timestamps,
        temperature=temperature, max_tokens=max_tokens,
    )

    return {
        "result": result,
        "chunks_processed": 1,
        "total_chunks": 1,
        "strategy": "keyframe_summary",
        "keyframes_extracted": len(kf.frames),
    }
