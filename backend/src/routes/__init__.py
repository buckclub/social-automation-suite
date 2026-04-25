"""
FastAPI routers — split out of api_server.py to keep that file
navigable. Each router is a self-contained group of related endpoints.
Wired into the main app via `app.include_router(...)` in api_server.

Routers DELIBERATELY use lazy imports inside endpoint bodies for any
shared state from api_server (PROJECT_ROOT, _load_config, etc) — at
module load the routers must NOT touch api_server, otherwise we get a
circular import (api_server → routes → api_server).
"""
