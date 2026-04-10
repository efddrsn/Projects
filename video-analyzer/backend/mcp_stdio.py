#!/usr/bin/env python3
"""
Run the Video Analyzer MCP server in stdio mode.
This is the entry point for MCP clients (Claude Desktop, Cursor, etc.)
that communicate over stdin/stdout.
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from app.database import init_db


async def main():
    await init_db()

    from mcp.server.stdio import stdio_server
    from app.mcp_server import mcp

    async with stdio_server() as (read_stream, write_stream):
        await mcp.run(read_stream, write_stream, mcp.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
