document.addEventListener('DOMContentLoaded', () => {
    
    // 1. Sticky Header on Scroll
    const header = document.getElementById('main-header');
    
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            header.style.boxShadow = '0 4px 20px rgba(27, 86, 166, 0.1)';
            header.style.padding = '0'; // Smaller header
        } else {
            header.style.boxShadow = 'none';
        }
    });

    // 2. Smooth Scrolling for Anchor Links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;
            
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                // Adjust for fixed header height
                const headerHeight = header.offsetHeight;
                const targetPosition = targetElement.getBoundingClientRect().top + window.pageYOffset - headerHeight;
                
                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });

    // 3. FAQ Accordion Toggle
    const accordionItems = document.querySelectorAll('.accordion-item');
    
    accordionItems.forEach(item => {
        const header = item.querySelector('.accordion-header');
        
        header.addEventListener('click', () => {
            // Close other open items
            accordionItems.forEach(otherItem => {
                if (otherItem !== item && otherItem.classList.contains('active')) {
                    otherItem.classList.remove('active');
                }
            });
            
            // Toggle current item
            item.classList.toggle('active');
        });
    });

    // 4. Scroll Animations (Intersection Observer)
    const animatedElements = document.querySelectorAll('[data-animate]');
    
    const animationObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const el = entry.target;
                
                // Add delay if specified
                const delay = el.getAttribute('data-delay');
                if (delay) {
                    setTimeout(() => {
                        el.classList.add('is-visible');
                    }, parseInt(delay));
                } else {
                    el.classList.add('is-visible');
                }
                
                // Unobserve after animating
                observer.unobserve(el);
            }
        });
    }, {
        threshold: 0.1, // Trigger when 10% visible
        rootMargin: '0px 0px -50px 0px' // Slightly before it comes into full view
    });
    
    animatedElements.forEach(el => {
        animationObserver.observe(el);
    });

    // 5. Order Form Logic & WhatsApp Submission
    const orderForm = document.getElementById('orderForm');
    const jumlahInput = document.getElementById('jumlah');
    const summaryQty = document.getElementById('summary-qty');
    const summaryTotal = document.getElementById('summary-total');
    const summaryOriginal = document.getElementById('summary-original');
    const summaryOriginalTotal = document.getElementById('summary-original-total');
    const summaryPrice = document.getElementById('summary-price');
    
    // Base prices
    const BOOK_PRICE = 149000;
    const ORIGINAL_PRICE = 210000;

    // Format currency to Rp XX.XXX
    function formatRupiah(number) {
        return 'Rp ' + number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    }

    // Dynamic Summary Update
    if (jumlahInput && summaryQty && summaryTotal) {
        ['input', 'change'].forEach(evt => {
            jumlahInput.addEventListener(evt, function() {
                let qty = parseInt(this.value);
                if (isNaN(qty) || qty < 1) qty = 1;
                
                summaryQty.innerText = `(x${qty})`;
                
                const total = qty * BOOK_PRICE;
                const totalOriginal = qty * ORIGINAL_PRICE;
                
                summaryTotal.innerText = formatRupiah(total);
                if (summaryPrice) {
                    summaryPrice.innerText = formatRupiah(total);
                }
                
                if (summaryOriginal) {
                    summaryOriginal.innerText = formatRupiah(totalOriginal);
                }
                if (summaryOriginalTotal) {
                    summaryOriginalTotal.innerText = formatRupiah(totalOriginal);
                }
            });
        });
    }

    // GANTI DENGAN NOMOR WA YANG BENAR NANTINYA (Format: 628XXXXXXXXXX)
    const WA_NUMBER = "6287842482817";

    if (orderForm) {
        orderForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            // Get form values
            const nama = document.getElementById('nama').value.trim();
            const whatsapp = document.getElementById('whatsapp').value.trim();
            const alamat = document.getElementById('alamat').value.trim();
            const jumlahVal = document.getElementById('jumlah').value.trim();
            let jumlah = parseInt(jumlahVal);
            if (isNaN(jumlah) || jumlah < 1) jumlah = 1;

            const totalHarga = formatRupiah(jumlah * BOOK_PRICE);
            
            // Validate (basic HTML5 validation handles most, but just in case)
            if (!nama || !whatsapp || !alamat) {
                alert("Mohon lengkapi semua data pemesanan.");
                return;
            }

            // === SHOW LOADING OVERLAY ===
            const overlay = document.getElementById('loading-overlay');
            if (overlay) overlay.classList.add('active');

            // === FIRE LEAD EVENT (Facebook Pixel + Google Analytics) ===
            if (typeof fbq !== 'undefined') {
                fbq('trackCustom', 'Lead CB', {
                    content_name: 'Food & Life Balancing Ala Nabi',
                    quantity: jumlah,
                    value: jumlah * BOOK_PRICE,
                    currency: 'IDR'
                });
            }
            if (typeof gtag !== 'undefined') {
                gtag('event', 'Lead CB', {
                    event_category: 'Custom Conversion',
                    event_label: 'Form Submitted',
                    value: jumlah * BOOK_PRICE
                });
            }
            
            // Create WhatsApp Message Template
            let message = `Halo, saya ingin mengkonfirmasi pesanan buku *Food & Life – Balancing Ala Nabi*.\n\nBerikut rincian pesanan saya:\n\n`;
            message += `*Data Pengiriman:*\n`;
            message += `- Nama Lengkap: ${nama}\n`;
            message += `- Nomor WhatsApp: ${whatsapp}\n`;
            message += `- Kota / Alamat Lengkap: ${alamat}\n\n`;
            message += `*Detail Pesanan:*\n`;
            message += `- Jumlah Pesanan: ${jumlah} Buku\n`;
            message += `- Estimasi Total: ${totalHarga} (Belum termasuk ongkir jika ada)\n\n`;
            message += `Mohon info selanjutnya ya. Terima kasih!`;
            
            const encodedMessage = encodeURIComponent(message);
            const waUrl = `https://wa.me/${WA_NUMBER}?text=${encodedMessage}`;
            
            // === DELAY 2 DETIK agar event sempat tertrigger ===
            setTimeout(function() {
                if (overlay) overlay.classList.remove('active');
                window.location.href = waUrl;
            }, 2000);
        });
    }

// 6. Promo Countdown Timer (Personalized 5 hours, resets at midnight)
function initPromoTimer() {
    const hoursEl = document.getElementById('cd-hours');
    const minutesEl = document.getElementById('cd-minutes');
    const secondsEl = document.getElementById('cd-seconds');
    const promoSection = document.getElementById('promo');
    const originalPriceLabel = document.querySelector('.price-original');
    
    if (!hoursEl || !promoSection) return;

    const todayString = new Date().toDateString();
    let savedDate = localStorage.getItem('cordobaPromoDate');
    let targetTime = Number(localStorage.getItem('cordobaPromoTarget'));

    // If it's a new day or no data exists, start a fresh 5-hour timer
    if (savedDate !== todayString || !targetTime) {
        targetTime = Date.now() + (5 * 60 * 60 * 1000); // 5 hours from now
        localStorage.setItem('cordobaPromoDate', todayString);
        localStorage.setItem('cordobaPromoTarget', targetTime);
    }

    function update() {
        const now = Date.now();
        const diff = targetTime - now;

        if (diff <= 0) {
            // Timer expired -> revert to original price
            promoSection.classList.add('promo-expired');
            if (originalPriceLabel) {
                originalPriceLabel.innerHTML = 'Harga: <span>Rp 210.000</span>';
            }
            return;
        }

        const h = Math.floor(diff / (1000 * 60 * 60));
        const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((diff % (1000 * 60)) / 1000);

        hoursEl.textContent = h.toString().padStart(2, '0');
        minutesEl.textContent = m.toString().padStart(2, '0');
        secondsEl.textContent = s.toString().padStart(2, '0');
    }

    update();
    setInterval(update, 1000);
}

if (document.getElementById('promo-timer')) {
    initPromoTimer();
}

// ============================================
// 7. GOOGLE ANALYTICS — BEHAVIOR TRACKING
// ============================================

// --- SCROLL DEPTH ---
(function() {
    var fired = { 25: false, 50: false, 75: false, 100: false };

    window.addEventListener('scroll', function() {
        var scrollTop = window.pageYOffset;
        var docHeight = document.documentElement.scrollHeight - window.innerHeight;
        if (docHeight <= 0) return;
        var percent = Math.round((scrollTop / docHeight) * 100);

        if (percent >= 25 && !fired[25])  { fired[25] = true;  gtag('event', 'scroll_25'); }
        if (percent >= 50 && !fired[50])  { fired[50] = true;  gtag('event', 'scroll_50'); }
        if (percent >= 75 && !fired[75])  { fired[75] = true;  gtag('event', 'scroll_75'); }
        if (percent >= 100 && !fired[100]) { fired[100] = true; gtag('event', 'scroll_100'); }
    });
})();

// --- SECTION VIEWS ---
(function() {
    var tracked = {
        'hero': 'view_hero',
        'penulis': 'view_penulis',
        'isi-buku': 'view_isi_buku',
        'quote': 'view_quote',
        'fitur-buku': 'view_fitur_buku',
        'promo': 'view_promo',
        'form-order': 'view_form',
        'faq': 'view_faq'
    };

    Object.keys(tracked).forEach(function(id) {
        var el = document.getElementById(id);
        if (!el) return;

        var observer = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    gtag('event', tracked[id]);
                    observer.unobserve(el);
                }
            });
        }, { threshold: 0.3 });

        observer.observe(el);
    });
})();

});
