import base64
import os
import uuid

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse

from .business_matching import evaluation
from .auth import internal
from .compat_v1 import router as legacy_router
from .anomaly import score as anomaly_score
from .evaluate import report as eval_report
from .contracts_v2 import AllocatePaymentRequest, AnomalyScoreRequest, ComplianceDeadlinesRequest, DocsParseRequest, DocsValidateRequest, GstinValidateRequest, MatchCandidatesRequest, ReconcileCaseRequest, TaxComputeRequest, schemas
from .match.candidates import candidates as match_candidates
from .deadlines import deadlines
from .docs import DocParseError, parse, validate
from .recon.allocate import AllocationInputError, allocate
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
        from .match.pairs import MODEL_DIR, load_model
        tasks = ["invoice_po_line", "grn_po_line", "invoice_invoice_dup",
                 "payment_invoice", "supplier_supplier", "item_item"]
        models = []
        for task in tasks:
            bundle = load_model(task)
            if bundle:
                *_, card = bundle
                models.append({"task": task, "version": card["version"],
                               "trainedAt": card["trainedAt"], "dataSources": card["dataSources"],
                               "metrics": card["metrics"], "limitations": card["limitations"]})
        return {"models": models,
                "fallback": "heuristic-v2 when no artifact in runs/satya-models/<task>/"}

    @app.get("/v2/evaluation/report", dependencies=[Depends(require_v2), Depends(internal)])
    def evaluation_report(task: str = "invoice_po_line"):
        return eval_report(task)

    @app.post("/v2/train", dependencies=[Depends(require_v2), Depends(internal)])
    def train_model(request: dict):
        if os.environ.get("ALLOW_ENGINE_TRAIN") != "1":
            return JSONResponse(status_code=403, content={
                "error": {"code": "TRAINING_DISABLED",
                          "message": "Engine training is disabled in this environment (ALLOW_ENGINE_TRAIN != 1)",
                          "requestId": uuid.uuid4().hex}})
        from .match.pairs import train
        try:
            return train(task=request.get("task", "invoice_po_line"),
                         seed=int(request.get("seed", 42)),
                         n_pos=int(request.get("n_pos", 60)))
        except ValueError as error:
            return JSONResponse(status_code=422, content={
                "error": {"code": "VALIDATION_FAILED", "message": str(error),
                          "requestId": uuid.uuid4().hex}})

    return app
