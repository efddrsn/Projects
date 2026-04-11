"""
MCP (Model Context Protocol) server interface for Video Analyzer.

Can be run standalone via stdio or as part of the HTTP server via SSE.
"""
import asyncio
import json
import logging
from typing import Any

from mcp.server import Server
from mcp.types import Tool, TextContent

logger = logging.getLogger(__name__)

mcp = Server("video-analyzer")

ANALYZE_TIMEOUT_SECONDS = 600


async def _send_progress(message: str) -> None:
    """Send a log-level progress message over the MCP session if available.

    This keeps the SSE connection alive during long operations so reverse
    proxies (Railway, Cloudflare, etc.) don't kill the idle connection.
    """
    try:
        ctx = mcp.request_context
        await ctx.session.send_log_message(level="info", data=message, logger="video-analyzer")
    except Exception:
        logger.debug("Could not send MCP progress notification: %s", message)


def _build_tools() -> list[Tool]:
    return [
        Tool(
            name="analyze_video",
            description=(
                "Analyze a video from Google Drive using an LLM. "
                "Downloads the video, processes it (chunking if needed), "
                "and returns the LLM's analysis."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "google_drive_url": {
                        "type": "string",
                        "description": "Google Drive sharing URL of the video",
                    },
                    "prompt": {
                        "type": "string",
                        "description": "What to analyze in the video",
                    },
                    "model": {
                        "type": "string",
                        "description": "Model to use (default: gemini-2.0-flash)",
                        "default": "gemini-2.0-flash",
                    },
                    "provider": {
                        "type": "string",
                        "description": "Provider: google, openai, anthropic (auto-detected if omitted)",
                        "enum": ["google", "openai", "anthropic"],
                    },
                    "api_key": {
                        "type": "string",
                        "description": "API key for the provider (uses stored key if omitted)",
                    },
                    "user_token": {
                        "type": "string",
                        "description": "User token for stored API key lookup",
                    },
                    "strategy": {
                        "type": "string",
                        "description": "How to handle long videos",
                        "enum": [
                            "sequential_summary",
                            "keyframe_summary",
                            "user_segments",
                            "fail_if_too_long",
                        ],
                        "default": "sequential_summary",
                    },
                    "segment_start": {
                        "type": "number",
                        "description": "Start time in seconds (for user_segments strategy)",
                    },
                    "segment_end": {
                        "type": "number",
                        "description": "End time in seconds (for user_segments strategy)",
                    },
                    "temperature": {
                        "type": "number",
                        "description": "Model temperature (0.0-2.0)",
                    },
                    "max_tokens": {
                        "type": "integer",
                        "description": "Max output tokens",
                    },
                },
                "required": ["google_drive_url", "prompt"],
            },
        ),
        Tool(
            name="store_api_key",
            description="Store an API key for future use. Keys are encrypted at rest.",
            inputSchema={
                "type": "object",
                "properties": {
                    "user_token": {
                        "type": "string",
                        "description": "Your user token",
                    },
                    "provider": {
                        "type": "string",
                        "description": "Provider: google, openai, anthropic",
                        "enum": ["google", "openai", "anthropic"],
                    },
                    "api_key": {
                        "type": "string",
                        "description": "The API key to store",
                    },
                },
                "required": ["user_token", "provider", "api_key"],
            },
        ),
        Tool(
            name="generate_user_token",
            description="Generate a new user token for API key storage.",
            inputSchema={"type": "object", "properties": {}},
        ),
        Tool(
            name="list_stored_keys",
            description="List which providers have stored API keys for a user token.",
            inputSchema={
                "type": "object",
                "properties": {
                    "user_token": {
                        "type": "string",
                        "description": "Your user token",
                    },
                },
                "required": ["user_token"],
            },
        ),
    ]


@mcp.list_tools()
async def list_tools() -> list[Tool]:
    return _build_tools()


@mcp.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    try:
        if name == "generate_user_token":
            import uuid
            token = str(uuid.uuid4())
            return [TextContent(
                type="text",
                text=json.dumps({"user_token": token, "message": "Save this token to reuse your API keys."}),
            )]

        if name == "store_api_key":
            from app.crypto import encrypt_api_key
            from app.database import get_db

            encrypted = encrypt_api_key(arguments["api_key"])
            db = await get_db()
            try:
                await db.execute(
                    """INSERT INTO api_keys (user_token, provider, encrypted_key)
                       VALUES (?, ?, ?)
                       ON CONFLICT(user_token, provider) DO UPDATE SET encrypted_key = ?""",
                    (arguments["user_token"], arguments["provider"].lower(), encrypted, encrypted),
                )
                await db.commit()
            finally:
                await db.close()
            return [TextContent(type="text", text=f"API key for {arguments['provider']} stored securely.")]

        if name == "list_stored_keys":
            from app.database import get_db
            db = await get_db()
            try:
                cursor = await db.execute(
                    "SELECT provider, created_at FROM api_keys WHERE user_token = ?",
                    (arguments["user_token"],),
                )
                rows = await cursor.fetchall()
            finally:
                await db.close()
            providers = [{"provider": r[0], "stored_at": r[1]} for r in rows]
            return [TextContent(type="text", text=json.dumps({"providers": providers}))]

        if name == "analyze_video":
            from app.gdrive import download_from_gdrive
            from app.analyzer import analyze_video
            from app.llm_providers import detect_provider
            from app.models import LongVideoStrategy

            model = arguments.get("model", "gemini-2.0-flash")
            provider = arguments.get("provider") or detect_provider(model)

            api_key = arguments.get("api_key")
            if not api_key:
                user_token = arguments.get("user_token")
                if not user_token:
                    return [TextContent(type="text", text="Error: Provide either api_key or user_token.")]

                from app.database import get_db
                from app.crypto import decrypt_api_key
                db = await get_db()
                try:
                    cursor = await db.execute(
                        "SELECT encrypted_key FROM api_keys WHERE user_token = ? AND provider = ?",
                        (user_token, provider.lower()),
                    )
                    row = await cursor.fetchone()
                finally:
                    await db.close()

                if not row:
                    return [TextContent(
                        type="text",
                        text=f"Error: No stored key for provider '{provider}'. Use store_api_key first.",
                    )]
                api_key = decrypt_api_key(row[0])

            await _send_progress("Starting video download from Google Drive...")
            video_path = await download_from_gdrive(
                arguments["google_drive_url"],
                progress_callback=_send_progress,
            )
            await _send_progress(f"Download complete. Analyzing video with {model}...")

            strategy_str = arguments.get("strategy", "sequential_summary")
            strategy = LongVideoStrategy(strategy_str)

            result = await asyncio.wait_for(
                analyze_video(
                    video_path=video_path,
                    prompt=arguments["prompt"],
                    model=model,
                    api_key=api_key,
                    provider=provider,
                    strategy=strategy,
                    segment_start=arguments.get("segment_start"),
                    segment_end=arguments.get("segment_end"),
                    temperature=arguments.get("temperature"),
                    max_tokens=arguments.get("max_tokens"),
                    progress_callback=_send_progress,
                ),
                timeout=ANALYZE_TIMEOUT_SECONDS,
            )

            await _send_progress("Analysis complete.")
            return [TextContent(type="text", text=json.dumps(result, default=str))]

        return [TextContent(type="text", text=f"Unknown tool: {name}")]

    except asyncio.TimeoutError:
        logger.error("MCP tool timed out: %s (limit: %ds)", name, ANALYZE_TIMEOUT_SECONDS)
        return [TextContent(
            type="text",
            text=f"Error: Operation timed out after {ANALYZE_TIMEOUT_SECONDS}s. "
                 f"Try a shorter video, a segment (segment_start/segment_end), "
                 f"or the keyframe_summary strategy.",
        )]
    except asyncio.CancelledError:
        logger.warning("MCP tool cancelled: %s", name)
        return [TextContent(type="text", text="Error: Operation was cancelled.")]
    except Exception as e:
        logger.exception(f"MCP tool error: {name}")
        return [TextContent(type="text", text=f"Error: {str(e)}")]
