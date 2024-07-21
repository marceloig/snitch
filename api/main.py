from typing import Union
from fastapi import Depends, FastAPI, HTTPException
from fastapi import FastAPI
from sqlalchemy.orm import Session
from . import crud, models, schemas
from .database import SessionLocal, engine


# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

app = FastAPI()


@app.get("/")
def read_root():
    return {"Hello": "World"}


@app.get("/trails/", response_model=list[schemas.TrailEvent])
def read_trails( q: Union[str, None] = None, db: Session = Depends(get_db)):
    trails = crud.get_all_trails(db, 'aws-cloudtrail-logs-730335309881-d6580cc1')
    print(trails)
    return trails