module.exports = async (req, res) => {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        return res.status(500).json({ error: 'Server configuration error' });
    }

    // Auth check
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token' });

    try {
        const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${token}` }
        });
        if (!userRes.ok) return res.status(401).json({ error: 'Unauthorized' });
    } catch (e) {
        return res.status(401).json({ error: 'Auth failed' });
    }

    // GET: fetch ad spend + settings
    if (req.method === 'GET') {
        try {
            const [spendRes, settingsRes] = await Promise.all([
                fetch(`${SUPABASE_URL}/rest/v1/ad_spend?order=date.desc`, {
                    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
                }),
                fetch(`${SUPABASE_URL}/rest/v1/settings?select=key,value`, {
                    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
                })
            ]);
            
            const adSpend = spendRes.ok ? await spendRes.json() : [];
            const settingsArr = settingsRes.ok ? await settingsRes.json() : [];
            
            // Convert settings array to object
            const settings = {};
            (settingsArr || []).forEach(s => { settings[s.key] = s.value; });
            
            return res.status(200).json({ ad_spend: adSpend || [], settings });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    // POST: handle different actions
    if (req.method === 'POST') {
        const { _action } = req.body;
        
        // Action: update lead processed checkbox + payment method
        if (_action === 'update_processed') {
            const { leadId, processed, payment_method } = req.body;
            if (!leadId) return res.status(400).json({ error: 'leadId required' });
            
            try {
                const updateData = { 
                    processed: processed === true,
                    processed_at: processed ? new Date().toISOString() : null,
                    payment_method: processed ? (payment_method || null) : null
                };
                const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': SUPABASE_KEY,
                        'Authorization': `Bearer ${SUPABASE_KEY}`
                    },
                    body: JSON.stringify(updateData)
                });
                if (!patchRes.ok) {
                    return res.status(500).json({ error: 'Failed to update lead', detail: await patchRes.text() });
                }
                return res.status(200).json({ ok: true });
            } catch (e) {
                return res.status(500).json({ error: e.message });
            }
        }

        // Action: update a setting
        if (_action === 'update_setting') {
            const { key, value } = req.body;
            if (!key) return res.status(400).json({ error: 'key required' });
            
            try {
                const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/settings?on_conflict=key`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': SUPABASE_KEY,
                        'Authorization': `Bearer ${SUPABASE_KEY}`,
                        'Prefer': 'resolution=merge-duplicates'
                    },
                    body: JSON.stringify({ key, value: String(value), updated_at: new Date().toISOString() })
                });
                if (!upsertRes.ok) {
                    return res.status(500).json({ error: 'Failed to save setting', detail: await upsertRes.text() });
                }
                return res.status(200).json({ ok: true });
            } catch (e) {
                return res.status(500).json({ error: e.message });
            }
        }
        
        // Action: upsert ad spend
        const { date, amount, tax_rate, notes } = req.body;
        if (!date) return res.status(400).json({ error: 'date is required' });

        const payload = {
            date,
            amount: parseFloat(amount) || 0,
            tax_rate: tax_rate !== undefined ? parseFloat(tax_rate) : 11,
            notes: notes || null,
            updated_at: new Date().toISOString()
        };

        try {
            // Try upsert with on_conflict parameter
            const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/ad_spend?on_conflict=date`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Prefer': 'resolution=merge-duplicates,return=representation'
                },
                body: JSON.stringify(payload)
            });

            if (upsertRes.ok) {
                const data = await upsertRes.json();
                return res.status(200).json({ ok: true, ad_spend: data[0] || data });
            }

            // If upsert fails, try PATCH (update existing)
            const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/ad_spend?date=eq.${date}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify({
                    amount: payload.amount,
                    tax_rate: payload.tax_rate,
                    notes: payload.notes,
                    updated_at: payload.updated_at
                })
            });

            if (patchRes.ok) {
                const data = await patchRes.json();
                return res.status(200).json({ ok: true, ad_spend: data[0] || data });
            }

            const errText = await patchRes.text();
            return res.status(500).json({ error: 'Failed to save ad_spend', detail: errText });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
};
