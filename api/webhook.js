const crypto = require('crypto');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).end('Method Not Allowed');
    }

    // 1. Validasi API key dari WAHA (dikirim via ?key=xxx di URL)
    const apiKey = req.query.key || req.headers['x-api-key'];
    if (apiKey !== process.env.WAHA_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

    const { event, payload } = req.body;
    
    // 2. Hanya proses event 'message' atau 'message.any'
    if (event !== 'message' && event !== 'message.any') {
        return res.status(200).json({ ok: true, reason: 'Not a message event' });
    }

    // 3. Skip pesan dari group chat
    const fromId = payload.from || '';
    const toId = payload.to || '';
    if (fromId.includes('@g.us') || fromId.includes('@broadcast') || toId.includes('@g.us')) {
        return res.status(200).json({ ok: true, lead: false, reason: 'Group/broadcast message ignored' });
    }

    const bodyRaw = payload.body || '';
    
    // DEBUG: Log semua field penting untuk troubleshoot
    console.log('WEBHOOK DEBUG:', JSON.stringify({
        event,
        fromMe: payload.fromMe,
        fromMeType: typeof payload.fromMe,
        from: fromId,
        to: toId,
        chatId: payload.chatId,
        body: bodyRaw.substring(0, 100),
        hasThanks: bodyRaw.includes('#thanks'),
        id: payload.id,
        source: payload.source
    }));
    
    // ==========================================
    // SCENARIO 1: ADMIN SENDS #thanks (PURCHASE)
    // ==========================================
    // fromMe can be boolean true or string "true" depending on WAHA version/engine
    const isFromMe = payload.fromMe === true || payload.fromMe === 'true';
    
    if (isFromMe) {
        if (bodyRaw.includes('#thanks')) {
            // Admin replied #thanks to a customer
            // WAHA uses payload.to for the recipient, or payload.chatId, or extract from payload.id
            const rawTo = toId || payload.chatId || '';
            const targetPhone = rawTo.replace('@c.us', '').replace('@s.whatsapp.net', '');
            
            console.log('THANKS DEBUG:', JSON.stringify({
                rawTo,
                targetPhone,
                toId,
                chatId: payload.chatId,
                payloadId: payload.id
            }));
            
            if (!targetPhone) {
                // Last resort: try to extract from message ID (format: "true_PHONE@c.us_HASH")
                const idMatch = (payload.id || '').match(/true_(\d+)@/);
                if (idMatch && idMatch[1]) {
                    console.log('THANKS: Extracted phone from message ID:', idMatch[1]);
                    // Recursive call with extracted phone
                    const extractedPhone = idMatch[1];
                    const phone08 = extractedPhone.startsWith('62') ? '0' + extractedPhone.slice(2) : extractedPhone;
                    const phone62 = extractedPhone.startsWith('0') ? '62' + extractedPhone.slice(1) : extractedPhone;
                    
                    try {
                        const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/leads?or=(whatsapp.eq.${extractedPhone},whatsapp.eq.${phone08},whatsapp.eq.${phone62})&order=created_at.desc&limit=1`, {
                            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
                        });
                        
                        if (sbRes.ok) {
                            const leads = await sbRes.json();
                            if (leads && leads.length > 0) {
                                const lead = leads[0];
                                if (lead.status === 'purchased') {
                                    console.log(`#thanks ignored: lead ${lead.short_code} already purchased`);
                                    return res.status(200).json({ ok: true, reason: 'Already purchased', code: lead.short_code });
                                }
                                
                                const phoneForHash = extractedPhone.startsWith('0') ? '62' + extractedPhone.slice(1) : extractedPhone;
                                const hashedPhone = crypto.createHash('sha256').update(phoneForHash).digest('hex');
                                const eventId = `purchase_${lead.short_code || extractedPhone}_${Math.floor(Date.now() / 1000)}`;
                                const purchaseValue = (lead.jumlah || 1) * 149000;
                                
                                await sendToFacebookCAPI(hashedPhone, payload, lead.fbc, lead.fbp, eventId, 'Purchase', purchaseValue);
                                await sendToGA(phoneForHash, eventId, 'Purchase', purchaseValue);
                                
                                await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${lead.id}`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
                                    body: JSON.stringify({ purchased: true, status: 'purchased', purchased_at: new Date().toISOString() })
                                });
                                
                                console.log(`Purchase event sent (from ID) for ${phoneForHash} (code: ${lead.short_code})`);
                                return res.status(200).json({ ok: true, event: 'Purchase', phone: phoneForHash, source: 'id_extraction' });
                            }
                        }
                    } catch (err) {
                        console.error("Error processing Purchase event (ID extraction):", err);
                    }
                }
                
                return res.status(200).json({ ok: true, reason: '#thanks but no target phone found' });
            }
            
            try {
                // Normalize phone: user may have saved as 08xxx, we get 628xxx from WAHA
                // Try both formats
                const phone08 = targetPhone.startsWith('62') ? '0' + targetPhone.slice(2) : targetPhone;
                const phone62 = targetPhone.startsWith('0') ? '62' + targetPhone.slice(1) : targetPhone;
                
                console.log('THANKS LOOKUP:', JSON.stringify({ targetPhone, phone08, phone62 }));
                
                const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/leads?or=(whatsapp.eq.${targetPhone},whatsapp.eq.${phone08},whatsapp.eq.${phone62})&order=created_at.desc&limit=1`, {
                    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
                });
                
                if (sbRes.ok) {
                    const leads = await sbRes.json();
                    console.log('THANKS LEADS FOUND:', leads.length, leads.length > 0 ? `code: ${leads[0].short_code}, status: ${leads[0].status}` : 'none');
                    
                    if (leads && leads.length > 0) {
                        const lead = leads[0];
                        
                        // Cegah double purchase: skip jika sudah pernah purchased
                        if (lead.status === 'purchased') {
                            console.log(`#thanks ignored: lead ${lead.short_code} already purchased`);
                            return res.status(200).json({ ok: true, reason: 'Already purchased', code: lead.short_code });
                        }
                        
                        // Hash phone (always use 62 format for consistency)
                        const phoneForHash = targetPhone.startsWith('0') ? '62' + targetPhone.slice(1) : targetPhone;
                        const hashedPhone = crypto.createHash('sha256').update(phoneForHash).digest('hex');
                        const eventId = `purchase_${lead.short_code || targetPhone}_${Math.floor(Date.now() / 1000)}`;
                        
                        const purchaseValue = (lead.jumlah || 1) * 149000;
                        
                        // Send Purchase to FB CAPI
                        console.log('SENDING FB CAPI Purchase...');
                        await sendToFacebookCAPI(hashedPhone, payload, lead.fbc, lead.fbp, eventId, 'Purchase', purchaseValue);
                        // Send Purchase to GA
                        console.log('SENDING GA Purchase...');
                        await sendToGA(phoneForHash, eventId, 'Purchase', purchaseValue);
                        
                        // Update Supabase
                        await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${lead.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
                            body: JSON.stringify({ purchased: true, status: 'purchased', purchased_at: new Date().toISOString() })
                        });
                        
                        console.log(`Purchase event sent for ${phoneForHash} (code: ${lead.short_code})`);
                        return res.status(200).json({ ok: true, event: 'Purchase', phone: phoneForHash });
                    } else {
                        console.log(`#thanks received but no lead found for phone: ${targetPhone}`);
                    }
                } else {
                    console.error('Supabase lookup failed:', sbRes.status, await sbRes.text());
                }
            } catch (err) {
                console.error("Error processing Purchase event:", err);
            }
        }
        return res.status(200).json({ ok: true, reason: 'Own message ignored' });
    }

    // ==========================================
    // SCENARIO 2: CUSTOMER SENDS LEAD MESSAGE
    // ==========================================
    const isFromLandingPage = bodyRaw.includes('Kode Diskon: CB-') || bodyRaw.includes('Kode Pesanan: CB-');
    if (!isFromLandingPage) {
        return res.status(200).json({ ok: true, lead: false, reason: 'Not from landing page' });
    }

    const phone = fromId.replace('@c.us', '');
    if (!phone) return res.status(400).json({ error: 'No phone number provided' });

    let fbc = '';
    let fbp = '';
    
    // Check if it's the new short code format: Kode Pesanan: CB-XXXXXX
    const shortCodeMatch = bodyRaw.match(/(Kode Pesanan|Kode Diskon): CB-([A-Z0-9]{6})\b/i);
    let shortCode = null;
    
    if (shortCodeMatch && shortCodeMatch[2]) {
        shortCode = shortCodeMatch[2].toUpperCase();
        try {
            // Lookup fbc/fbp from Supabase
            const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/leads?short_code=eq.${shortCode}&select=id,fbc,fbp`, {
                headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
            });
            
            if (sbRes.ok) {
                const leads = await sbRes.json();
                if (leads && leads.length > 0) {
                    fbc = leads[0].fbc || '';
                    fbp = leads[0].fbp || '';
                    
                    // Update wa_confirmed
                    await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leads[0].id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
                        body: JSON.stringify({ wa_confirmed: true, status: 'wa_confirmed', confirmed_at: new Date().toISOString() })
                    });
                }
            }
        } catch (err) {
            console.error("Error fetching lead from Supabase:", err);
        }
    } else {
        // Fallback for old format
        const refMatch = bodyRaw.match(/(Kode Pesanan|Kode Diskon): CB-[0-9]+\|?([^|\n]*)\|?([^\n]*)/);
        if (refMatch) {
            if (refMatch[2] && refMatch[2].startsWith('fb.')) fbc = refMatch[2];
            if (refMatch[3] && refMatch[3].startsWith('fb.')) fbp = refMatch[3];
        }
    }

    const hourBlock = Math.floor(Date.now() / 3600000);
    const hashedPhone = crypto.createHash('sha256').update(phone).digest('hex');
    const eventId = crypto.createHash('sha256').update('lead_cbapi_' + phone + '_' + hourBlock).digest('hex');

    let isSuccess = true;
    let errors = [];

    // Send to FB as "Lead" (Standard event)
    try {
        await sendToFacebookCAPI(hashedPhone, payload, fbc, fbp, eventId, 'Lead', null);
    } catch (e) {
        console.error('Error sending to FB CAPI:', e);
        isSuccess = false;
        errors.push('FB CAPI Error: ' + e.message);
    }

    // Send to GA
    try {
        await sendToGA(phone, eventId, 'Lead_CBAPI', null);
    } catch (e) {
        console.error('Error sending to GA:', e);
        isSuccess = false;
        errors.push('GA Error: ' + e.message);
    }

    return res.status(200).json({ 
        ok: isSuccess, 
        event: 'Lead',
        phone: phone,
        errors: errors.length > 0 ? errors : undefined
    });
};


// ============================================
// FACEBOOK CAPI
// ============================================
async function sendToFacebookCAPI(hashedPhone, payload, fbc, fbp, eventId, eventName = 'Lead', customValue = null) {
    const PIXEL_ID = process.env.PIXEL_ID;
    const ACCESS_TOKEN = process.env.CAPI_ACCESS_TOKEN;

    if (!PIXEL_ID || !ACCESS_TOKEN) return;

    var userData = {
        ph: [hashedPhone],
        client_user_agent: 'WAHA-Webhook/1.0'
    };
    if (fbc) userData.fbc = fbc;
    if (fbp) userData.fbp = fbp;

    const customData = {
        content_name: 'Food & Life Balancing Ala Nabi',
        event_source: 'whatsapp_confirmed'
    };
    
    if (customValue !== null) {
        customData.value = customValue;
        customData.currency = 'IDR';
    }

    const data = {
        data: [{
            event_name: eventName,
            event_id: eventId,
            event_time: Math.floor(Date.now() / 1000),
            event_source_url: 'https://cordoba-books-ybg6.vercel.app/',
            action_source: 'website',
            user_data: userData,
            custom_data: customData
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
        throw new Error(`FB CAPI failed: ${response.status} ${await response.text()}`);
    }
}

// ============================================
// GOOGLE ANALYTICS
// ============================================
async function sendToGA(phone, eventId, eventName, customValue = null) {
    const GA_ID = process.env.GA_MEASUREMENT_ID;
    const GA_SECRET = process.env.GA_API_SECRET;

    if (!GA_ID || !GA_SECRET) return;
    
    const params = {
        source: 'whatsapp',
        content: 'Food & Life Balancing Ala Nabi',
        event_id: eventId
    };
    
    if (customValue !== null) {
        params.value = customValue;
        params.currency = 'IDR';
    }

    const response = await fetch(
        `https://www.google-analytics.com/mp/collect?measurement_id=${GA_ID}&api_secret=${GA_SECRET}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: phone,
                events: [{
                    name: eventName,
                    params: params
                }]
            })
        }
    );

    if (!response.ok) {
        throw new Error(`GA MP failed: ${response.status} ${await response.text()}`);
    }
}
