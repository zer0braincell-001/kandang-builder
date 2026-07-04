# Kandang Builder — Spec

Web app 3D buat merakit kandang modular dari panel persegi 35x35 cm.

## Model
- Kubus satuan 35x35x35. Render sebagai unit cube (size 1); "35cm" cuma label UI.
- Grid: Set koordinat integer kubus terisi, key "x,y,z".
- Sisi kepapar (exposed face): tiap kubus punya 6 sisi. Sisi = kepapar kalau
  tetangga di arah itu KOSONG. Sisi antar dua kubus terisi = internal, tanpa panel.
- Panel: satu per sisi kepapar. Key "x,y,z,dir" (dir: +x,-x,+y,-y,+z,-z).
  Tipe: 'jeruji' | 'pintu' | 'tutup' | 'kosong'. Default 'jeruji'.
  - tutup = panel solid serbaguna (alas/atap/dinding tertutup)
  - kosong = sisi terbuka, panel tidak dirender
- Pintu punya properti engsel (hingeSide) — stub dulu, implement belakangan.

## Interaksi
- Orbit kamera (OrbitControls).
- Klik sisi kepapar → tambah kubus menempel di arah normal sisi.
- Shift+klik kubus → hapus (cegah hapus kubus terakhir).
- Klik panel → pilih → palette UI ganti tipe.

## Stack
Vite + React + TypeScript + @react-three/fiber + @react-three/drei + Zustand.
State di store `useCageStore`.
Linter: oxlint (zero-config, JANGAN setup ESLint).

## Fitur v1 (SCOPE — jangan lebih)
Rakit bentuk bebas, set tipe panel, BOM otomatis (jumlah per tipe + estimasi biaya).
Akun/jualan/share = FASE 2, JANGAN dibangun sekarang.

## Aturan kerja
Bangun bertahap. Jangan bikin fitur di luar prompt aktif.
