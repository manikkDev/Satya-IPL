from fastapi import FastAPI
from fastapi.responses import HTMLResponse

from .business_matching import evaluation
from .compat_v1 import router as legacy_router
from .status_page import status_page
from .version import ENGINE_VERSION


def create_app():
    app = FastAPI(title="Satya Reconciliation Engine", version=ENGINE_VERSION)

    @app.get("/", response_class=HTMLResponse, include_in_schema=False)
    def root():
        return status_page(evaluation().get("ready", False))

    @app.get("/health")
    @app.get("/ready")
    def health():
        report = evaluation()
        return {
            "ok": True,
            "service": "satya-reconciliation",
            "rulesReady": True,
            "modelReady": report.get("ready", False),
            "engineVersion": ENGINE_VERSION,
            "modelVersion": report.get("modelVersion"),
            "hsnMasterVersion": None,
        }

    app.include_router(legacy_router)
    return app
