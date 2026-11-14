"""Extraction endpoints (mounted by api.py via app.include_router).

POST /v2/docs/fuse       {parsed?, llm?, qrFields?} -> fused draft fields
POST /v2/docs/qr/decode  {token}                    -> decoded IRP QR (verified only by signature)

Same gates as the rest of /v2: 404 unless FEATURE_V2_RECON_V2 == "1", and
the internal service token.
"""
import os

from fastapi import APIRouter, Depends, HTTPException

from ..auth import internal
from .contracts import DocsFuseRequest, QrDecodeRequest
from .fuse import fuse
from .qr import decode_token


def require_v2():
    if os.environ.get("FEATURE_V2_RECON_V2") != "1":
        raise HTTPException(404, "V2 engine contracts are not enabled")


router = APIRouter(dependencies=[Depends(require_v2), Depends(internal)])


@router.post("/v2/docs/fuse")
def docs_fuse(request: DocsFuseRequest):
    parsed = request.parsed.model_dump(exclude_none=True) if request.parsed else {}
    llm = request.llm.model_dump(exclude_none=True) if request.llm else None
    return fuse(parsed, llm, request.qrFields)


@router.post("/v2/docs/qr/decode")
def docs_qr_decode(request: QrDecodeRequest):
    return decode_token(request.token)
