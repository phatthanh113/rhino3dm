"""Runtime configuration.

Everything that changes between the local machine and the office server lives
here: the data folder, the default project and the converter command. The app
reads a .env file next to the repository root, so moving the data folder is a
one-line change.
"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

APP_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_DATA_DIR = Path(r"D:\rhino\data")


class Settings(BaseSettings):
    data_dir: Path = DEFAULT_DATA_DIR
    default_project: str = "TPRO"
    host: str = "0.0.0.0"
    port: int = 8000
    database_url: str | None = None
    converter_python: str | None = None
    converter_script: Path = APP_ROOT / "services" / "converter-3dm" / "convert.py"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    model_config = SettingsConfigDict(
        env_file=APP_ROOT / ".env",
        env_prefix="RHINO_",
        extra="ignore",
    )

    @property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite:///{(self.data_dir / 'app.db').as_posix()}"

    @property
    def projects_dir(self) -> Path:
        return self.data_dir / "projects"

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.projects_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
