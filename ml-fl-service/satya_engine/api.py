import base64
import os
import uuid

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse

from .business_matching import evaluation
from . import model_card
from .auth import internal
from .compat_v1 import router as legacy_router
from .anomaly import score as anomaly_score
from .linking.service import LinkSuggestRequest, suggest as suggest_links
from .match.supplier_fs import SupplierDuplicatesRequest, duplicates as supplier_dupes
from .contracts_v2 import AllocateBatchRequest, AllocatePaymentRequest, AnomalyScoreRequest, ComplianceDeadlinesRequest, DocsParseRequest, DocsValidateRequest, GstinValidateRequest, MatchCandidatesRequest, ReconcileCaseRequest, TaxComputeRequest, schemas
from .match.candidates import candidates as match_candidates
from .deadlines import deadlines
from .docs import DocParseError, parse, validate
from .recon.allocate import AllocationInputError, allocate, allocate_batch
from .recon.case import reconcile_case
from .india.gstin import validate_gstin
from .india.hsn_master import HsnMaster
from .india.tax import TaxInputError, compute_tax
from .status_page import status_page
from .version import ENGINE_VERSION

HSN_MASTER_PATH = os.environ.get("HSN_MASTER_PATH", "assets/hsn_master.json.gz")
_hsn_master = None


def hsn_master():
    global _hsn_master
    if _hsn_master is None:
        _hsn_master = HsnMaster.load(HSN_MASTER_PATH)
    return _hsn_master


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
            "service": "satya-engine" if os.environ.get("FEATURE_V2_RECON_V2") == "1" else "satya-reconciliation",
            "rulesReady": True,
            "modelReady": report.get("ready", False),
            "linkModels": {m["task"]: m["version"] for m in model_card.status()},
            "engineVersion": ENGINE_VERSION,
            "modelVersion": report.get("modelVersion"),
            "hsnMasterVersion": None,
        }

    app.include_router(legacy_router)
    from .extraction.router import router as extraction_router
    app.include_router(extraction_router)

    def require_v2():
        if os.environ.get("FEATURE_V2_RECON_V2") != "1":
            raise HTTPException(404, "V2 engine contracts are not enabled")

    @app.get("/v2/schema", dependencies=[Depends(require_v2), Depends(internal)])
    def schema():
        return {"engineVersion": ENGINE_VERSION, "schemas": schemas()}

    @app.post("/v2/validate/gstin", dependencies=[Depends(require_v2), Depends(internal)])
    def gstin(request: GstinValidateRequest):
        return validate_gstin(request.gstin)

    @app.post("/v2/tax/compute", dependencies=[Depends(require_v2), Depends(internal)])
    def tax(request: TaxComputeRequest):
        try:
            return compute_tax(request, master=hsn_master())
        except TaxInputError as error:
            return JSONResponse(status_code=422, content={
                "error": {"code": "VALIDATION_FAILED", "message": str(error),
                          "details": {"fields": error.fields}, "requestId": uuid.uuid4().hex}})

    @app.post("/v2/reconcile/case", dependencies=[Depends(require_v2), Depends(internal)])
    def reconcile(request: ReconcileCaseRequest):
        return reconcile_case(request)

    @app.post("/v2/allocate/payment", dependencies=[Depends(require_v2), Depends(internal)])
    def allocate_payment(request: AllocatePaymentRequest):
        try:
            return allocate(request)
        except AllocationInputError as error:
            return JSONResponse(status_code=422, content={
                "error": {"code": "VALIDATION_FAILED", "message": str(error),
                          "requestId": uuid.uuid4().hex}})

    @app.post("/v2/allocate/batch", dependencies=[Depends(require_v2), Depends(internal)])
    def allocate_many(request: AllocateBatchRequest):
        try:
            return allocate_batch(request)
        except AllocationInputError as error:
            return JSONResponse(status_code=422, content={
                "error": {"code": "VALIDATION_FAILED", "message": str(error),
                          "requestId": uuid.uuid4().hex}})

    @app.post("/v2/docs/parse", dependencies=[Depends(require_v2), Depends(internal)])
    def docs_parse(request: DocsParseRequest):
        try:
            return parse(base64.b64decode(request.fileBase64), request.mime)
        except Exception as error:
            status = 422 if isinstance(error, (DocParseError, ValueError)) else 500
            return JSONResponse(status_code=status, content={
                "error": {"code": "VALIDATION_FAILED" if status == 422 else "INTERNAL_ERROR",
                          "message": str(error), "requestId": uuid.uuid4().hex}})

    @app.post("/v2/docs/validate", dependencies=[Depends(require_v2), Depends(internal)])
    def docs_validate(request: DocsValidateRequest):
        return validate(request, master=hsn_master())

    @app.post("/v2/compliance/deadlines", dependencies=[Depends(require_v2), Depends(internal)])
    def compliance_deadlines(request: ComplianceDeadlinesRequest):
        return deadlines(request)

    @app.post("/v2/anomaly/score", dependencies=[Depends(require_v2), Depends(internal)])
    def anomaly(request: AnomalyScoreRequest):
        return anomaly_score(request)

    @app.post("/v2/match/candidates", dependencies=[Depends(require_v2), Depends(internal)])
    def match(request: MatchCandidatesRequest):
        return match_candidates(request, alpha=float(request.alpha))

    @app.get("/v2/models/status", dependencies=[Depends(require_v2), Depends(internal)])
    def models_status():
        return {"models": model_card.status(),
                "source": "committed artifacts under models/<task>/ (no runtime training)",
                "fallback": "heuristic-v2 for /v2/match/candidates when no runs/satya-models/<task>/ artifact"}

    @app.get("/v2/models/card", dependencies=[Depends(require_v2), Depends(internal)])
    def models_card():
        return model_card.build()

    @app.get("/v2/evaluation/report", dependencies=[Depends(require_v2), Depends(internal)])
    def evaluation_report(task: str = "link_invoice_po"):
        # Reads the committed evaluation artifact; it used to retrain an XGBoost
        # model on generated data on every request.
        legacy = {"invoice_po_line": "link_invoice_po", "grn_po_line": "link_grn_po",
                  "payment_invoice": "link_payment_invoice"}
        name = legacy.get(task, task)
        card = model_card.build()
        found = next((m for m in card["models"] if m["task"] == name), None)
        if found is None and name in ("allocation", "extraction", "anomaly", "supplierDedupe"):
            found = card.get(name)
        if found is None:
            return JSONResponse(status_code=404, content={"error": {
                "code": "NOT_FOUND", "message": f"No evaluation artifact for {task}", "requestId": uuid.uuid4().hex}})
        return {"task": name, "generatedAt": card["generatedAt"], "honesty": card["honesty"], "report": found}

    @app.post("/v2/link/suggest", dependencies=[Depends(require_v2), Depends(internal)])
    def link_suggest(request: LinkSuggestRequest):
        return suggest_links(request)

    @app.post("/v2/suppliers/duplicates", dependencies=[Depends(require_v2), Depends(internal)])
    def supplier_duplicates(request: SupplierDuplicatesRequest):
        return supplier_dupes([s.model_dump(exclude_none=True) for s in request.suppliers])

    @app.post("/v2/train", dependencies=[Depends(require_v2), Depends(internal)])
    def train_model(request: dict):
        if not (os.environ.get("ALLOW_ENGINE_TRAIN") == "1" or os.environ.get("ALLOW_TRAIN") == "1"):
            return JSONResponse(status_code=403, content={
                "error": {"code": "TRAINING_DISABLED",
                          "message": "Engine training is disabled (ALLOW_TRAIN/ALLOW_ENGINE_TRAIN != 1)",
                          "requestId": uuid.uuid4().hex}})
        from .match.pairs import train
        try:
            return train(task=request.get("task", "invoice_po_line"),
                         seed=int(request.get("seed", 42)),
                         n_pos=int(request.get("n_pos", 60)),
                         labelled_pairs=request.get("labelledPairs"))
        except ValueError as error:
            return JSONResponse(status_code=422, content={
                "error": {"code": "VALIDATION_FAILED", "message": str(error),
                          "requestId": uuid.uuid4().hex}})

    return app
