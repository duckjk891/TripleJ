"""
MongoDB async connection using motor.
"""

from typing import Optional
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

client: Optional[AsyncIOMotorClient] = None
db: Optional[AsyncIOMotorDatabase] = None


async def init_mongodb(uri: str, db_name: str) -> None:
    """Initialize the motor client and database reference."""
    global client, db
    client = AsyncIOMotorClient(uri)
    db = client[db_name]


def get_mongo() -> AsyncIOMotorDatabase:
    """FastAPI dependency: returns the MongoDB database instance."""
    return db


async def close_mongodb() -> None:
    """Close the motor client on shutdown."""
    global client, db
    if client:
        client.close()
        client = None
        db = None
