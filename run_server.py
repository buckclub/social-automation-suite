import sys
import os

# Modules in backend/src use flat imports (e.g. `from reddit_story_maker import ...`),
# so that directory must be on sys.path before we import api_server.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend", "src"))

import uvicorn
from api_server import app

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
