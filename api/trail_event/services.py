from . import models, crud
from sqlalchemy.orm import Session

class TrailService:

    db: Session

    def __init__(self, db):
        self.db = db
    
    def get_all_trails(self):
        return crud.get_all_trails(self.db, 'aws-controltower/CloudTrailLogs')
    
    def get_all_trails_users(self):
        trails = crud.get_all_trails_users(self.db, 'aws-controltower/CloudTrailLogs')
        trails_users = filter_trails_users(trails)

        return build_trails_users(trails_users)
    
    def get_all_trails_user(self, session_username):
        trails = crud.get_all_trails_users(self.db, 'aws-controltower/CloudTrailLogs')
        trails_users = filter_trails_users(trails)
    
        return build_trails_users(trails_users, session_username)

def filter_trails_users(trails: list):
    return [trail for trail in trails if filter_trail_user(trail)]

def filter_trail_user(trail: models.AwsCloudtrailTrailEvent):
    #userIdentity.sessionContext.sessionIssuer.userName
    invoked_by = trail.user_identity.get('invokedBy', False)
    principal_id = trail.user_identity['principalId']
    session = trail.user_identity.get('sessionContext', {}) or {}
    issuer = session.get('sessionIssuer', {}) or {}
    user_name = issuer.get('userName', None) or {}
    arn = issuer.get('arn', None)
    return user_name and not invoked_by and ('awslambda' not in principal_id) and ('aws-service-role' not in arn)

def filter_session_username(trail: models.AwsCloudtrailTrailEvent, session_username: str):
    if not session_username: return True

    return trail.session_username == session_username

def build_trails_users(trails: list, session_username: str = None):
    trails_users = [trail for trail in trails if build_trail_user(trail)]
    return [trail for trail in trails_users if filter_session_username(trail, session_username)]

def build_trail_user(trail: models.AwsCloudtrailTrailEvent):
    principal_id = trail.user_identity['principalId']
    trail.session_username = principal_id.split(':')[1]

    return trail
