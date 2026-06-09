const crypto = require('crypto');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).end('Method Not Allowed');
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const PIXEL_ID = process.env.PIXEL_ID;
    const ACCESS_TOKEN = process.env.CAPI_ACCESS_TOKEN;
    const GA_MEASUREMENT_ID = process.env.GA_MEASUREMENT_ID;
    const GA_API_SECRET = process.env.GA_API_SECRET;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return res.status(500).json({ error: 'Server config error' });
    }

    try {
        // 1. Verify JWT
        const verifyKey = SUPABASE_ANON_KEY || SUPABASE_SERVICE_KEY;
        const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: { 'apikey': verifyKey, 'Authorization': `Bearer ${token}` }
        });
        if (!userRes.ok) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        const { leadId, newStatus } = req.body;
        if (!leadId || !newStatus) {
            return res.status(400).json({ error: 'leadId and newStatus required' });
        }

        // 2. Fetch the lead first
        const leadRes = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}&select=*`, {
            headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` }
        });

        if (!leadRes.ok) {
            return res.status(500).json({ error: 'Failed to fetch lead' });
        }

        const leads = await leadRes.json();
        if (!leads || leads.length === 0) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        const lead = leads[0];

        // 3. Prevent downgrade: can't go from purchased back to form_submitted
        if (lead.status === 'purchased' && newStatus !== 'purchased') {
            return res.status(400).json({ error: 'Cannot change status from purchased' });
        }

        // 4. Build update payload
        const updateData = { status: newStatus };

        if (newStatus === 'wa_confirmed') {
            updateData.wa_confirmed = true;
            updateData.confirmed_at = new Date().toISOString();
        }

        if (newStatus === 'purchased') {
            updateData.purchased = true;
            updateData.purchased_at = new Date().toISOString();
        }

        // 5. Update in Supabase
        const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify(updateData)
        });

        if (!patchRes.ok) {
            const errText = await patchRes.text();
            return res.status(500).json({ error: 'Failed to update', detail: errText });
        }

        // 6. If marking as purchased, also send Purchase event to FB CAPI & GA
        if (newStatus === 'purchased' && lead.status !== 'purchased') {
            const phone = lead.whatsapp || '';
            const phone62 = phone.startsWith('0') ? '62' + phone.slice(1) : phone;
            const hashedPhone = crypto.createHash('sha256').update(phone62).digest('hex');
            const eventId = `purchase_manual_${lead.short_code || leadId}_${Math.floor(Date.now() / 1000)}`;
            const purchaseValue = (lead.jumlah || 1) * 149000;

            // Send to Facebook CAPI
            if (PIXEL_ID && ACCESS_TOKEN) {
                try {
                    await fetch(`https://graph.facebook.com/v18.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            data: [{
                                event_name: 'Purchase',
                                event_id: eventId,
                                event_time: Math.floor(Date.now() / 1000),
                                event_source_url: 'https://cordoba-books-ybg6.vercel.app/',
                                action_source: 'website',
                                user_data: {
                                    ph: [hashedPhone],
                                    fbc: lead.fbc || undefined,
                                    fbp: lead.fbp || undefined,
                                    client_user_agent: 'AdminDashboard/1.0'
                                },
                                custom_data: {
                                    value: purchaseValue,
                                    currency: 'IDR',
                                    content_name: 'Food & Life Balancing Ala Nabi',
                                    content_type: 'product',
                                    source: 'manual_admin'
                                }
                            }]
                        })
                    });
                } catch (e) {
                    console.error('FB CAPI manual error:', e);
                }
            }

            // Send to Google Analytics
            if (GA_MEASUREMENT_ID && GA_API_SECRET) {
                try {
                    await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${GA_MEASUREMENT_ID}&api_secret=${GA_API_SECRET}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            client_id: phone62,
                            events: [{
                                name: 'Purchase',
                                params: {
                                    event_id: eventId,
                                    value: purchaseValue,
                                    currency: 'IDR',
                                    source: 'manual_admin'
                                }
                            }]
                        })
                    });
                } catch (e) {
                    console.error('GA manual error:', e);
                }
            }
        }

        return res.status(200).json({ success: true, status: newStatus });

    } catch (error) {
        console.error('Update status error:', error);
        return res.status(500).json({ error: error.message });
    }
};
