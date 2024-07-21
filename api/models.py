from sqlalchemy.schema import FetchedValue
from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, JSON, DateTime

from .database import Base


class AwsCloudtrailTrailEvent(Base):
    __tablename__ = "aws_cloudtrail_trail_event"
    
    timestamp = Column(DateTime, primary_key=True)
    log_group_name = Column(String)
    source_ip_address = Column(String)
    error_message = Column(String)
    error_code = Column(String)
    event_time = Column(DateTime)
    event_type = Column(String)
    event_source = Column(String)
    event_category = Column(String)
    user_agent = Column(String)
    user_type = Column(String)
    username = Column(String)
    user_identifier = Column(String)
    request_parameters = Column(JSON)
    resources = Column(JSON)
    account_id = Column(String)
    aws_region = Column(String)