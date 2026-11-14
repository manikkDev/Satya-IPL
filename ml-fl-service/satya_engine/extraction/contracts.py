"""Request models for the extraction endpoints (pydantic v2, extra='forbid').

The parse result and the gateway's LLM output are passed through mostly as
received; nested values the engine re-derives (text fields, QR signature) are
never trusted from the request — fuse re-parses the text and re-verifies the
raw QR token itself.
"""
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class QrInput(Contract):
    found: bool | None = None
    kind: str | None = None
    verified: bool | None = None
    signature: str | None = None
    keySource: str | None = None
    keyId: str | None = None
    reason: str | None = None
    wellFormed: bool | None = None
    problems: list[str] | None = None
    fields: dict[str, str] | None = None
    mapped: dict[str, Any] | None = None
    raw: str | None = Field(default=None, max_length=8192)
    page: int | None = None


class ParsedInput(Contract):
    """Subset of a /v2/docs/parse response (pageImages are not needed)."""
    text: str | None = Field(default=None, max_length=400000)
    layoutText: str | None = Field(default=None, max_length=400000)
    detectedType: str | None = None
    method: str | None = None
    pages: int | None = None
    qr: QrInput | None = None
    extracted: dict[str, Any] | None = None


class LlmInput(Contract):
    """Gateway /internal/llm/extract response."""
    extracted: dict[str, Any] | None = None
    quotes: dict[str, Any] | None = None
    fieldConfidence: dict[str, Any] | None = None
    model: str | None = None
    usage: dict[str, Any] | None = None


class DocsFuseRequest(Contract):
    parsed: ParsedInput | None = None
    llm: LlmInput | None = None
    qrFields: dict[str, str] | None = None


class QrDecodeRequest(Contract):
    token: str = Field(max_length=8192)
