from sqlalchemy.schema import FetchedValue
from sqlalchemy import Boolean, Column, Integer, String, DateTime, BigInteger
from sqlalchemy.dialects.postgresql import JSON

from .database import Base


class AwsCloudtrailTrailEvent(Base):
    __tablename__ = "aws_cloudtrail_trail_event"
    
    timestamp_ms = Column(BigInteger, primary_key=True)
    timestamp = Column(DateTime)
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
    user_identity = Column(JSON)
    request_parameters = Column(JSON)
    resources = Column(JSON)
    account_id = Column(String)
    aws_region = Column(String)