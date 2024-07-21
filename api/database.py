from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

import os

STEAMPIPE_DATABASE = os.environ.get('STEAMPIPE_DATABASE')
STEAMPIPE_USER = os.environ.get('STEAMPIPE_USER')
STEAMPIPE_PASSWORD = os.environ.get('STEAMPIPE_PASSWORD')
STEAMPIPE_HOST = os.environ.get('STEAMPIPE_HOST')
STEAMPIPE_PORT = os.environ.get('STEAMPIPE_PORT')

SQLALCHEMY_DATABASE_URL = f"postgresql://{STEAMPIPE_USER}:{STEAMPIPE_PASSWORD}@{STEAMPIPE_HOST}:{STEAMPIPE_PORT}/{STEAMPIPE_DATABASE}"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()