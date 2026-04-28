import sys
import os

# Modules in backend/src use flat imports (e.g. `from reddit_story_maker import ...`),
# so that directory must be on sys.path before we import api_server.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend", "src"))

import uvicorn
from api_server import app

if __name__ == "__main__":
    # Bind to the loopback address so the console prints
    # http://127.0.0.1:8000 instead of http://0.0.0.0:8000 (which is
    # technically a bind-to-all but reads as a broken URL on Windows).
    # If you need LAN access from another device, change host to
    # "0.0.0.0" — same surface, just hits all interfaces.
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
