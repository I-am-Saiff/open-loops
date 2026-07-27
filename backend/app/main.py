from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import engine
from app.models import Base
from app.routes.notes import router as notes_router
from app.routes.threads import router as threads_router

# Create the schema on startup instead of a manual migration step — zero
# setup to run locally, and on first Postgres boot it creates the tables
# and enum types too. See docs/DECISIONS.md.
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Open Loops API")

# CORS allowlist is env-driven (ALLOWED_ORIGINS): local dev origins by
# default, the deployed frontend origin in production. No cookies/auth
# are used, so this is a plain browser-origin allowlist. See
# docs/DECISIONS.md ("Deployment").
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Lightweight health check for the platform + a friendly root so hitting
# the bare API URL isn't a 404.
@app.get("/")
def root() -> dict:
    return {"service": "Open Loops API", "status": "ok"}


app.include_router(notes_router)
app.include_router(threads_router)
