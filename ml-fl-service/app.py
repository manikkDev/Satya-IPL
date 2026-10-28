import hmac
import os

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import ValidationError

from business_contracts import ReconcileRequest
from business_demo import demo_bundle
from business_matching import evaluation
from business_imports import PreviewRequest, preview
from business_reconcile import reconcile
from status_page import status_page

app = FastAPI(title="Satya Reconciliation Engine", version="1.0.0")


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def root():
    return status_page(evaluation().get("ready", False))


def internal(x_internal_token: str = Header(default="")):
    secret = os.environ.get("NODE_INTERNAL_TOKEN", "")
    if not secret or secret in {"change-me", "replace-me"} or not hmac.compare_digest(x_internal_token, secret):
        raise HTTPException(401, "Invalid service authentication")


@app.get("/")
def root():
    return {
        "ok": True,
        "service": "satya-reconciliation",
        "health": "/health",
        "docs": "/docs",
        "note": "Reconciliation endpoints live under /internal/* and require service authentication",
    }


@app.get("/health")
def health():
    return {"ok": True, "service": "satya-reconciliation", "rulesReady": True, "modelReady": evaluation().get("ready", False)}


@app.get("/internal/demo", dependencies=[Depends(internal)])
def demo():
    return demo_bundle()


@app.get("/internal/evaluation", dependencies=[Depends(internal)])
def model_evaluation():
    return evaluation()


@app.post('/internal/import-preview', dependencies=[Depends(internal)])
def import_preview(request: PreviewRequest):
    return preview(request)


@app.post("/internal/reconcile", dependencies=[Depends(internal)])
def run(request: ReconcileRequest):
    try:
        return reconcile(request)
    except (ValueError, ValidationError) as error:
        raise HTTPException(422, str(error)) from error
