from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import Base, engine
from routers import auth, diary, friends, guestbook, minihompi, photos, users

Base.metadata.create_all(bind=engine)

app = FastAPI(title="MiniHompi Platform API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3002"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(minihompi.router)
app.include_router(diary.router)
app.include_router(photos.router)
app.include_router(guestbook.router)
app.include_router(friends.router)


@app.get("/")
def root():
    return {"message": "MiniHompi Platform API"}
