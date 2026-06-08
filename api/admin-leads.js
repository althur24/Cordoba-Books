module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        return res.status(405).end('Method Not Allowed');
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        return res.status(500).json({ error: 'Server configuration error' });
    }

    try {
        // 1. Verify user JWT by fetching their profile
        const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${token}`
            }
        });

        if (!userRes.ok) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        const user = await userRes.json();
        if (!user || !user.id) {
            return res.status(401).json({ error: 'Unauthorized user' });
        }

        // 2. Fetch all leads using service role
        // Parse query params for filtering
        const { status, from, to } = req.query;
        let queryStr = '?order=created_at.desc';
        
        if (status) {
            queryStr += `&status=eq.${status}`;
        }
        
        if (from && to) {
            queryStr += `&created_at=gte.${from}&created_at=lte.${to}`;
        }

        const leadsRes = await fetch(`${SUPABASE_URL}/rest/v1/leads${queryStr}`, {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`
            }
        });

        if (!leadsRes.ok) {
            throw new Error(`Failed to fetch leads: ${await leadsRes.text()}`);
        }

        const leads = await leadsRes.json();

        return res.status(200).json({ leads: leads });
    } catch (error) {
        console.error("Admin leads error:", error);
        return res.status(500).json({ error: error.message });
    }
};
