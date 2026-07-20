from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import engine
from app.models import Base
from app.routes.notes import router as notes_router

# SQLite prototype: create the schema on startup instead of a manual
# migration step — zero setup needed to run this. See docs/DECISIONS.md.
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Open Loops API")

# Single demo user, no auth, local-only prototype — wide open CORS is fine
# here. Tighten this if the app ever leaves localhost. See docs/DECISIONS.md.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(notes_router)
