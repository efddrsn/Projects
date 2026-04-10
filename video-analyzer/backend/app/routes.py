import uuid
import logging
import asyncio
from datetime import datetime

from fastapi import APIRouter, HTTPException, BackgroundTasks
from app.models import (
    AnalyzeRequest,
    AnalyzeResponse,
    StoreKeyRequest,
    JobStatus,
    UserTokenResponse,
)
from app.database import get_db
from app.crypto import encrypt_api_key, decrypt_api_key
from app.gdrive import download_from_gdrive
from app.analyzer import analyze_video
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

_jobs: dict[str, dict] = {}
_analysis_semaphore = asyncio.Semaphore(max(settings.max_concurrent_analyses, 1))


@router.post("/api/generate-token", response_model=UserTokenResponse)
async def generate_token():
    token = str(uuid.uuid4())
    return UserTokenResponse(user_token=token, message="Save this token to reuse your API keys in future sessions.")


@router.post("/api/store-key")
async def store_key(req: StoreKeyRequest):
    encrypted = encrypt_api_key(req.api_key)
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO api_keys (user_token, provider, encrypted_key)
               VALUES (?, ?, ?)
               ON CONFLICT(user_token, provider) DO UPDATE SET encrypted_key = ?""",
            (req.user_token, req.provider.lower(), encrypted, encrypted),
        )
        await db.commit()
    finally:
        await db.close()
    return {"status": "ok", "message": f"API key for {req.provider} stored securely."}


@router.delete("/api/delete-key/{user_token}/{provider}")
async def delete_key(user_token: str, provider: str):
    db = await get_db()
    try:
        await db.execute(
            "DELETE FROM api_keys WHERE user_token = ? AND provider = ?",
            (user_token, provider.lower()),
        )
        await db.commit()
    finally:
        await db.close()
    return {"status": "ok", "message": f"API key for {provider} deleted."}


@router.get("/api/keys/{user_token}")
async def list_keys(user_token: str):
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT provider, created_at FROM api_keys WHERE user_token = ?",
            (user_token,),
        )
        rows = await cursor.fetchall()
    finally:
        await db.close()
    return {"providers": [{"provider": r[0], "stored_at": r[1]} for r in rows]}


async def _get_api_key(user_token: str | None, provider: str, provided_key: str | None) -> str:
    if provided_key:
        return provided_key
    if not user_token:
        raise HTTPException(400, "No API key provided and no user_token for key lookup.")

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
        raise HTTPException(
            400,
            f"No stored API key for provider '{provider}'. "
            f"Provide api_key in the request or store one first via POST /api/store-key.",
        )
    return decrypt_api_key(row[0])


async def _run_analysis(job_id: str, req: AnalyzeRequest, api_key: str, provider: str):
    try:
        _jobs[job_id]["status"] = "queued"
        async with _analysis_semaphore:
            _jobs[job_id]["status"] = "downloading"
            video_path = await download_from_gdrive(req.google_drive_url)

            _jobs[job_id]["status"] = "analyzing"
            result = await analyze_video(
                video_path=video_path,
                prompt=req.prompt,
                model=req.model,
                api_key=api_key,
                provider=provider,
                strategy=req.strategy,
                segment_start=req.segment_start,
                segment_end=req.segment_end,
                max_chunk_duration=req.max_chunk_duration,
                temperature=req.temperature,
                max_tokens=req.max_tokens,
            )

        if result.get("error"):
            _jobs[job_id]["status"] = "failed"
            _jobs[job_id]["error"] = result["error"]
        else:
            _jobs[job_id]["status"] = "completed"
            _jobs[job_id]["result"] = result.get("result")

        _jobs[job_id]["chunks_processed"] = result.get("chunks_processed")
        _jobs[job_id]["total_chunks"] = result.get("total_chunks")
        _jobs[job_id]["strategy_used"] = result.get("strategy")

        db = await get_db()
        try:
            await db.execute(
                """UPDATE analysis_jobs SET status=?, result=?, error=?, completed_at=?
                   WHERE id=?""",
                (
                    _jobs[job_id]["status"],
                    result.get("result"),
                    result.get("error"),
                    datetime.utcnow().isoformat(),
                    job_id,
                ),
            )
            await db.commit()
        finally:
            await db.close()

    except Exception as e:
        logger.exception(f"Job {job_id} failed")
        _jobs[job_id]["status"] = "failed"
        _jobs[job_id]["error"] = str(e)

        db = await get_db()
        try:
            await db.execute(
                "UPDATE analysis_jobs SET status='failed', error=?, completed_at=? WHERE id=?",
                (str(e), datetime.utcnow().isoformat(), job_id),
            )
            await db.commit()
        finally:
            await db.close()


@router.post("/api/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest, background_tasks: BackgroundTasks):
    from app.llm_providers import detect_provider

    provider = req.provider or detect_provider(req.model)
    api_key = await _get_api_key(req.user_token, provider, req.api_key)

    if req.save_key and req.api_key and req.user_token:
        encrypted = encrypt_api_key(req.api_key)
        db = await get_db()
        try:
            await db.execute(
                """INSERT INTO api_keys (user_token, provider, encrypted_key)
                   VALUES (?, ?, ?)
                   ON CONFLICT(user_token, provider) DO UPDATE SET encrypted_key = ?""",
                (req.user_token, provider, encrypted, encrypted),
            )
            await db.commit()
        finally:
            await db.close()

    job_id = str(uuid.uuid4())

    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO analysis_jobs (id, user_token, status, google_drive_url, prompt, model, strategy)
               VALUES (?, ?, 'pending', ?, ?, ?, ?)""",
            (job_id, req.user_token, req.google_drive_url, req.prompt, req.model, req.strategy.value),
        )
        await db.commit()
    finally:
        await db.close()

    _jobs[job_id] = {
        "status": "pending",
        "result": None,
        "error": None,
        "model": req.model,
        "strategy": req.strategy.value,
        "chunks_processed": None,
        "total_chunks": None,
    }

    background_tasks.add_task(_run_analysis, job_id, req, api_key, provider)

    return AnalyzeResponse(
        job_id=job_id,
        status="pending",
        model=req.model,
        strategy=req.strategy.value,
    )


@router.post("/api/analyze/sync", response_model=AnalyzeResponse)
async def analyze_sync(req: AnalyzeRequest):
    """Synchronous version - waits for result. Useful for MCP and simple clients."""
    from app.llm_providers import detect_provider

    provider = req.provider or detect_provider(req.model)
    api_key = await _get_api_key(req.user_token, provider, req.api_key)

    if req.save_key and req.api_key and req.user_token:
        encrypted = encrypt_api_key(req.api_key)
        db = await get_db()
        try:
            await db.execute(
                """INSERT INTO api_keys (user_token, provider, encrypted_key)
                   VALUES (?, ?, ?)
                   ON CONFLICT(user_token, provider) DO UPDATE SET encrypted_key = ?""",
                (req.user_token, provider, encrypted, encrypted),
            )
            await db.commit()
        finally:
            await db.close()

    job_id = str(uuid.uuid4())

    try:
        video_path = await download_from_gdrive(req.google_drive_url)
        result = await analyze_video(
            video_path=video_path,
            prompt=req.prompt,
            model=req.model,
            api_key=api_key,
            provider=provider,
            strategy=req.strategy,
            segment_start=req.segment_start,
            segment_end=req.segment_end,
            max_chunk_duration=req.max_chunk_duration,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
        )

        return AnalyzeResponse(
            job_id=job_id,
            status="completed" if not result.get("error") else "failed",
            result=result.get("result"),
            error=result.get("error"),
            model=req.model,
            strategy=result.get("strategy", req.strategy.value),
            chunks_processed=result.get("chunks_processed"),
            total_chunks=result.get("total_chunks"),
        )

    except Exception as e:
        logger.exception("Sync analysis failed")
        raise HTTPException(500, str(e))


@router.get("/api/job/{job_id}", response_model=JobStatus)
async def get_job(job_id: str):
    if job_id in _jobs:
        job = _jobs[job_id]
        return JobStatus(
            job_id=job_id,
            status=job["status"],
            result=job.get("result"),
            error=job.get("error"),
        )

    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT status, result, error FROM analysis_jobs WHERE id = ?",
            (job_id,),
        )
        row = await cursor.fetchone()
    finally:
        await db.close()

    if not row:
        raise HTTPException(404, "Job not found")

    return JobStatus(job_id=job_id, status=row[0], result=row[1], error=row[2])


@router.get("/api/health")
async def health():
    return {"status": "ok", "service": "video-analyzer"}
