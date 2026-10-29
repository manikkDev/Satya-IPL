"""Frozen v1 routes: keep the deployed demo behavior during v2 rollout."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError

from .auth import internal
from .business_contracts import ReconcileRequest
from .business_demo import demo_bundle
from .business_imports import PreviewRequest, preview
from .business_matching import evaluation
from .business_reconcile import reconcile

router = APIRouter(prefix="/internal", dependencies=[Depends(internal)])


@router.get("/demo")
def demo():
    return demo_bundle()


@router.get("/evaluation")
def model_evaluation():
    return evaluation()


@router.post("/import-preview")
def import_preview(request: PreviewRequest):
    return preview(request)


@router.post("/reconcile")
def run(request: ReconcileRequest):
    try:
        return reconcile(request)
    except (ValueError, ValidationError) as error:
        raise HTTPException(422, str(error)) from error
