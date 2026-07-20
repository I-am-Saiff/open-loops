from fastapi import FastAPI

from app.db import engine
from app.models import Base
from app.routes.notes import router as notes_router

# SQLite prototype: create the schema on startup instead of a manual
# migration step — zero setup needed to run this. See docs/DECISIONS.md.
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Open Loops API")
app.include_router(notes_router)
