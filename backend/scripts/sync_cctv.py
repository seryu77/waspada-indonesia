"""Sinkronkan CCTV dari sumber resmi di cctv_sources.json ke cameras.json dan shared/seed.json.

Jalankan dari folder backend:
    .venv/bin/python scripts/sync_cctv.py

Jenis sumber, semuanya disiarkan instansi untuk publik (YouTube dan portal link bisa dimatikan
lewat enable_youtube / enable_portals, karena keduanya tidak bisa diproses computer vision):
- channels: channel YouTube resmi (pemda, dinas, BPBD, Badan Geologi). Diambil siaran yang sedang
  live dan boleh di-embed.
- restreamers: server datarhei Restreamer milik pemda yang menyediakan kode embed resmi (oEmbed).
  Daftar kamera bisa dibaca dari halaman portal resmi (page), termasuk koordinat kalau dicantumkan.
  Ditonton lewat player embed resmi, dibaca computer vision lewat HLS-nya (vision_url).
- hls_pages: portal CCTV resmi yang mencantumkan alamat HLS langsung di halamannya. Hanya kamera
  yang servernya mengizinkan diputar dari situs lain (CORS terbuka, tanpa token atau login) dan
  sedang menyala yang diambil. Portal yang mengunci streamnya tidak dipakai.
- toll_pages: daftar CCTV jalan tol resmi BPJT (semua operator tol). Diambil yang ada di dalam
  area (bbox) dan streamnya terbuka, menyala, dan cukup cepat.
- portals: portal CCTV resmi yang tidak bisa di-embed. Ditampilkan sebagai satu titik per daerah
  dengan tombol "Buka portal resmi".
Koordinat dicari lewat OpenStreetMap Nominatim (disimpan di geocode_cache.json). ID siaran YouTube
bisa berubah saat siaran dimulai ulang, jadi jalankan ulang script ini sebelum demo.
"""

from __future__ import annotations

import hashlib
from html import unescape as html_unescape
import json
import math
import re
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

BASE = Path(__file__).resolve().parent.parent
SOURCES = BASE / "cctv_sources.json"
CAMERAS = BASE / "cameras.json"
SEED = BASE.parent / "shared" / "seed.json"
GEO_CACHE = BASE / "geocode_cache.json"

UA = {"User-Agent": "Mozilla/5.0", "Accept-Language": "id"}
GEO_UA = {"User-Agent": "WaspadaNusantara/0.1 (hackathon; sinkronisasi lokasi CCTV)"}
MAX_GEO_KM = 40  # hasil geocode lebih jauh dari pusat wilayah dianggap salah

# Singkatan yang tetap huruf besar saat judul dirapikan
KEEP_UPPER = {"KM", "SPBU", "SD", "SMP", "SMA", "N", "DPRD", "RSPD", "JJLS", "BUQ", "TOL", "UNTAN", "YARSI", "PTZ", "II", "III", "IV", "V", "DR", "M", "A", "KH"}

STRIP = [
    r"\[?\s*LIVE\s*CCTV\s*\]?",
    r"Pantauan CCTV Samarinda\s*-",
    r"LIVE PEMANTAUAN( CCTV)?( LALULINTAS)?",
    r"CCTV JOGJA LIVE 24 JAM\s*-",
    r"CCTV LIVE",
    r"\bLIVE\b\s*[|:]?",
    r"by DISHUB KAB\.? DEMAK",
    r"DISHUB KOTA PONTIANAK",
    r"BPBD SLEMAN",
    r"Activity Live Streaming Badan Geologi",
    r"\b\d{2}/\d{2}/\d{4}\b",
    r"^\s*CCTV\b",
    r"\(.*?Boyolali.*?\)",
]


def clean_name(title: str) -> str:
    s = re.sub(r"[\U0001F000-\U0001FAFF☀-➿️]", "", title)
    for pat in STRIP:
        s = re.sub(pat, " ", s, flags=re.I)
    s = re.sub(r"\s+", " ", s).strip(" -|:[]")
    if sum(c.isupper() for c in s) > 0.6 * max(1, sum(c.isalpha() for c in s)):
        s = " ".join(w if w.strip(".,") in KEEP_UPPER else w.capitalize() for w in s.split())
    return s or title.strip()


def geo_variants(name: str) -> list[str]:
    """Variasi nama untuk geocoding: nama simpang di judul siaran jarang persis sama dengan OpenStreetMap."""
    core = re.sub(r"\b(Kamera|View|Arah)\b.*$", "", name, flags=re.I)
    core = re.sub(r"\[\d+\]|\b\d+$|\bWilayah\b|\bFix\b", "", core, flags=re.I).strip(" -")
    bare = re.sub(r"^(Simpang( \d| Tiga| Empat| Lima)?|Perempatan|Pertigaan|Bundaran|Bunderan|Traffic Light( Persimpangan)?|Persimpangan|Depan|Area|Tugu)\s+", "", core, flags=re.I)
    parts = [x.strip() for x in re.split(r"\s+-\s+|,", bare) if len(x.strip()) > 3]
    out = [name, core, bare, *parts]
    if not re.match(r"^(Jalan|Jl\.?)\b", bare, flags=re.I):
        out.append(f"Jalan {bare}")
        # "Simpang Urai Bawadi Suwignyo" = pertemuan dua jalan: coba dua kata pertama sebagai nama jalan
        words = bare.split()
        if len(words) >= 3:
            out.append(f"Jalan {' '.join(words[:2])}")
    return [v for v in dict.fromkeys(x.strip() for x in out) if len(v) > 3]


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60]


def km(a: dict, b: dict) -> float:
    r = math.pi / 180
    h = math.sin((b["lat"] - a["lat"]) * r / 2) ** 2 + math.cos(a["lat"] * r) * math.cos(b["lat"] * r) * math.sin((b["lng"] - a["lng"]) * r / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def jitter(center: dict, key: str) -> dict:
    """Sebar titik yang tidak ketemu koordinatnya di sekitar pusat wilayah (maks ~1,5 km), tetap sama tiap sinkron."""
    h = hashlib.sha1(key.encode()).digest()
    ang = h[0] / 255 * 2 * math.pi
    dist = 0.004 + h[1] / 255 * 0.01
    return {"lat": round(center["lat"] + dist * math.sin(ang), 6), "lng": round(center["lng"] + dist * math.cos(ang), 6)}


class Geocoder:
    def __init__(self, client: httpx.Client) -> None:
        self.client = client
        self.cache: dict = json.loads(GEO_CACHE.read_text()) if GEO_CACHE.exists() else {}
        self.last = 0.0

    def __call__(self, query: str) -> dict | None:
        if query in self.cache:
            return self.cache[query]
        time.sleep(max(0, 1.1 - (time.time() - self.last)))  # kebijakan Nominatim: maks 1 permintaan/detik
        self.last = time.time()
        try:
            r = self.client.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": query, "format": "json", "limit": 1, "countrycodes": "id"},
                headers=GEO_UA,
            )
            d = r.json()
            res = {"lat": float(d[0]["lat"]), "lng": float(d[0]["lon"])} if d else None
        except Exception:
            return None
        self.cache[query] = res
        return res

    def save(self) -> None:
        GEO_CACHE.write_text(json.dumps(self.cache, indent=1, ensure_ascii=False, sort_keys=True) + "\n")


def channel_videos(client: httpx.Client, handle: str) -> list[str]:
    ids: list[str] = []
    for tab in ("streams", "live"):
        try:
            html = client.get(f"https://www.youtube.com/{handle}/{tab}", headers=UA).text
        except httpx.HTTPError:
            continue
        ids += re.findall(r'"videoId":"([A-Za-z0-9_-]{11})"', html)
    return list(dict.fromkeys(ids))


def video_info(client: httpx.Client, vid: str) -> dict | None:
    try:
        html = client.get(f"https://www.youtube.com/watch?v={vid}", headers=UA).text
    except httpx.HTTPError:
        return None
    title = re.search(r"<title>(.*?) - YouTube</title>", html)
    owner = re.search(r'"ownerChannelName":"([^"]*)"', html)
    return {
        "id": vid,
        "live": '"isLiveNow":true' in html,
        "embed": '"playableInEmbed":true' in html,
        "title": json.loads(f'"{title.group(1)}"') if title else "",
        "owner": owner.group(1) if owner else "",
    }


GENERATED = {"youtube", "embed", "portal", "hls"}


def locate(geo: "Geocoder", src: dict, name: str, title: str, cid: str) -> tuple[dict, bool]:
    """Koordinat kamera: titik pasti dari config, lalu geocoding, lalu sekitar pusat wilayah (perkiraan)."""
    point = next((p for k, p in src.get("points", {}).items() if k.lower() in title.lower()), None)
    if point:
        return point, False
    area = src["region"].split(",")[0]
    for v in geo_variants(name):
        g = geo(f"{v}, {area}")
        if g and km(g, src["center"]) <= MAX_GEO_KM:
            return g, False
    return jitter(src["center"], cid), True


def camera(
    cid: str, name: str, src: dict, point: dict, approx: bool, url: str, kind: str, label: str, vision: str | None = None
) -> dict:
    return {
        "id": cid,
        "name": name,
        "city": src["city"],
        "lat": round(point["lat"], 6),
        "lng": round(point["lng"], 6),
        "status": "online",
        "detections_today": 0,
        "stream_url": url,
        "stream_type": kind,
        "source": label,
        **({"vision_url": vision} if vision else {}),
        **({"approx_location": True} if approx else {}),
    }


ORIGIN = "https://waspada.vercel.app"
MANIFEST = re.compile(r'<[^>]*?data-[a-z-]*(?:manifest|url|src)="(https?://[^"]+\.m3u8)"[^>]*>', re.S)
CARD_NAME = re.compile(r'data-name="([^"]+)"')
NEXT_NAME = re.compile(r'<(?:h[1-6]|div|span|p)[^>]*>\s*([^<>]{3,80}?)\s*</', re.S)


def check_streams(client: httpx.Client, urls: list[str]) -> list[bool]:
    """open_hls untuk banyak stream. Yang gagal diuji ulang dengan lebih sedikit unduhan sekaligus,
    karena uji paralel bisa berebut bandwidth dan membuat server cepat tampak lambat."""
    with ThreadPoolExecutor(8) as ex:
        ok = list(ex.map(lambda u: open_hls(client, u), urls))
    retry = [i for i, good in enumerate(ok) if not good]
    with ThreadPoolExecutor(3) as ex:
        for i, good in zip(retry, ex.map(lambda i: open_hls(client, urls[i]), retry)):
            ok[i] = good
    return ok


def open_hls(client: httpx.Client, url: str) -> bool:
    """Stream menyala, servernya mengizinkan diputar dari situs lain, dan cukup cepat ditonton.

    Cepat = satu segmen video terunduh dalam waktu kurang dari durasi putarnya. Server yang lebih
    lambat dari itu membuat player tertahan di "Menyambung ke kamera".
    """
    h = {"Origin": ORIGIN, **UA}
    try:
        r = client.get(url, headers=h, timeout=8)
        allow = r.headers.get("access-control-allow-origin", "")
        if r.status_code != 200 or allow not in ("*", ORIGIN) or "#EXTM3U" not in r.text[:200]:
            return False
        lines = [x.strip() for x in r.text.splitlines() if x.strip()]
        if any(x.startswith("#EXT-X-STREAM-INF") for x in lines):  # master playlist: ambil varian pertama
            sub = next(x for x in lines if not x.startswith("#"))
            return open_hls(client, str(httpx.URL(url).join(sub)))
        segs = [(float(lines[i].split(":")[1].split(",")[0]), lines[j])
                for i in range(len(lines)) if lines[i].startswith("#EXTINF")
                for j in [next((k for k in range(i + 1, len(lines)) if not lines[k].startswith("#")), None)] if j]
        if not segs:
            return False
        dur, seg = segs[-1]
        t = time.monotonic()
        s = client.get(str(httpx.URL(url).join(seg)), headers=h, timeout=max(dur * 2, 8))
        return s.status_code == 200 and time.monotonic() - t < dur * 0.9
    except (httpx.HTTPError, ValueError, StopIteration, IndexError):
        return False


def hls_page_cameras(client: httpx.Client, page: str) -> list[tuple[str, str, dict | None]]:
    """(nama, url, titik) dari kartu atau popup kamera di halaman portal, hanya yang terbuka dan menyala.

    Nama: data-name di tag kartu, judul <b> di popup peta tepat sebelumnya, atau teks judul pertama
    sesudah tag. Titik: koordinat marker peta tepat sebelum tag, kalau ada.
    """
    html = client.get(page, headers=UA).text
    found: dict[str, tuple[str, dict | None]] = {}
    for m in MANIFEST.finditer(html):
        url = m.group(1)
        if url in found:
            continue
        prev = html[max(0, m.start() - 700) : m.start()]
        prev = prev[prev.rfind(".m3u8") + 1 :]  # jangan sampai ke kamera sebelumnya
        tag = CARD_NAME.search(m.group(0))
        bold = re.findall(r"<b>\s*([^<>]{3,80}?)\s*</b>", prev)
        nxt = NEXT_NAME.search(html, m.end(), m.end() + 2500)
        name = tag.group(1) if tag else bold[-1] if bold else nxt.group(1) if nxt else ""
        ll = re.findall(r"\[\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{2,3}\.\d+)\s*\]", prev)
        point = {"lat": float(ll[-1][0]), "lng": float(ll[-1][1])} if ll else None
        if name.strip():
            found[url] = (html_unescape(name).strip(), point)
    items = [(n, u, pt) for u, (n, pt) in found.items()]
    ok = check_streams(client, [it[1] for it in items])
    return [it for it, good in zip(items, ok) if good]


def toll_page_cameras(client: httpx.Client, page: str, areas: list[dict]) -> list[tuple[dict, str, str, dict]]:
    """(area, nama, url, titik) kamera tol dari daftar resmi BPJT yang ada di dalam salah satu area.

    Halaman BPJT memuat daftar kamera semua operator tol (nama ruas, segmen, koordinat, alamat
    stream). Hanya stream HLS yang terbuka, menyala, dan cukup cepat yang diambil. Tol yang
    mengunci streamnya ke domain sendiri (misal Jasa Marga) otomatis gugur di open_hls.
    """
    html = client.get(page, headers=UA, timeout=30).text.replace("\\/", "/")
    picked = []
    for raw in re.findall(r'\{[^{}]*"nama_ruas"[^{}]*\}', html):
        try:
            r = json.loads(raw)
            point = {"lat": float(r["lat"]), "lng": float(r["lon"])}
        except (ValueError, KeyError):
            continue
        url = (r.get("stream") or "").strip()
        if r.get("protocol") != "m3u8" or not url.startswith("http"):
            continue
        for a in areas:
            s_, w, n, e = a["bbox"]
            if s_ <= point["lat"] <= n and w <= point["lng"] <= e:
                ruas = re.sub(r"^\d+\s+", "", r["nama_ruas"].strip())  # "6 Tol Dalam Kota" -> "Tol Dalam Kota"
                ruas = ruas if "tol" in ruas.lower() else f"Tol {ruas}"
                name = f"{ruas} {r.get('nama_segment', '').strip()}".strip()
                picked.append((a, html_unescape(name), url, point))
                break
    ok = check_streams(client, [it[2] for it in picked])
    return [it for it, good in zip(picked, ok) if good]


def restreamer_channels(client: httpx.Client, base: str, page: str | None = None) -> list[tuple[str, str, dict | None]]:
    """(id, judul, titik) channel yang sedang live di server datarhei Restreamer.

    Daftar channel diambil dari index.html server, atau dari halaman portal resmi pemda (page) yang
    menautkan player-nya. Kalau portal mencantumkan nama dan koordinat kamera, itu yang dipakai.
    """
    html = client.get(page or f"{base}/index.html", headers=UA).text.replace("\\/", "/")
    found: dict[str, tuple[str | None, dict | None]] = {}
    for cid in dict.fromkeys(re.findall(r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.html", html)):
        obj = re.search(r"\{[^{}]*" + cid + r"\.html[^{}]*\}", html)
        name = point = None
        if obj:
            o = obj.group(0)
            m = re.search(r"[\"']?(?:title|name)[\"']?\s*:\s*[\"']([^\"']+)", o)
            la = re.search(r"[\"']?(?:lat|latitude)[\"']?\s*:\s*[\"']?(-?\d+\.\d+)", o)
            lo = re.search(r"[\"']?(?:long|lng|longitude)[\"']?\s*:\s*[\"']?(-?\d+\.\d+)", o)
            name = html_unescape(m.group(1)).strip() if m else None
            if la and lo:
                point = {"lat": float(la.group(1)), "lng": float(lo.group(1))}
        found[cid] = (name, point)

    def check(cid: str) -> tuple[str, str, dict | None] | None:
        name, point = found[cid]
        try:
            if client.get(f"{base}/memfs/{cid}.m3u8").status_code != 200:
                return None  # tidak sedang live
            if not name:
                name = client.get(f"{base}/channels/{cid}/oembed.json").json()["title"]
        except (httpx.HTTPError, ValueError, KeyError):
            return None
        return cid, name, point

    with ThreadPoolExecutor(8) as ex:
        return [r for r in ex.map(check, found) if r]


def main() -> int:
    cfg = json.loads(SOURCES.read_text())
    excl = [e.lower() for e in cfg.get("exclude_title", [])]
    cams: list[dict] = []
    seen: set[str] = set()
    with httpx.Client(timeout=20, follow_redirects=True) as client:
        geo = Geocoder(client)
        # YouTube dan portal link bisa dimatikan: keduanya tidak bisa diproses computer vision
        for ch in cfg["channels"] if cfg.get("enable_youtube", True) else []:
            vids = channel_videos(client, ch["handle"])
            with ThreadPoolExecutor(8) as ex:
                infos = [i for i in ex.map(lambda v: video_info(client, v), vids) if i]
            live = [i for i in infos if i["live"] and i["embed"]]
            # Halaman channel juga memuat rekomendasi dari channel lain: ambil hanya milik pemilik terbanyak
            owner = Counter(i["owner"] for i in live).most_common(1)[0][0] if live else ""
            n = 0
            for i in live:
                t = i["title"]
                if i["owner"] != owner or any(e in t.lower() for e in excl):
                    continue
                if ch.get("only") and not any(o.lower() in t.lower() for o in ch["only"]):
                    continue
                name = clean_name(t)
                cid = f"yt-{slug(ch['handle'])}-{slug(name)}"
                if cid in seen:
                    continue
                seen.add(cid)
                point, approx = locate(geo, ch, name, t, cid)
                url = f"https://www.youtube.com/watch?v={i['id']}"
                cams.append(camera(cid, name, ch, point, approx, url, "youtube", f"{ch['source']} (YouTube resmi)"))
                n += 1
            print(f"{ch['handle']}: {n} kamera live", file=sys.stderr)

        for rs in cfg.get("restreamers", []):
            n = 0
            for rid, title, exact in restreamer_channels(client, rs["base"], rs.get("page")):
                name = title.replace('Alun"', "Alun-alun").strip()
                cid = f"rs-{slug(rs['city'])}-{slug(name)}"
                if cid in seen:
                    continue
                seen.add(cid)
                if exact and km(exact, rs["center"]) <= MAX_GEO_KM:
                    point, approx = exact, False
                else:
                    point, approx = locate(geo, rs, re.sub(r"\s+-\s+(Utara|Selatan|Timur|Barat|PTZ)$", "", name), title, cid)
                cams.append(camera(cid, name, rs, point, approx, f"{rs['base']}/{rid}.html", "embed", f"{rs['source']} (embed resmi)",
                                   f"{rs['base']}/memfs/{rid}.m3u8"))
                n += 1
            print(f"{rs['base']}: {n} kamera live", file=sys.stderr)

        for hp in cfg.get("hls_pages", []):
            n = 0
            for raw, url, exact in hls_page_cameras(client, hp["page"]):
                name = clean_name(raw)
                cid = f"hl-{slug(hp['city'])}-{slug(name)}"
                if cid in seen:
                    continue
                seen.add(cid)
                if exact and km(exact, hp["center"]) <= MAX_GEO_KM:
                    point, approx = exact, False
                else:
                    point, approx = locate(geo, hp, re.sub(r"\s+\d+$", "", name), raw, cid)
                cams.append(camera(cid, name, hp, point, approx, url, "hls", f"{hp['source']} (stream resmi)"))
                n += 1
            print(f"{hp['page']}: {n} kamera live", file=sys.stderr)

        for tp in cfg.get("toll_pages", []):
            counts: Counter = Counter()
            for area, name, url, point in toll_page_cameras(client, tp["page"], tp["areas"]):
                cid = f"tol-{slug(area['city'])}-{slug(name)}"
                if cid in seen:
                    continue
                seen.add(cid)
                cams.append(camera(cid, name, area, point, False, url, "hls", f"{tp['source']} (stream resmi)"))
                counts[area["city"]] += 1
            print(f"{tp['page']}: {dict(counts) or 0} kamera live", file=sys.stderr)

        for pt in cfg.get("portals", []) if cfg.get("enable_portals", True) else []:
            cid = f"portal-{slug(pt['city'])}"
            cams.append(camera(cid, f"Portal CCTV {pt['city']}", pt, pt["center"], False, pt["url"], "portal", pt["source"]))
        geo.save()

    if not cams:
        print("Tidak ada siaran live ditemukan, cameras.json tidak diubah.", file=sys.stderr)
        return 1

    def merge(lst: list[dict]) -> list[dict]:
        return [c for c in lst if c.get("stream_type") not in GENERATED] + cams

    d = json.loads(CAMERAS.read_text())
    d["cameras"] = merge(d["cameras"])
    CAMERAS.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")

    # seed.json: satu kamera per baris, hanya array "cameras" yang diganti
    s = SEED.read_text()
    start = s.index('"cameras": [')
    end = s.index("\n  ]", start)
    body = '"cameras": [\n' + ",\n".join("    " + json.dumps(c, ensure_ascii=False) for c in merge(json.loads(s)["cameras"]))
    s = s[:start] + body + s[end:]
    json.loads(s)
    SEED.write_text(s)

    approx = sum(1 for c in cams if c.get("approx_location"))
    kinds = Counter(c["stream_type"] for c in cams)
    print(
        f"Selesai: {kinds['youtube']} YouTube, {kinds['embed']} embed resmi, {kinds['hls']} stream HLS resmi, "
        f"{kinds['portal']} portal "
        f"dari {len({c['source'] for c in cams})} sumber ({approx} lokasi perkiraan).",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
