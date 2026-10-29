import ast
from pathlib import Path


def test_runtime_has_no_legacy_or_heavy_framework_imports():
    forbidden = {
        "arth_fl", "vertical", "experiments", "explain", "graph", "jobs", "models",
        "settings", "torch", "tensorflow", "transformers", "flwr", "opacus",
    }
    package = Path(__file__).resolve().parents[1] / "satya_engine"
    for path in package.rglob("*.py"):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and not node.level:
                imports = [node.module or ""]
            else:
                continue
            assert not forbidden.intersection(name.split(".")[0] for name in imports), str(path)
