import os
import sys

# Ensure repo root is on sys.path so `import backend...` works in Vercel's runtime.
REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from backend.app.main import app  # noqa: E402

__all__ = ["app"]

