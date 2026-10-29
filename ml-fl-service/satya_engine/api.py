import os

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import HTMLResponse

from .business_matching import evaluation
from .auth import internal
from .compat_v1 import router as legacy_router
from .contracts_v2 import schemas
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

    def require_v2():
        if os.environ.get("FEATURE_V2_RECON_V2") != "1":
            raise HTTPException(404, "V2 engine contracts are not enabled")

    @app.get("/v2/schema", dependencies=[Depends(require_v2), Depends(internal)])
    def schema():
        return {"engineVersion": ENGINE_VERSION, "schemas": schemas()}

    return app
