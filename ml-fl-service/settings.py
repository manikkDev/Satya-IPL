from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PORT: int = 8000
    RUNS_DIR: str = "runs"
    PARTITIONS_DIR: str = "data/partitions"
    PROCESSED_DIR: str = "data/processed"
    NEO4J_URI: str = "bolt://localhost:7687"
    NEO4J_USER: str = "neo4j"
    NEO4J_PASSWORD: str = "password"
    PROGRESS_WEBHOOK: str = "http://localhost:5002/api/fl/progress"
    NODE_INTERNAL_TOKEN: str = "change-me"
    ARTH_DATA_HASH_KEY: str = "arth-saathi-public-demo-v1"
    FLOWER_PYTHON: str = ""
    KAGGLE_USERNAME: Optional[str] = None
    KAGGLE_KEY: Optional[str] = None

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
