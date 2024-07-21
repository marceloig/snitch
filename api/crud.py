from sqlalchemy.orm import Session
from . import models, schemas


def get_all_trails(db: Session, log_group_name: str, skip: int = 0, limit: int = 100):
    return db.query(models.AwsCloudtrailTrailEvent).filter(models.AwsCloudtrailTrailEvent.log_group_name == log_group_name).offset(skip).limit(limit).all()