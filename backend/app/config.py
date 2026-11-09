import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BASE_DIR.parent

# Di Vercel, folder kode read-only; hanya /tmp yang bisa ditulis (dan tidak permanen)
ON_VERCEL = bool(os.environ.get("VERCEL"))
DATA_DIR = Path("/tmp/waspada") if ON_VERCEL else BASE_DIR


def _seed_default() -> Path:
    # Lokal: ../shared/seed.json. Di Vercel: disalin ke backend/shared/ saat build
    for p in (ROOT_DIR / "shared" / "seed.json", BASE_DIR / "shared" / "seed.json"):
        if p.exists():
            return p
    return ROOT_DIR / "shared" / "seed.json"


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
    # Aturan otomasi. Bisa diubah operator saat runtime lewat PUT /api/automation
    auto_dispatch_enabled: bool = True
    false_alarm_hide_min: float = 0.7  # false alarm dengan kepastian setinggi ini langsung ditutup
    citizen_requires_review: bool = True  # laporan warga selalu divalidasi manusia
    official_quake_auto: bool = True  # gempa BMKG M6+ langsung hitung mundur tanpa LLM

    demo_mode: bool = True
    simulator_min_s: float = 20
    simulator_max_s: float = 30

    enable_bmkg: bool = True
    enable_petabencana: bool = True
    enable_magma: bool = True

    enable_vision: bool = False
    vision_sample_s: float = 20  # jeda minimal per kamera, supaya ringan untuk server pemda
    vision_concurrency: int = 3  # kamera yang diproses bersamaan
    vision_cities: str = ""  # kosong = semua kota; contoh "Banjarbaru,Ciamis"
    vision_max_cameras: int = 0  # 0 = tanpa batas
    fire_weights: str = "weights/fire_smoke.pt"
    general_weights: str = "yolo11n.pt"
    world_weights: str = "yolov8s-worldv2.pt"  # YOLO-World untuk api, asap, banjir; kosong = mati

    public_base_url: str = "http://localhost:8000"
    db_path: Path = DATA_DIR / "waspada.db"
    seed_path: Path = _seed_default()
    cameras_path: Path = BASE_DIR / "cameras.json"
    frames_dir: Path = (DATA_DIR / "frames") if ON_VERCEL else BASE_DIR / "app" / "vision" / "frames"

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

    def rules(self) -> dict:
        return {
            "auto_dispatch_enabled": self.auto_dispatch_enabled,
            "auto_dispatch_min": self.dispatch_confidence_min,
            "countdown_s": self.dispatch_countdown_s,
            "false_alarm_hide_min": self.false_alarm_hide_min,
            "citizen_requires_review": self.citizen_requires_review,
            "official_quake_auto": self.official_quake_auto,
        }

    @property
    def verifier_label(self) -> str:
        return self.llm_provider if self.llm_enabled else "heuristik (simulasi)"


settings = Settings()
