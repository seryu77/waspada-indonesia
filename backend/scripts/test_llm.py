"""Tes LLM verifier (Gemini atau Claude) tanpa menjalankan server.

Pakai (dari folder backend, key diisi di .env):
  .venv/bin/python scripts/test_llm.py                          # kasus contoh tanpa gambar
  .venv/bin/python scripts/test_llm.py --type fire foto.jpg     # dengan frame bukti
  .venv/bin/python scripts/test_llm.py --type flood --text "Air setinggi lutut di Jl. Ahmad Yani" --lat -7.29 --lng 112.73

Menjalankan alur yang sama dengan server: tahap 1 (triage), lalu tahap 2 (verify) kalau
severity tinggi. Tanpa key, hasilnya dari heuristik (simulasi).
"""

import argparse
import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.llm.context import build_context  # noqa: E402
from app.llm.verifier import verify_incident  # noqa: E402
from app.models import Incident, Source  # noqa: E402

SOURCES = {
    "cctv": Source(id="cctv", label="CCTV uji + YOLO", kind="cctv"),
    "citizen": Source(id="citizen", label="Laporan warga (uji)", kind="citizen"),
}


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("images", nargs="*", help="frame bukti (JPEG/PNG), maks 4")
    ap.add_argument("--type", default="fire", choices=["fire", "flood", "crime", "earthquake", "landslide", "accident", "volcano"])
    ap.add_argument("--text", default="Api dan asap tebal terlihat di lahan gambut dekat jalan.")
    ap.add_argument("--source", default="cctv", choices=list(SOURCES))
    ap.add_argument("--severity", default="high", choices=["low", "medium", "high", "critical"])
    ap.add_argument("--lat", type=float, default=-2.62)
    ap.add_argument("--lng", type=float, default=114.12)
    args = ap.parse_args()

    frames: list[bytes] = []
    if args.images:
        import cv2

        for p in args.images[:4]:
            img = cv2.imread(p)
            if img is None:
                print(f"! gagal membaca {p}")
                continue
            ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
            if ok:
                frames.append(buf.tobytes())

    print(f"Verifier : {settings.verifier_label}")
    if settings.llm_enabled:
        print(f"Tahap 1  : {settings.active_triage_model}")
        print(f"Tahap 2  : {settings.active_verify_model}")
    print(f"Frame    : {len(frames)}")

    inc = Incident(
        id="uji-1",
        type=args.type,
        title="Kandidat uji",
        description=args.text,
        lat=args.lat,
        lng=args.lng,
        address=f"{args.lat}, {args.lng}",
        severity=args.severity,
        source=SOURCES[args.source],
    )
    t = time.perf_counter()
    context = await build_context(inc, [])
    print(f"Konteks (cuaca, udara, dll) dirakit dalam {time.perf_counter() - t:.1f} dtk\n")

    t = time.perf_counter()
    v = await verify_incident(inc, frames, context)
    print(f"Selesai dalam {time.perf_counter() - t:.1f} dtk")
    print(f"  tahap         : {v.stage}")
    print(f"  model         : {v.model}")
    print(f"  verdict       : {v.verdict}")
    print(f"  confidence    : {v.confidence:.2f}")
    print(f"  severity      : {v.severity}")
    print(f"  instansi      : {v.recommended_agency}")
    print(f"  cek manual    : {'ya' if v.needs_manual_review else 'tidak'}")
    print(f"  simulasi      : {'ya (tanpa LLM)' if v.simulated else 'tidak'}")
    print(f"  alasan        : {v.reasoning}")


if __name__ == "__main__":
    asyncio.run(main())
