from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.db import connect, disconnect
from app.routes.notes import router as notes_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect()
    yield
    await disconnect()


app = FastAPI(title="Open Loops API", lifespan=lifespan)
app.include_router(notes_router)
