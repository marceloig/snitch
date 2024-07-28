from typing import Union
from fastapi import Depends, FastAPI, HTTPException
from fastapi import FastAPI
from sqlalchemy.orm import Session
from . import crud, schemas, services
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
    trails = crud.get_all_trails(db, 'aws-controltower/CloudTrailLogs')
    return trails

@app.get("/trails/users", response_model=list[schemas.TrailEvent])
def read_trails_users( q: Union[str, None] = None, db: Session = Depends(get_db)):
    trails = crud.get_all_trails_users(db, 'aws-controltower/CloudTrailLogs')
    trails_users = services.filter_trails_users(trails)
    
    return services.build_trails_users(trails_users)