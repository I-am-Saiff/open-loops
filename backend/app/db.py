from typing import Optional

import asyncpg

from app.config import settings

pool: Optional[asyncpg.Pool] = None


async def connect() -> None:
    global pool
    pool = await asyncpg.create_pool(settings.database_url)


async def disconnect() -> None:
    if pool is not None:
        await pool.close()


def get_pool() -> asyncpg.Pool:
    assert pool is not None, "db pool not initialized"
    return pool
