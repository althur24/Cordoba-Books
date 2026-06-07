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

    // 6. Deduplikasi 1 Jam via Facebook event_id
    // Membagi waktu saat ini dengan 3600000ms (1 jam), sehingga ID berubah tiap jam
    const hourBlock = Math.floor(Date.now() / 3600000);

    // Hash phone number (SHA-256) untuk Facebook CAPI
    const hashedPhone = crypto
        .createHash('sha256')
        .update(phone)
        .digest('hex');

    // Event ID untuk Facebook dedup (Berubah tiap 1 jam untuk nomor yang sama)
    const eventId = crypto
        .createHash('sha256')
        .update('lead_cbapi_' + phone + '_' + hourBlock)
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
            event_source_url: 'https://cordoba-books-ybg6.vercel.app/',
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
