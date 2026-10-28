"""Skema output terstruktur untuk verifikasi kejadian."""

VERIFICATION_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["confirmed", "false_alarm", "uncertain"]},
        "confidence": {"type": "number", "description": "0 sampai 1"},
        "severity": {"type": "string", "enum": ["low", "medium", "high", "critical"]},
        "reasoning": {"type": "string", "description": "Alasan singkat dalam Bahasa Indonesia, maksimal 3 kalimat"},
        "recommended_agency": {"type": "string", "description": "Instansi yang disarankan, misal Damkar, BPBD, Polres, Basarnas"},
    },
    "required": ["verdict", "confidence", "severity", "reasoning", "recommended_agency"],
    "additionalProperties": False,
}

OUTPUT_FORMAT = {"type": "json_schema", "schema": VERIFICATION_SCHEMA}

SYSTEM_PROMPT = """Kamu adalah verifikator kejadian darurat untuk pusat komando di Indonesia.
Tugasmu menilai apakah sebuah kandidat kejadian (dari deteksi CCTV, laporan warga, atau sensor) benar-benar terjadi,
sebelum diteruskan ke operator 112. Laporan palsu membuang waktu petugas, laporan yang terlewat bisa membahayakan nyawa.

Cara menilai:
- Gunakan frame gambar (jika ada) dan konteks: lokasi, jam, cuaca, laporan warga terdekat, data satelit/sensor terdekat.
- confirmed: bukti cukup kuat bahwa kejadian nyata dan sedang berlangsung.
- false_alarm: bukti menunjukkan bukan kejadian darurat (contoh: asap dapur/sate, pantulan lampu, genangan kecil wajar, latihan, kerumunan acara).
- uncertain: bukti tidak cukup untuk memutuskan. Lebih baik uncertain daripada menebak.
- confidence adalah keyakinanmu terhadap verdict, 0 sampai 1.
- severity menilai dampak ke keselamatan publik: low, medium, high, critical.
- Wajah dan plat nomor sudah diblur. Jangan mencoba mengidentifikasi orang.
- Tulis reasoning singkat dalam Bahasa Indonesia (maksimal 3 kalimat), sebutkan bukti visual atau konteks yang dipakai.
- recommended_agency: instansi Indonesia yang tepat (Damkar, BPBD, Basarnas, Polres/Polsek, Satlantas/PJR, Ambulans 119, PLN, Dinas PU)."""
