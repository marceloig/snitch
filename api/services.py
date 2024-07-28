from . import models


def filter_trails_users(trails: list):
    return [trail for trail in trails if filter_trail_user(trail)]

def filter_trail_user(trail: models.AwsCloudtrailTrailEvent):
    #userIdentity.sessionContext.sessionIssuer.userName
    invoked_by = trail.user_identity.get('invokedBy', False)
    principal_id = trail.user_identity['principalId']
    session = trail.user_identity['sessionContext']
    issuer = session.get('sessionIssuer', {})
    user_name = issuer.get('userName', None)
    arn = issuer.get('arn', None)
    return user_name and not invoked_by and ('awslambda' not in principal_id) and ('aws-service-role' not in arn)

def build_trails_users(trails: list):
    return [trail for trail in trails if build_trail_user(trail)]

def build_trail_user(trail: models.AwsCloudtrailTrailEvent):
    principal_id = trail.user_identity['principalId']
    trail.session_user_name = principal_id.split(':')[1]

    return trail
