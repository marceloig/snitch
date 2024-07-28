from typing import Union
from fastapi import Depends, FastAPI, HTTPException
from fastapi import FastAPI
from sqlalchemy.orm import Session

from .trail_event import routers as trails
from .database import SessionLocal, engine


# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

app = FastAPI()

app.include_router(trails.router)

@app.get("/")
def read_root():
    return {"Hello": "World"}