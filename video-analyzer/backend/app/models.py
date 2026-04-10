from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


class LongVideoStrategy(str, Enum):
    SEQUENTIAL_SUMMARY = "sequential_summary"
    KEYFRAME_SUMMARY = "keyframe_summary"
    USER_SEGMENTS = "user_segments"
    FAIL_IF_TOO_LONG = "fail_if_too_long"


class AnalyzeRequest(BaseModel):
    google_drive_url: str = Field(..., description="Google Drive sharing URL of the video")
    prompt: str = Field(..., description="What to analyze in the video")
    model: str = Field(
        default="gemini-2.0-flash",
        description="Model name: gemini-2.0-flash, gemini-2.5-pro, gpt-4o, claude-sonnet-4-20250514, etc.",
    )
    provider: Optional[str] = Field(
        default=None,
        description="Provider override: google, openai, anthropic. Auto-detected from model name if omitted.",
    )
    api_key: Optional[str] = Field(
        default=None,
        description="API key for the chosen provider. If omitted, uses stored key for this user_token.",
    )
    user_token: Optional[str] = Field(
        default=None,
        description="Persistent user token for API key storage. Generated on first use if omitted.",
    )
    save_key: bool = Field(
        default=False,
        description="If true, save the provided api_key for future use under this user_token.",
    )
    strategy: LongVideoStrategy = Field(
        default=LongVideoStrategy.SEQUENTIAL_SUMMARY,
        description=(
            "How to handle videos exceeding the model's context window. "
            "'sequential_summary': analyze chunks sequentially, accumulate summaries, then final synthesis. "
            "'keyframe_summary': extract keyframes + audio transcript, send as images + text. "
            "'user_segments': only analyze user-specified time segments. "
            "'fail_if_too_long': return error if video exceeds single-call limit."
        ),
    )
    segment_start: Optional[float] = Field(default=None, description="Start time in seconds (for user_segments)")
    segment_end: Optional[float] = Field(default=None, description="End time in seconds (for user_segments)")
    max_chunk_duration: Optional[int] = Field(
        default=None, description="Override default chunk duration in seconds"
    )
    temperature: Optional[float] = Field(default=None, description="Model temperature (0.0-2.0)")
    max_tokens: Optional[int] = Field(default=None, description="Max output tokens")


class StoreKeyRequest(BaseModel):
    user_token: str
    provider: str = Field(..., description="Provider: google, openai, anthropic")
    api_key: str


class AnalyzeResponse(BaseModel):
    job_id: str
    status: str
    result: Optional[str] = None
    error: Optional[str] = None
    model: str
    strategy: str
    chunks_processed: Optional[int] = None
    total_chunks: Optional[int] = None


class JobStatus(BaseModel):
    job_id: str
    status: str
    result: Optional[str] = None
    error: Optional[str] = None


class UserTokenResponse(BaseModel):
    user_token: str
    message: str
