# DNA & Flow Form Pemesanan Cordoba Books

Dokumen ini menjelaskan alur (flow) pemesanan dari form di landing page hingga data tersimpan di database dan pembeli diarahkan ke WhatsApp.

## 1. Flow Form Pemesanan (End-to-End)

1. **User Input Data**: Pengunjung mengisi form di landing page (Nama, WhatsApp, Alamat, Jumlah Buku).
2. **Hitung Harga Otomatis**: Saat user mengubah jumlah buku, ringkasan harga di bawah form otomatis terupdate secara real-time.
3. **Submit Form**: User menekan tombol "Pesan Lewat WhatsApp".
4. **Validasi & Loading**: 
   - Browser memvalidasi apakah kolom wajib sudah diisi.
   - Muncul *loading overlay* agar user tidak klik tombol submit berkali-kali.
5. **Tracking Event (Pixel & Analytics)**: 
   - Script menembakkan event `Lead CB` ke Facebook Pixel (FBQ) dan Google Analytics (GTAG) beserta *conversion value* (total harga).
6. **API Call ke Backend (Supabase)**:
   - Client mengirim data pemesanan ke endpoint `/api/lead` via method POST.
   - Data juga menyertakan Facebook Click ID (`fbc`) dan Browser ID (`fbp`) dari cookie untuk keperluan *Conversion API* (CAPI).
7. **Proses di Server (`api/lead.js`)**:
   - Server men-generate kode unik (Short Code) sepanjang 6 karakter heksadesimal.
   - Server menyimpan data ke tabel `leads` di database Supabase dengan status awal `form_submitted`.
   - Server mengembalikan response berisi `shortCode` ke client.
8. **Redirect ke WhatsApp**:
   - Client (browser) merakit pesan template WhatsApp, menyisipkan rincian data diri, pesanan, dan `Kode Diskon: CB-[ShortCode]`.
   - Setelah jeda 1.5 detik (untuk memastikan event FB Pixel sukses terkirim), user otomatis di-redirect ke link `wa.me` dengan pesan yang sudah terisi otomatis.

---

## 2. Kode-Kode Utama yang Terlibat

### A. `index.html` (Struktur Form & UI)
Berisi struktur HTML dari form pemesanan (berada di **Section 11**).
*   **ID penting**: 
    *   Form: `id="orderForm"`
    *   Input: `id="nama"`, `id="whatsapp"`, `id="alamat"`, `id="jumlah"`
    *   Summary Harga: `id="summary-qty"`, `id="summary-price"`, `id="summary-total"`
*   Menggunakan checkbox konfirmasi (`id="confirmData"`) untuk validasi manual dari sisi user.
*   Terdapat elemen `#loading-overlay` yang dimunculkan (diubah CSS-nya jadi aktif) saat proses submit berjalan.

### B. `script.js` (Logika Client-Side)
File ini meng-handle semua interaksi form di sisi pengguna.
*   **Tracking Facebook CAPI**: Menangkap parameter URL `fbclid` dan cookie `_fbp` / `_fbc` untuk tracking (Baris 3-16).
*   **Dynamic Price Calculation**: Event listener untuk input `jumlah` guna mengubah total harga secara live (Baris 120-145).
*   **Submission Logic** (Baris 147-253):
    *   Menghentikan default submit behaviour (`e.preventDefault()`).
    *   Fire event konversi: `fbq('trackCustom', 'Lead CB', ...)` dan `gtag('event', 'Lead CB', ...)`.
    *   Melakukan HTTP Request `fetch('/api/lead', ...)` ke backend API Vercel/Node.js.
    *   Jika API gagal, sistem tetap merakit *fallback reference code* (`CB-[Timestamp]`).
    *   Merakit string `message` untuk WhatsApp dan memanggil `window.location.href = waUrl`.

### C. `api/lead.js` (Logika Backend API)
File backend berbasis serverless function (biasanya berjalan di Vercel atau environment Node.js sejenis).
*   Menerima method `POST` dan mengambil `SUPABASE_URL` serta `SUPABASE_SERVICE_KEY` dari environment variables (Baris 8-9).
*   **Generate Kode**: Memakai `crypto.randomBytes(3).toString('hex').toUpperCase()` untuk menghasilkan short code unik (Baris 19-20).
*   **Integrasi Supabase**: Melakukan POST HTTP Request ke REST API Supabase (ke endpoint `/rest/v1/leads`) untuk menyimpan row baru (Baris 33-43).
*   Mengembalikan status HTTP 200 beserta `shortCode` jika berhasil menyimpan data.
