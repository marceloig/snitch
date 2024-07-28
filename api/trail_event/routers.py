from fastapi import APIRouter
from typing import Union
from fastapi import Depends
from sqlalchemy.orm import Session

from . import crud, schemas, services
from ..database import SessionLocal, engine

# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

router = APIRouter()

@router.get("/trails/", response_model=list[schemas.TrailEvent])
def get_all_trails(db: Session = Depends(get_db)):
    trail = services.TrailService(db)
    trails = trail.get_all_trails()
    return trails

@router.get("/trails/users", response_model=list[schemas.TrailEvent])
def get_all_trails_users(db: Session = Depends(get_db)):
    trail = services.TrailService(db)
    return trail.get_all_trails_users()

@router.get("/trails/user", response_model=list[schemas.TrailEvent])
def get_all_trails_user(session_username: str, db: Session = Depends(get_db)):
    trail = services.TrailService(db)
    return trail.get_all_trails_user(session_username)