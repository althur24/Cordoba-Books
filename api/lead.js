const crypto = require('crypto');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).end('Method Not Allowed');
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        console.error("Missing Supabase credentials");
        return res.status(500).json({ error: 'Server configuration error' });
    }

    try {
        const data = req.body;
        
        // Generate short code (6 uppercase alphanumeric characters)
        const shortCode = crypto.randomBytes(3).toString('hex').toUpperCase();

        const leadData = {
            short_code: shortCode,
            nama: data.nama || '',
            whatsapp: data.whatsapp || '',
            alamat: data.alamat || '',
            jumlah: parseInt(data.jumlah) || 1,
            fbc: data.fbc || null,
            fbp: data.fbp || null,
            status: 'form_submitted'
        };

        // Insert to Supabase via REST API
        const response = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(leadData)
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Supabase error: ${err}`);
        }

        return res.status(200).json({ success: true, shortCode: shortCode });
    } catch (error) {
        console.error("Error saving lead:", error);
        return res.status(500).json({ error: error.message });
    }
};
