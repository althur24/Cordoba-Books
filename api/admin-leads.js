module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        return res.status(405).end('Method Not Allowed');
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing token' });
    }

    const token = authHeader.split(' ')[1];

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return res.status(500).json({ error: 'Server config error', detail: 'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY' });
    }

    try {
        // 1. Verify user JWT via Supabase Auth REST API (uses ANON KEY)
        const verifyKey = SUPABASE_ANON_KEY || SUPABASE_SERVICE_KEY;
        const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: {
                'apikey': verifyKey,
                'Authorization': `Bearer ${token}`
            }
        });

        if (!userRes.ok) {
            const errText = await userRes.text();
            return res.status(401).json({ error: 'Invalid or expired token', detail: errText });
        }

        const user = await userRes.json();
        if (!user || !user.id) {
            return res.status(401).json({ error: 'Unauthorized user' });
        }

        // 2. Fetch leads using SERVICE KEY (bypasses RLS)
        const { status, from, to } = req.query;
        let queryStr = '?select=*&order=created_at.desc';
        
        if (status) {
            queryStr += `&status=eq.${status}`;
        }
        if (from && to) {
            queryStr += `&created_at=gte.${from}&created_at=lte.${to}`;
        }

        const leadsRes = await fetch(`${SUPABASE_URL}/rest/v1/leads${queryStr}`, {
            headers: {
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
            }
        });

        if (!leadsRes.ok) {
            const errText = await leadsRes.text();
            return res.status(500).json({ error: 'Failed to fetch leads', detail: errText });
        }

        const leads = await leadsRes.json();
        return res.status(200).json({ leads: leads || [] });

    } catch (error) {
        console.error("Admin leads error:", error);
        return res.status(500).json({ error: error.message });
    }
};
