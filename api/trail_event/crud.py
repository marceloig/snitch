from sqlalchemy import func
from sqlalchemy.orm import Session
from sqlalchemy.sql.functions import concat
from sqlalchemy.dialects.postgresql import INTERVAL
from . import models


def get_all_trails(db: Session, log_group_name: str, interval: str = 'minutes', time: int = 60):
    return db.query(models.AwsCloudtrailTrailEvent).filter(models.AwsCloudtrailTrailEvent.log_group_name == log_group_name) \
    .filter(models.AwsCloudtrailTrailEvent.timestamp >= func.now() - func.cast(concat(time, ' ', interval), INTERVAL)) \
    .all()

def get_all_trails_users(db: Session, log_group_name: str, interval: str = 'minutes', time: int = 60):
    return db.query(models.AwsCloudtrailTrailEvent).filter(models.AwsCloudtrailTrailEvent.log_group_name == log_group_name) \
    .filter(models.AwsCloudtrailTrailEvent.timestamp >= func.now() - func.cast(concat(time, ' ', interval), INTERVAL)) \
    .filter((models.AwsCloudtrailTrailEvent.user_type == 'IAMUser') 
            | (models.AwsCloudtrailTrailEvent.user_type == 'AssumedRole')
            | (models.AwsCloudtrailTrailEvent.user_type == 'FederatedUser')
            | (models.AwsCloudtrailTrailEvent.user_type == 'IdentityCenterUser')) \
    .order_by(models.AwsCloudtrailTrailEvent.event_time.desc()) \
    .all()

def get_all_trails_root(db: Session, log_group_name: str, interval: str = 'minutes', time: int = 60):
    return db.query(models.AwsCloudtrailTrailEvent).filter(models.AwsCloudtrailTrailEvent.log_group_name == log_group_name) \
    .filter(models.AwsCloudtrailTrailEvent.timestamp >= func.now() - func.cast(concat(time, ' ', interval), INTERVAL)) \
    .filter(models.AwsCloudtrailTrailEvent.user_type == 'Root') \
    .all()