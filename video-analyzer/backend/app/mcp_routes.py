from fastapi import APIRouter, Request, Response
from mcp.server.sse import SseServerTransport

from app.mcp_server import mcp

router = APIRouter()

# Keep the internal message endpoint on the same host/path namespace so
# external clients only need to know "/mcp" as their entrypoint.
_sse_transport = SseServerTransport("/mcp/messages/")


@router.get("/mcp")
@router.get("/mcp/")
async def mcp_sse(request: Request) -> Response:
    async with _sse_transport.connect_sse(
        request.scope, request.receive, request._send  # type: ignore[attr-defined]
    ) as (read_stream, write_stream):
        await mcp.run(
            read_stream,
            write_stream,
            mcp.create_initialization_options(),
        )
    return Response()


@router.post("/mcp/messages")
@router.post("/mcp/messages/")
async def mcp_messages(request: Request) -> Response:
    return await _sse_transport.handle_post_message(
        request.scope,
        request.receive,
        request._send,  # type: ignore[attr-defined]
    )
