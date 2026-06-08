module.exports = async (req, res) => {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const WAHA_API_KEY = process.env.WAHA_API_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return res.status(500).json({ error: 'Supabase credentials missing' });
    }

    const verifyKey = SUPABASE_ANON_KEY || SUPABASE_SERVICE_KEY;

    // --- GET: Dashboard admin mengecek status WAHA terakhir ---
    if (req.method === 'GET') {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing or invalid token' });
        }
        const token = authHeader.split(' ')[1];

        // Verify JWT
        const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: { 'apikey': verifyKey, 'Authorization': `Bearer ${token}` }
        });
        if (!userRes.ok) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        try {
            const dataRes = await fetch(`${SUPABASE_URL}/rest/v1/waha_logs?select=status,created_at&order=created_at.desc&limit=1`, {
                headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` }
            });

            if (!dataRes.ok) {
                return res.status(200).json({ status: 'UNKNOWN', message: 'Belum ada data status' });
            }

            const rows = await dataRes.json();
            if (!rows || rows.length === 0) {
                return res.status(200).json({ status: 'UNKNOWN', message: 'Belum ada data status' });
            }

            return res.status(200).json({
                status: rows[0].status,
                last_update: rows[0].created_at
            });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    // --- POST: WAHA mengirim event session.status ---
    if (req.method === 'POST') {
        const { key } = req.query;

        if (WAHA_API_KEY && key !== WAHA_API_KEY) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const body = req.body;

        if (body.event === 'session.status') {
            const status = body.payload?.status || 'UNKNOWN';

            try {
                const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/waha_logs`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': SUPABASE_SERVICE_KEY,
                        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
                    },
                    body: JSON.stringify({ status: status })
                });

                if (!insertRes.ok) {
                    const errText = await insertRes.text();
                    console.error("Supabase insert error:", errText);
                    return res.status(500).json({ error: 'Database error' });
                }

                return res.status(200).json({ success: true, logged_status: status });
            } catch (e) {
                return res.status(500).json({ error: e.message });
            }
        }

        return res.status(200).json({ message: 'Event diabaikan, bukan session.status' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
};
