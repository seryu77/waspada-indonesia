# Waspada Nusantara

Peta real-time kondisi darurat Indonesia. Satu layar menampilkan semua peringatan aktif (karhutla, banjir, gempa, longsor, kecelakaan, gunung api, kriminal), deteksi otomatis dari CCTV publik dengan computer vision, verifikasi AI dua tahap untuk menekan false alarm, dan alur dispatch ke command center 112 dengan operator tetap memegang keputusan.

Demo berjalan penuh **tanpa API key apa pun**.

---

## Cara menjalankan

Butuh Node 20+ dan Python 3.11+.

### Cara cepat (satu perintah)

```bash
cd waspada
./dev.sh
```

Skrip ini membuat venv dan `npm install` bila belum ada, lalu menyalakan backend (port 8000) dan frontend (port 5173). Buka `http://localhost:5173`. Tekan Ctrl+C untuk mematikan keduanya.

Atau jalankan manual di dua terminal:

### 1. Backend (FastAPI + WebSocket)

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env          # opsional, semua nilai boleh kosong
.venv/bin/uvicorn app.main:app --reload --port 8000
```

### 2. Frontend (React + Vite)

```bash
cd frontend
npm install
cp .env.example .env          # opsional
npm run dev                   # http://localhost:5173
```

Vite mem-proxy `/api` dan `/ws` ke `http://127.0.0.1:8000`. Kalau backend mati, frontend tetap tampil dengan seed data, simulator lokal, dan banner "Mode offline".

### Alur demo untuk juri (2 menit)

1. Buka `http://localhost:5173`. Peta Indonesia langsung tampil dengan semua peringatan. Indikator **LIVE** di top bar.
2. Tunggu 20 sampai 30 detik: simulator memunculkan kejadian baru, toast muncul untuk kejadian kritis.
3. Atau klik **Picu kejadian demo** di panel Layer: kejadian kritis dari CCTV muncul, status "Diverifikasi AI...", lalu terverifikasi.
4. Buka halaman operator 112 di `http://localhost:5173/operator`. Kontrol dispatch hanya ada di sini; halaman publik hanya melihat status "petugas sudah diberitahu". Klik toast atau item feed: peta terbang ke lokasi, panel berganti ke detail berisi hasil verifikasi AI (verdict, confidence, alasan, model).
5. Kepastian AI **87% atau lebih**: **hitung mundur 112** otomatis, operator bisa **Kirim sekarang** atau **Batalkan**, tanpa aksi terkirim saat hitung mundur habis. **Di bawah 87%**: status **Butuh validasi**, tidak ada timer dan tidak pernah terkirim sendiri, operator harus **Validasi & kirim** atau **Tolak** (contoh: Tol Palindra, 82%). Semua keputusan tercatat di `GET /api/audit`.
   Di atas tombol validasi ada panel **Bukti pendukung**: indikator otomatis (mendukung atau melemahkan), kondisi lokasi (suhu, kelembapan, angin, hujan sekarang dan 24 jam, kualitas udara AQI dan PM2.5, ketinggian), siaran langsung CCTV pendeteksi atau terdekat, rekaman frame saat deteksi, dan kejadian lain dalam 15 km.
6. Klik **Lapor** untuk mengirim laporan warga (jenis, deskripsi, lokasi dari peta atau GPS, foto opsional).
7. Klik marker **LIVE** di peta untuk menonton CCTV resmi secara langsung. Di halaman operator, tombol **Video wall** menampilkan grid semua CCTV live per kota, plus link ke portal CCTV resmi daerah lain.

### CCTV live dari sumber resmi

Kamera live diambil hanya dari siaran yang dibuka instansi untuk publik, didaftarkan di `backend/cctv_sources.json`:

YouTube dan portal link saat ini dimatikan (`enable_youtube`, `enable_portals` di config) karena tidak bisa diproses computer vision.

- **YouTube resmi** pemda, dinas, BPBD, dan Badan Geologi (Dishub Pontianak, Pemkot Yogyakarta, Gunungkidul, Samarinda, Magelang, Demak, Bantul, BPBD Sleman, gunung api PVMBG, dan lainnya).
- **Embed resmi** dari server Restreamer pemda (Kota Magelang, Banda Aceh, Pati) yang menyediakan kode embed lewat oEmbed. Daftar kamera dan koordinatnya dibaca dari portal resmi masing-masing.
- **CCTV jalan tol** dari daftar resmi BPJT Kementerian PU (`bpjt.pu.go.id/cctv`), difilter per area (saat ini Jakarta). Tol yang mengunci streamnya ke domain sendiri (misal Jasa Marga) otomatis tidak diambil.
- **Stream HLS resmi** dari portal ATCS yang mencantumkan alamat video di halamannya (Banjarbaru, Ciamis, Pekanbaru). Hanya kamera yang servernya mengizinkan diputar dari situs lain (CORS terbuka, tanpa token atau login), sedang menyala, dan cukup cepat ditonton yang diambil. Portal yang mengunci streamnya (misal Banjarmasin, Banyumas) tidak dipakai.
- **Portal resmi** yang tidak bisa di-embed (Bandung, DIY, Malang, Batam, dan lainnya): tampil sebagai tombol "Buka portal resmi".

ID siaran YouTube bisa berubah saat siaran dimulai ulang. Perbarui sebelum demo:

```bash
cd backend && .venv/bin/python scripts/sync_cctv.py   # tulis ulang cameras.json dan shared/seed.json
```

Kejadian simulasi tidak pernah ditempel ke CCTV asli, hanya ke kamera demo. Kejadian di CCTV asli hanya datang dari pipeline computer vision (lihat di bawah).

---

## Environment variables

| Variabel | Default | Keterangan |
|---|---|---|
| **Frontend** | | |
| `VITE_GOOGLE_MAPS_API_KEY` | kosong | Kosong = fallback Leaflet + tile gelap |
| `VITE_GOOGLE_MAP_ID` | kosong | Map ID vector (dark). Kosong = `DEMO_MAP_ID` |
| `VITE_TILE_URL` | Stadia `alidade_smooth_dark` | Tile untuk fallback Leaflet |
| **Backend** | | |
| `LLM_PROVIDER` | `gemini` | `gemini` atau `anthropic` |
| `GEMINI_API_KEY` | kosong | Key gratis dari Google AI Studio. Kosong = verifier heuristik berlabel "simulasi" |
| `GEMINI_TRIAGE_MODEL` | `gemini-flash-lite-latest` | Tahap 1, filter cepat |
| `GEMINI_VERIFY_MODEL` | `gemini-flash-latest` | Tahap 2, verifikasi final |
| `VERIFY_EFFORT` | `low` | `low` atau `medium` (Gemini: thinking level) |
| `ANTHROPIC_API_KEY` | kosong | Dipakai kalau `LLM_PROVIDER=anthropic` |
| `TRIAGE_MODEL` / `VERIFY_MODEL` | `claude-haiku-5-5` / `claude-opus-5-5` | Model Claude untuk tahap 1 dan 2 |
| `NASA_FIRMS_MAP_KEY` | kosong | Titik panas satelit. Kosong = sumber FIRMS nonaktif |
| `DISPATCH_MODE` | `simulate` | `simulate` atau `webhook` |
| `DISPATCH_WEBHOOK_URL` | kosong | Endpoint command center (mode webhook) |
| `DISPATCH_COUNTDOWN_S` | `45` | Lama hitung mundur |
| `DISPATCH_CONFIDENCE_MIN` | `0.87` | Ambang auto-dispatch. Di bawahnya wajib divalidasi operator 112 |
| `DEMO_MODE` | `true` | Seed data + simulator + tombol demo |
| `ENABLE_BMKG` / `ENABLE_PETABENCANA` / `ENABLE_MAGMA` | `true` | Sumber data nyata gratis tanpa key |
| `ENABLE_VISION` | `false` | Pipeline CCTV + YOLO |

Jangan commit file `.env`. Sudah masuk `.gitignore`.

---

## Arsitektur

```mermaid
flowchart LR
  subgraph Sumber
    BMKG[BMKG TEWS<br/>gempa]
    FIRMS[NASA FIRMS<br/>titik panas]
    PB[PetaBencana.id<br/>laporan warga]
    MAGMA[MAGMA / PVMBG<br/>gunung api]
    CCTV[CCTV publik<br/>HLS/RTSP/snapshot]
    WARGA[Form Lapor]
    SIM[Simulator demo]
  end

  CCTV --> CV[OpenCV sampling<br/>+ YOLO]
  CV --> RULE[Aturan konsistensi<br/>N frame, threshold]
  RULE --> BLUR[Blur wajah & plat]
  WARGA --> BLUR

  BLUR --> T1[Tahap 1: Gemini Flash-Lite<br/>filter cepat]
  PB --> T1
  SIM --> T1
  T1 -->|lolos + severity tinggi| T2[Tahap 2: Gemini Flash<br/>verifikasi final]
  T1 -->|false alarm / uncertain| HUB
  T2 --> HUB

  BMKG --> HUB[(Hub state<br/>+ SQLite)]
  FIRMS --> HUB
  MAGMA --> HUB

  HUB --> DM{Confirmed,<br/>conf >= 0.87,<br/>severity tinggi?}
  DM -->|ya| CD[Hitung mundur 45 dtk]
  DM -->|conf < 0.87| RV[Butuh validasi<br/>operator 112]
  RV -->|Validasi & kirim| AD
  RV -->|Tolak| AUD
  CD -->|operator: Kirim / timeout| AD[Dispatch adapter<br/>simulate / webhook]
  CD -->|operator: Batalkan| AUD
  AD --> CC[Command center pemda]
  AD --> AUD[(Audit log)]

  HUB <-->|WebSocket /ws<br/>snapshot, incident.upsert,<br/>camera.update| FE[Frontend React<br/>peta + feed + detail]
```

### Struktur folder

```
waspada/
  frontend/            React + Vite + TS, Tailwind v4, motion, Google Maps / Leaflet
    src/map/           GoogleMapView, LeafletMapView, penanda (React + motion)
    src/components/    TopBar, LayerPanel, IncidentFeed, IncidentDetail, DispatchTimeline,
                       BottomSheet, Toasts, Legend, ReportForm
    src/store/         useLiveData: snapshot + WebSocket + fallback offline
    src/lib/           meta bahaya, sort, seed, mesin lokal (mode offline)
  backend/
    app/sources/       base.py (interface DataSource), bmkg, firms, petabencana, magma, demo_seed
    app/llm/           schema (structured output), context (cuaca, laporan terdekat), verifier, heuristic
    app/dispatch/      base, simulate, webhook, manager (hitung mundur + audit)
    app/vision/        pipeline (OpenCV + YOLO), privacy (blur)
    app/simulator.py   kejadian baru tiap 20-30 detik
    app/pipeline.py    kandidat -> verifikasi -> audit -> dispatch
    cameras.json       daftar kamera (dihasilkan scripts/sync_cctv.py + kamera demo)
    cctv_sources.json  sumber CCTV resmi: channel YouTube, Restreamer, portal
    scripts/sync_cctv.py  sinkronisasi CCTV live dari sumber resmi
  shared/seed.json     data demo (dipakai frontend dan backend)
  design-system/       hasil ui-ux-pro-max (MASTER.md)
```

### API

| Endpoint | Fungsi |
|---|---|
| `GET /api/snapshot` | Semua kejadian, zona, rute, kamera |
| `WS /ws` | Snapshot saat connect, lalu `incident.upsert`, `camera.update`, `heartbeat` |
| `POST /api/incidents/{id}/dispatch/confirm` | Operator: kirim sekarang |
| `POST /api/incidents/{id}/dispatch/cancel` | Operator: batalkan |
| `POST /api/reports` | Laporan warga (multipart: `type`, `description`, `lat`, `lng`, `photo` opsional) |
| `GET /api/incidents/{id}/evidence` | Bukti untuk operator: kondisi lokasi (Open-Meteo), kejadian sekitar, kamera, frame deteksi |
| `GET /api/audit` | Audit log keputusan AI dan operator |
| `POST /api/demo/trigger` | Mode demo: buat kejadian kritis CCTV sekarang |
| `GET /api/health` | Status server |

---

## Sumber data

| Sumber | Status | Catatan |
|---|---|---|
| BMKG TEWS (`autogempa.json`, `gempaterkini.json`) | Aktif, tanpa key | Gempa 72 jam terakhir. M >= 6 langsung masuk hitung mundur |
| NASA FIRMS (VIIRS) | Butuh `NASA_FIRMS_MAP_KEY` gratis | Dikelompokkan per grid 0,1 derajat supaya peta tidak penuh ribuan titik |
| PetaBencana.id | Aktif, tanpa key | Laporan warga 24 jam terakhir, lewat verifier |
| MAGMA Indonesia (PVMBG) | Aktif, parsing halaman | Tidak ada API JSON resmi. Gunung Level III dan IV + radius larangan perkiraan. Gagal = pakai seed |
| Kriminal | Data demo | Tidak ada API terbuka. Area rawan berupa polygon agregat dengan label sumber dan periode |
| Cuaca (Open-Meteo) | Aktif, tanpa key | Konteks tambahan untuk verifier |

Data seed diberi label "data demo" di UI. Kejadian dari simulator diberi label "(simulasi)".

---

## Verifikasi AI (anti false alarm)

Provider default adalah Google Gemini (`LLM_PROVIDER=gemini`), dipanggil langsung lewat REST `generateContent` tanpa SDK tambahan (`app/llm/gemini.py`). Claude tetap tersedia dengan `LLM_PROVIDER=anthropic`.

- **Tahap 1** `GEMINI_TRIAGE_MODEL` (Gemini Flash-Lite, thinking low): semua kandidat dari CCTV, laporan warga, dan simulator.
- **Tahap 2** `GEMINI_VERIFY_MODEL` (Gemini Flash, thinking `VERIFY_EFFORT`): hanya kandidat yang lolos tahap 1 dengan severity tinggi/kritis.
- Input: 2 sampai 4 frame berurutan (sudah diblur) + konteks lokasi, jam WIB, cuaca, kejadian dan laporan dalam radius 15 km.
- Output wajib JSON terstruktur (`responseSchema`): `verdict`, `confidence`, `severity`, `reasoning` (Bahasa Indonesia), `recommended_agency`.
- Diblokir filter keamanan, output terpotong, kuota habis, dan semua error API menghasilkan verdict `uncertain` + "butuh cek manual". Kejadian tidak pernah hilang.
- False alarm dengan confidence >= 0,7 disembunyikan dari peta tapi tetap tersimpan di database dan audit log.
- Tanpa API key: verifier heuristik, selalu berlabel **simulasi** di UI.

## Integrasi 112

Belum ada API publik untuk 112 Indonesia. Layanan 112 dikelola pemda (command center) bersama Komdigi, dan panggilan otomatis dari AI tanpa pengecekan berisiko membanjiri operator dengan false alarm. Karena itu:

- **Kode ini tidak pernah menelepon 112.** Adapter `simulate` (default) hanya mencatat payload. Adapter `webhook` mengirim JSON ke endpoint command center yang dikonfigurasi.
- **Halaman operator** (`/operator`): satu-satunya tempat kontrol dispatch. Antrean diurutkan: butuh validasi, lalu hitung mundur, lalu severity.
- **Auto-dispatch**: severity tinggi/kritis + verdict confirmed + confidence >= 0,87 memulai hitung mundur 45 detik. Operator bisa Kirim sekarang atau Batalkan. Tanpa aksi, terkirim otomatis.
- **Validasi operator**: severity tinggi/kritis dengan confidence di bawah 0,87 (atau verdict uncertain) masuk status `review`. Tidak ada timer; hanya terkirim kalau operator menekan Validasi & kirim, atau ditutup dengan Tolak.
- Payload (`waspada.dispatch.v1`): jenis, koordinat, alamat, waktu, ringkasan AI, link frame bukti, instansi yang direkomendasikan, siapa yang memutuskan.
- Semua keputusan AI, sistem, dan operator tercatat di tabel `audit_log` (`GET /api/audit`).

Tombol **Hubungi 112** di top bar adalah tautan `tel:112` untuk warga.

## Pipeline CCTV + computer vision

Aktifkan dengan `ENABLE_VISION=true` dan `pip install -r requirements-vision.txt`. Paket ini ikut memasang PyTorch (beberapa GB). YOLO-World akan memasang paket `clip` dan mengunduh weights-nya sendiri saat pertama jalan. Pipeline ini butuh mesin dengan CPU/GPU kuat, jadi jalankan backend di laptop atau server sendiri, bukan di Vercel.

Kamera yang diproses: semua kamera ATCS hasil `scripts/sync_cctv.py` (HLS langsung, atau HLS di balik player embed lewat `vision_url`) plus kamera yang ditambahkan manual. YouTube tidak pernah diproses (dilarang ToS).

- **Ringan untuk server pemda:** tiap giliran hanya 1 frame per kamera, koneksi langsung ditutup. `VISION_CONCURRENCY` worker (default 3) mengunjungi kamera bergiliran, dengan jeda minimal `VISION_SAMPLE_S` detik (default 20) per kamera.
- **Batasi beban laptop:** `VISION_CITIES=Banjarbaru,Ciamis` atau `VISION_MAX_CAMERAS=20`.
- **Model:**
  - YOLO umum (`GENERAL_WEIGHTS`): kendaraan saling tumpang tindih = dugaan tabrakan, banyak orang = kerumunan.
  - YOLO-World (`WORLD_WEIGHTS`, prompt teks): api, asap, banjir/genangan, kendaraan terguling. Tidak perlu training.
  - Weights kustom opsional (`FIRE_WEIGHTS`), misalnya hasil training D-Fire di `backend/weights/fire_smoke.pt`, untuk api/asap yang lebih akurat.
- **Aturan sebelum LLM:** deteksi harus muncul di 3 frame berturut-turut (confidence >= 0,5, atau >= 0,3 untuk api/banjir dari YOLO-World), plus cooldown 10 menit per kamera. Lalu diverifikasi LLM dua tahap dan operator.
- Untuk produksi, ajukan izin tertulis ke Dishub/Diskominfo pemilik kamera.

### Privasi

- Tidak ada face recognition.
- Wajah dan plat nomor diblur sebelum gambar disimpan atau dikirim ke LLM (`app/vision/privacy.py`):
  - Wajah: OpenCV `FaceDetectorYN` bila `backend/weights/face_detection_yunet.onnx` ada (model YuNet dari OpenCV Zoo).
  - Plat: sepertiga bawah kotak kendaraan dari YOLO.
  - Tanpa detektor: gambar diperkecil ke lebar 640 px dan diblur ringan seluruhnya.

---

## Poin pitch

**Masalah.** Informasi bencana di Indonesia lambat menyebar. Saat karhutla, banyak warga tidak tahu ada api atau asap di dekat mereka. Laporan ke 112, damkar, polisi, dan BPBD sering terlambat dan belum terverifikasi, sehingga petugas datang terlambat atau menghabiskan waktu untuk laporan palsu.

**Solusi.** Satu peta Indonesia yang langsung menampilkan semua peringatan aktif dari sumber resmi (BMKG, PVMBG, NASA FIRMS), laporan warga, dan deteksi otomatis CCTV publik. AI memverifikasi setiap kandidat dalam dua tahap sebelum diteruskan, dan kejadian terverifikasi otomatis disiapkan untuk command center 112 dengan operator tetap memegang keputusan akhir.

**Dampak.**
- Waktu dari kejadian ke laporan turun dari menit/jam ke detik (deteksi CCTV + verifikasi otomatis).
- Operator 112 menerima laporan yang sudah terverifikasi, lengkap dengan koordinat, bukti frame, dan instansi yang direkomendasikan.
- Warga melihat rute terhalang, rute berbahaya, zona asap, genangan, dan radius larangan gunung api di satu tempat.
- Jejak audit lengkap untuk akuntabilitas keputusan AI dan manusia.

**Rencana integrasi dengan pemda.**
1. Pilot dengan satu command center (contoh: Jakarta Smart City atau Bandung Command Center) memakai mode `webhook` ke sistem tiket mereka.
2. Kerja sama akses CCTV ATCS/Dishub dengan perjanjian privasi (blur, retensi terbatas, tanpa face recognition).
3. Kalibrasi ambang confidence dan hitung mundur bersama operator 112, ukur false alarm rate per minggu.
4. Skala ke PostgreSQL + PostGIS, antrean pesan, dan penambahan sumber (BNPB/InaRISK, data sensor tinggi muka air).

---

## Catatan teknis

- Peta dikunci di wilayah Indonesia (north 6.8, south -11.8, west 94.0, east 141.8) dengan zoom minimum dinamis.
- Tile fallback default Stadia `alidade_smooth_dark` gratis tanpa key di localhost. Untuk domain publik, daftar gratis di stadiamaps.com atau ganti `VITE_TILE_URL`. Tile CARTO `dark_all` sekarang meminta API key.
- Peta dibuat ringan: tile tanpa versi retina, zoom maksimal 12 (level kota), tile dimuat saat peta diam, poligon dan rute digambar di canvas.
- Kejadian simulasi selesai otomatis setelah 8 menit dan maksimal 12 aktif sekaligus, supaya peta tidak menumpuk saat demo berjalan lama. Pulse hanya untuk kejadian kritis yang belum ditangani.
- Semua animasi memakai `motion` (`motion/react`) dengan `MotionConfig reducedMotion="user"`; pulse kritis dimatikan saat reduced motion.
- Design system: `design-system/waspada-nusantara/MASTER.md` (ui-ux-pro-max, density 8, motion 5).
# waspada-indonesia
