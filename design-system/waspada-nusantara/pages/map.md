# Override halaman: Peta utama (konsol operasi)

Aturan di file ini menggantikan MASTER.md untuk halaman peta.

## Arah
- Gaya: Data-Dense Dashboard (ui-ux-pro-max, domain style) dengan panel glassmorphism di atas peta penuh.
- Kaca punya fungsi: peta tetap terlihat samar di balik panel sehingga konteks lokasi tidak hilang.
- Hindari: kartu membulat melayang, chip pill di setiap baris, heading monospace, warna dekoratif.

## Tipografi
- Display: Barlow Condensed (huruf kapital, tracking 0.06em) untuk judul seksi, status, angka besar.
- Body: Barlow 14px, angka tabular di semua waktu, statistik, hitung mundur.

## Warna
- Latar grafit netral `#0B0D10`, teks `#E9EBEE`, teks sekunder `#C3C8CF`, muted `#929AA4`.
- Garis dan hover memakai putih transparan (0.09 / 0.18 / 0.07) supaya menyatu dengan kaca.
- Warna sinyal hanya untuk bahaya dan status: kritis `#F2555A`, tinggi `#F97316`, sedang `#EAB308`, live `#3CCF7E`.
- Tombol 112: `#D92D20` dengan teks putih (kontras 4.8:1).

## Kaca
- `.glass`: rgb(12 15 20 / 0.6), blur 22px, saturate 160%, kilau 1px di tepi atas.
- `.glass-strong` (toast, modal, bottom sheet, drawer): opasitas 0.78, blur 24px, bayangan.
- Fallback tanpa backdrop-filter: latar 0.96.

## Bentuk
- Radius 2-3px untuk kontrol, 6px untuk modal. Panel menempel ke tepi layar.
- Penanda peta: kritis = blok warna penuh + pulse (berhenti setelah ditangani); tinggi = bingkai tebal; lainnya = bingkai tipis.

## Animasi (motion)
- Hanya untuk makna: kilatan sorot baris baru, angka statistik bergeser saat berubah, hitung mundur, pergantian feed/detail.
- Keluar lebih cepat dari masuk (masuk 220ms, keluar 120ms). Lebar panel tidak dianimasikan.
- `MotionConfig reducedMotion="user"`; pulse dimatikan saat reduced motion.
