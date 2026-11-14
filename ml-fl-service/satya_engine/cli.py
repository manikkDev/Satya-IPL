"""Offline entry points; execute inside the bounded engine container only."""
import argparse
import json

from .data.hsn_build import build_hsn

GST_DIRECTORY_URL = "https://services.gst.gov.in/services/searchhsnsac"


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python -m satya_engine.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    hsn = commands.add_parser("build-hsn", help="Build an audited HSN master from local primary sources")
    source = hsn.add_mutually_exclusive_group(required=True)
    source.add_argument("--hsn-xlsx")
    source.add_argument("--hsn-csv")
    hsn.add_argument("--code-column", required=True)
    hsn.add_argument("--description-column", required=True)
    hsn.add_argument("--directory-url", default=GST_DIRECTORY_URL)
    hsn.add_argument("--retrieved-at", required=True, help="Actual source retrieval timestamp with offset")
    hsn.add_argument("--reviewed-rates", help="Reviewed total-GST extraction JSON with primary source hashes")
    hsn.add_argument("--output", required=True)
    repair = commands.add_parser("repair-hsn", help="Apply schedule-run repairs to an existing HSN master artifact")
    repair.add_argument("--input", required=True)
    repair.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    if args.command == "repair-hsn":
        import gzip
        from .india.hsn_master import HsnArtifact
        from .india.hsn_repair import repair_artifact
        with gzip.open(args.input, "rb") as stream:
            payload = json.loads(stream.read())
        repaired, log = repair_artifact(payload)
        artifact = HsnArtifact.model_validate(repaired).model_dump(exclude_none=True)
        with open(args.output, "xb") as out:
            out.write(gzip.compress(json.dumps(artifact, ensure_ascii=True, separators=(",", ":")).encode(), mtime=0))
        print(json.dumps({"version": artifact["version"], "changes": len(log), "output": args.output}))
        return
    result = build_hsn(
        args.hsn_xlsx or args.hsn_csv, args.output,
        code_column=args.code_column, description_column=args.description_column,
        directory_url=args.directory_url, rates_path=args.reviewed_rates,
        retrieved_at=args.retrieved_at,
    )
    print(json.dumps({
        "version": result["version"], "codes": len(result["codes"]),
        "rateRules": len(result["rateRules"]), "output": args.output,
        "warning": None if result["rateRules"] else "No verified rates supplied; rate lookup returns null",
    }))


if __name__ == "__main__":
    main()
