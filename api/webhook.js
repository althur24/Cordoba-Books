const crypto = require('crypto');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).end('Method Not Allowed');
    }

    // 1. Validasi API key dari WAHA
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.WAHA_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { event, payload } = req.body;
    
    // 2. Hanya proses event 'message'
    if (event !== 'message') {
        return res.status(200).json({ ok: true, reason: 'Not a message event' });
    }

    // 3. Skip pesan dari group chat (format: xxx@g.us)
    const fromId = payload.from || '';
    if (fromId.includes('@g.us') || fromId.includes('@broadcast')) {
        return res.status(200).json({ ok: true, lead: false, reason: 'Group/broadcast message ignored' });
    }

    // 4. Skip pesan yang dikirim oleh kita sendiri
    if (payload.fromMe === true) {
        return res.status(200).json({ ok: true, lead: false, reason: 'Own message ignored' });
    }

    // 5. HANYA trigger kalau pesan mengandung "Kode Diskon: CB-"
    // Kode ini hanya ada di pesan yang di-generate dari landing page
    // Chat random / pesan biasa TIDAK akan ter-trigger
    const bodyRaw = payload.body || '';
    const isFromLandingPage = bodyRaw.includes('Kode Diskon: CB-');

    if (!isFromLandingPage) {
        return res.status(200).json({ ok: true, lead: false, reason: 'Not from landing page' });
    }

    // Ekstrak phone number dari WAHA (format: 628xxx@c.us)
    const phoneWithSuffix = payload.from || '';
    const phone = phoneWithSuffix.replace('@c.us', '');
    
    if (!phone) {
        return res.status(400).json({ error: 'No phone number provided' });
    }

    // 6. DEDUPLIKASI PERMANEN: cek apakah nomor ini sudah pernah tercatat
    const isDuplicate = await checkAndSetLead(phone);
    if (isDuplicate) {
        return res.status(200).json({ ok: true, lead: false, reason: 'Duplicate lead - phone already recorded' });
    }

    // Hash phone number (SHA-256) untuk Facebook CAPI
    const hashedPhone = crypto
        .createHash('sha256')
        .update(phone)
        .digest('hex');

    // Event ID untuk Facebook dedup
    const eventId = crypto
        .createHash('sha256')
        .update('lead_cbapi_' + phone)
        .digest('hex');

    // Ekstrak fbc dan fbp dari pesan WA (disisipkan di Kode Diskon line)
    var fbc = '';
    var fbp = '';
    var refMatch = bodyRaw.match(/Kode Diskon: CB-[0-9]+\|?([^|\n]*)\|?([^\n]*)/);
    if (refMatch) {
        if (refMatch[1] && refMatch[1].startsWith('fb.')) fbc = refMatch[1];
        if (refMatch[2] && refMatch[2].startsWith('fb.')) fbp = refMatch[2];
    }

    let isSuccess = true;
    let errors = [];

    // 7. Kirim ke Facebook CAPI
    try {
        await sendToFacebookCAPI(hashedPhone, payload, fbc, fbp, eventId);
    } catch (e) {
        console.error('Error sending to FB CAPI:', e);
        isSuccess = false;
        errors.push('FB CAPI Error: ' + e.message);
    }

    // 8. Kirim ke Google Analytics
    try {
        await sendToGA(phone, eventId);
    } catch (e) {
        console.error('Error sending to GA:', e);
        isSuccess = false;
        errors.push('GA Error: ' + e.message);
    }

    return res.status(200).json({ 
        ok: isSuccess, 
        lead: true,
        phone: phone,
        errors: errors.length > 0 ? errors : undefined
    });
};

// ============================================
// DEDUPLIKASI: Upstash Redis (gratis, permanen)
// ============================================
async function checkAndSetLead(phone) {
    const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
    const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

    // Kalau Redis belum di-setup, skip deduplikasi (tetap kirim lead)
    if (!REDIS_URL || !REDIS_TOKEN) {
        console.warn('Upstash Redis not configured - skipping dedup');
        return false;
    }

    const key = `lead:${phone}`;

    try {
        // Cek apakah nomor sudah ada di Redis
        // SETNX = "Set if Not eXists" → return 1 jika baru, 0 jika sudah ada
        const response = await fetch(`${REDIS_URL}/setnx/${key}/1`, {
            headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
        });
        const data = await response.json();
        
        // data.result === 1 → nomor baru (belum pernah tercatat)
        // data.result === 0 → nomor sudah ada (duplikat)
        return data.result === 0;
    } catch (e) {
        console.error('Redis dedup check failed:', e);
        // Kalau Redis error, tetap proses lead (lebih baik double count daripada miss)
        return false;
    }
}

// ============================================
// FACEBOOK CAPI
// ============================================
async function sendToFacebookCAPI(hashedPhone, payload, fbc, fbp, eventId) {
    const PIXEL_ID = process.env.PIXEL_ID;
    const ACCESS_TOKEN = process.env.CAPI_ACCESS_TOKEN;

    if (!PIXEL_ID || !ACCESS_TOKEN) {
        throw new Error('PIXEL_ID or CAPI_ACCESS_TOKEN not set');
    }

    var userData = {
        ph: [hashedPhone],
        client_user_agent: 'WAHA-Webhook/1.0'
    };
    if (fbc) userData.fbc = fbc;
    if (fbp) userData.fbp = fbp;

    const data = {
        data: [{
            event_name: 'Lead CBAPI',
            event_id: eventId,
            event_time: Math.floor(Date.now() / 1000),
            action_source: 'website',
            user_data: userData,
            custom_data: {
                content_name: 'Food & Life Balancing Ala Nabi',
                event_source: 'whatsapp_confirmed'
            }
        }]
    };

    const response = await fetch(
        `https://graph.facebook.com/v18.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        }
    );

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`FB CAPI failed: ${response.status} ${errorText}`);
    }
}

// ============================================
// GOOGLE ANALYTICS
// ============================================
async function sendToGA(phone, eventId) {
    const GA_ID = process.env.GA_MEASUREMENT_ID;
    const GA_SECRET = process.env.GA_API_SECRET;

    if (!GA_ID || !GA_SECRET) {
        throw new Error('GA_MEASUREMENT_ID or GA_API_SECRET not set');
    }

    const response = await fetch(
        `https://www.google-analytics.com/mp/collect?measurement_id=${GA_ID}&api_secret=${GA_SECRET}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: phone,
                events: [{
                    name: 'Lead_CBAPI',
                    params: {
                        source: 'whatsapp',
                        content: 'Food & Life Balancing Ala Nabi',
                        event_id: eventId
                    }
                }]
            })
        }
    );

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GA MP failed: ${response.status} ${errorText}`);
    }
}
