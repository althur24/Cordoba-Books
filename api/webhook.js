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

    // 3. Cek keyword order di body pesan
    const body = (payload.body || '').toLowerCase();
    const keywords = ['food', 'life', 'balancing', 'nabi', 'pesanan', 'buku', 'ref: cb-'];
    const isOrderMessage = keywords.some(kw => body.includes(kw));

    if (!isOrderMessage) {
        return res.status(200).json({ ok: true, lead: false, reason: 'Not an order message' });
    }

    // Ekstrak phone number dari WAHA (format: 628xxx@c.us)
    const phoneWithSuffix = payload.from || '';
    const phone = phoneWithSuffix.replace('@c.us', '');
    
    if (!phone) {
        return res.status(400).json({ error: 'No phone number provided' });
    }

    // Hash phone number (SHA-256) untuk Facebook CAPI
    const hashedPhone = crypto
        .createHash('sha256')
        .update(phone)
        .digest('hex');

    // Ekstrak fbc dan fbp dari pesan WA (disisipkan di Ref line)
    const bodyRaw = payload.body || '';
    var fbc = '';
    var fbp = '';
    var refMatch = bodyRaw.match(/Ref: CB-[0-9]+\|?([^|\n]*)\|?([^\n]*)/);
    if (refMatch) {
        if (refMatch[1] && refMatch[1].startsWith('fb.')) fbc = refMatch[1];
        if (refMatch[2] && refMatch[2].startsWith('fb.')) fbp = refMatch[2];
    }

    let isSuccess = true;
    let errors = [];

    // 4. Kirim ke Facebook CAPI
    try {
        await sendToFacebookCAPI(hashedPhone, payload, fbc, fbp);
    } catch (e) {
        console.error('Error sending to FB CAPI:', e);
        isSuccess = false;
        errors.push('FB CAPI Error: ' + e.message);
    }

    // 5. Kirim ke Google Analytics
    try {
        await sendToGA(phone);
    } catch (e) {
        console.error('Error sending to GA:', e);
        isSuccess = false;
        errors.push('GA Error: ' + e.message);
    }

    return res.status(200).json({ 
        ok: isSuccess, 
        lead: true,
        phone: phone, // for debugging purposes
        errors: errors.length > 0 ? errors : undefined
    });
};

async function sendToFacebookCAPI(hashedPhone, payload, fbc, fbp) {
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

async function sendToGA(phone) {
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
                        content: 'Food & Life Balancing Ala Nabi'
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
