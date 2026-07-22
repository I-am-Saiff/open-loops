from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file="../.env", extra="ignore")

    # Local SQLite by default — zero setup needed to run the prototype.
    # See docs/DECISIONS.md for the plan to swap this to Postgres later.
    database_url: str = "sqlite:///./openloops.db"

    # Empty default so the app still starts without one — the failure
    # surfaces at the actual LLM call (a system boundary), not at import.
    groq_api_key: str = ""


settings = Settings()
