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

    # Verifier LLM: Qwen3-VL lewat API chat kompatibel OpenAI (Ollama lokal atau Hugging Face).
    # QWEN_BASE_URL kosong = verifier heuristik berlabel "simulasi"
    qwen_base_url: str = ""
    qwen_api_key: str = ""  # kosong untuk Ollama lokal, token HF untuk router.huggingface.co
    qwen_triage_model: str = "qwen3-vl:4b"
    qwen_verify_model: str = "qwen3-vl:4b"
    qwen_timeout_s: float = 120


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
    # Mode rekam video: simulator acak berhenti dan sumber live dibekukan (lihat app/demo.py).
    # Bisa dinyalakan saat runtime dari halaman /rekam.
    recording_mode: bool = False
    # Saat mode rekam: hanya jenis bahaya ini yang dikirim ke peta/dashboard, koma, kosong = semua.
    # Contoh "fire,earthquake,accident"
    demo_focus: str = ""

    @property
    def focus_types(self) -> set[str]:
        if not self.recording_mode:
            return set()
        return {t.strip() for t in self.demo_focus.split(",") if t.strip()}

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
        return bool(self.qwen_base_url)

    @property
    def active_triage_model(self) -> str:
        return self.qwen_triage_model

    @property
    def active_verify_model(self) -> str:
        return self.qwen_verify_model

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
        return "qwen3-vl" if self.llm_enabled else "heuristik (simulasi)"


settings = Settings()
