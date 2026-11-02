from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BASE_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")

    # Provider LLM untuk verifier: "gemini" (default) atau "anthropic"
    llm_provider: str = "gemini"

    gemini_api_key: str = ""
    gemini_triage_model: str = "gemini-flash-lite-latest"
    gemini_verify_model: str = "gemini-flash-latest"

    anthropic_api_key: str = ""
    triage_model: str = "claude-haiku-5-5"
    verify_model: str = "claude-opus-5-5"
    verify_effort: str = "low"

    nasa_firms_map_key: str = ""

    dispatch_mode: str = "simulate"
    dispatch_webhook_url: str = ""
    dispatch_countdown_s: int = 45
    dispatch_confidence_min: float = 0.87

    demo_mode: bool = True
    simulator_min_s: float = 20
    simulator_max_s: float = 30

    enable_bmkg: bool = True
    enable_petabencana: bool = True
    enable_magma: bool = True

    enable_vision: bool = False
    vision_sample_s: float = 5
    fire_weights: str = "weights/fire_smoke.pt"
    general_weights: str = "yolo11n.pt"

    public_base_url: str = "http://localhost:8000"
    db_path: Path = BASE_DIR / "waspada.db"
    seed_path: Path = ROOT_DIR / "shared" / "seed.json"
    cameras_path: Path = BASE_DIR / "cameras.json"
    frames_dir: Path = BASE_DIR / "app" / "vision" / "frames"

    @property
    def llm_enabled(self) -> bool:
        if self.llm_provider == "gemini":
            return bool(self.gemini_api_key)
        return bool(self.anthropic_api_key)

    @property
    def active_triage_model(self) -> str:
        return self.gemini_triage_model if self.llm_provider == "gemini" else self.triage_model

    @property
    def active_verify_model(self) -> str:
        return self.gemini_verify_model if self.llm_provider == "gemini" else self.verify_model

    @property
    def verifier_label(self) -> str:
        return self.llm_provider if self.llm_enabled else "heuristik (simulasi)"


settings = Settings()
