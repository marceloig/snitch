from pydantic import BaseModel
from typing import Union, List
from datetime import datetime

class TrailEvent(BaseModel):
    source_ip_address: str
    error_message: str | None = None
    event_time: datetime
    event_type: str
    event_source: str
    event_category: str
    user_agent: str
    user_type: str
    user_identifier: str | None = None
    user_identity: dict | None = None
    request_parameters: dict | None = None
    resources: list[dict] | None = None
    account_id: str
    aws_region: str

    session_username: str | None = None

    class Config:
        orm_mode = True
