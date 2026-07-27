from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file="../.env", extra="ignore")

    # Local SQLite by default — zero setup needed to run the prototype.
    # See docs/DECISIONS.md for the plan to swap this to Postgres later.
    database_url: str = "sqlite:///./openloops.db"

    # Empty default so the app still starts without one — the failure
    # surfaces at the actual LLM call (a system boundary), not at import.
    groq_api_key: str = ""

    # Comma-separated list of browser origins allowed to call this API.
    # Defaults to the local Vite dev servers; production sets
    # ALLOWED_ORIGINS to the deployed frontend origin(s). See
    # docs/DECISIONS.md ("Deployment"). No credentials/cookies are used
    # (single demo user), so this is purely a browser-CORS allowlist.
    allowed_origins: str = "http://localhost:5173,http://localhost:4173"

    @property
    def allowed_origins_list(self) -> list:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


settings = Settings()
