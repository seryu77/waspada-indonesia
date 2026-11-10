"""Tes model YOLO di pipeline vision tanpa menjalankan server.

Pakai (dari folder backend):
  .venv/bin/python scripts/test_vision.py foto1.jpg foto2.png     # gambar sendiri
  .venv/bin/python scripts/test_vision.py --video rekaman.mp4      # ambil beberapa frame dari video
  .venv/bin/python scripts/test_vision.py --list-cameras           # daftar CCTV yang bisa dibaca
  .venv/bin/python scripts/test_vision.py --camera <id kamera>     # satu frame dari CCTV publik

Hasil: ringkasan bahaya yang terdeteksi per gambar (sama dengan logika server), waktu proses
per model, dan gambar berkotak deteksi di folder vision_test_out/.
"""

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.models import Camera  # noqa: E402
from app.sources.demo_seed import load_cameras  # noqa: E402

OUT = Path("vision_test_out")


def usable(cams: list[Camera]) -> list[Camera]:
    return [c for c in cams if c.stream_type != "youtube" and (c.vision_url or c.stream_type in ("hls", "rtsp", "snapshot"))]


def video_frames(path: str, n: int = 5):
    import cv2

    cap = cv2.VideoCapture(path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or n
    for i in range(n):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(total * (i + 0.5) / n))
        ok, frame = cap.read()
        if ok:
            yield f"{Path(path).stem}-f{i + 1}", frame
    cap.release()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("images", nargs="*", help="file gambar")
    ap.add_argument("--video", help="file video, diambil 5 frame merata")
    ap.add_argument("--camera", action="append", default=[], help="id kamera dari cameras.json (boleh berulang)")
    ap.add_argument("--list-cameras", action="store_true")
    args = ap.parse_args()

    cams = {c.id: c for c in load_cameras()}
    if args.list_cameras:
        for c in usable(list(cams.values())):
            print(f"{c.id:40} {c.city:20} {c.name}")
        return
    if not (args.images or args.video or args.camera):
        ap.print_help()
        return

    import cv2
    import torch

    from app.vision.pipeline import VisionPipeline

    device = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"
    print(f"Perangkat: {device}")
    t0 = time.perf_counter()
    vp = VisionPipeline()
    print(f"Model dimuat dalam {time.perf_counter() - t0:.1f} dtk")
    print(f"  YOLO umum   : {settings.general_weights}")
    print(f"  YOLO-World  : {settings.world_weights if vp.world else 'NONAKTIF'}")
    print(f"  Fire/smoke  : {settings.fire_weights if vp.custom else 'tidak ada file, dilewati'}")

    frames: list[tuple[str, object]] = []
    for p in args.images:
        img = cv2.imread(p)
        if img is None:
            print(f"! gagal membaca {p}")
        else:
            frames.append((Path(p).stem, img))
    if args.video:
        frames += list(video_frames(args.video))
    for cid in args.camera:
        cam = cams.get(cid)
        if not cam:
            print(f"! kamera {cid} tidak ada, lihat --list-cameras")
            continue
        print(f"Mengambil frame dari CCTV {cam.name} ({cam.city})...")
        frame = vp._grab(cam)
        if frame is None:
            print(f"! kamera {cid} tidak bisa dibaca (offline atau diblokir)")
        else:
            frames.append((cid, frame))

    OUT.mkdir(exist_ok=True)
    models = [("umum", vp.general, 0.5), ("world", vp.world, 0.3), ("fire", vp.custom, 0.5)]
    for name, frame in frames:
        print(f"\n== {name} ({frame.shape[1]}x{frame.shape[0]})")
        for label, model, conf in models:
            if model is None:
                continue
            t = time.perf_counter()
            r = model(frame, verbose=False, conf=conf)[0]
            ms = (time.perf_counter() - t) * 1000
            found = sorted({r.names[int(c)] for c in r.boxes.cls.tolist()})
            print(f"  {label:6} {ms:6.0f} ms  {', '.join(found) or '-'}")
            cv2.imwrite(str(OUT / f"{name}-{label}.jpg"), r.plot())
        res = vp._detect(frame)
        if res.hazards:
            for hz, c in sorted(res.hazards.items(), key=lambda kv: -kv[1]):
                print(f"  -> BAHAYA {hz}: confidence {c:.2f}")
        else:
            print("  -> tidak ada bahaya terdeteksi")
    print(f"\nGambar hasil deteksi tersimpan di {OUT.resolve()}")
    print("Catatan: di server, satu deteksi baru jadi kejadian kalau muncul di 3 frame berturut-turut.")


if __name__ == "__main__":
    main()
