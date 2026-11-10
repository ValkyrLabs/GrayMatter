"""Run the pinned upstream Hindsight source-fact selection tests without a server."""

import hashlib
import importlib
import inspect
from pathlib import Path
import sys
import tempfile
import unittest


# vectorize-io/hindsight commit eb963cb5a929d92c081371df64c2d5c2fe3351af
BLOBS = {
    "hindsight_api/engine/source_facts.py": "6f1e14cca00248e738ed2831ac0d4ee558e881db",
    "tests/test_source_facts_selection.py": "d2ad5d61cb13ad7a12b0e3327fd66bdd91e341f4",
}


def main(source_root):
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        for name, expected in BLOBS.items():
            source = (source_root / name).read_bytes()
            prefix = f"blob {len(source)}\0".encode()
            if hashlib.sha1(prefix + source).hexdigest() != expected:
                raise ValueError(f"Input does not match the pinned Git blob: {name}")
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source)
        # Isolate the two files from the full API package and its pytest conftest.
        for folder in ("hindsight_api", "hindsight_api/engine", "tests"):
            (root / folder / "__init__.py").touch()
        sys.path.insert(0, str(root))
        upstream = importlib.import_module("tests.test_source_facts_selection")
        suite = unittest.TestSuite()
        for cls in (upstream.TestGlobalBudget, upstream.TestPerObservationBudget):
            for name, method in inspect.getmembers(cls(), predicate=inspect.ismethod):
                if name.startswith("test_"):
                    suite.addTest(unittest.FunctionTestCase(method, description=f"{cls.__name__}.{name}"))
        if suite.countTestCases() != 10:
            raise ValueError("Expected ten tests at this revision")
        return unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 -I check-hindsight-source-facts.py /path/to/hindsight-api-slim")
    raise SystemExit(0 if main(Path(sys.argv[1])) else 1)
