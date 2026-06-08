const { createClient } = require('@supabase/supabase-js');

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
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        return res.status(500).json({ error: 'Server configuration error' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    try {
        // 1. Verify user JWT
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        
        if (authError || !user) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        // 2. Fetch all leads using service role
        // Parse query params for filtering
        const { status, from, to } = req.query;
        
        let query = supabase
            .from('leads')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (status) {
            query = query.eq('status', status);
        }
        
        if (from && to) {
            query = query.gte('created_at', from).lte('created_at', to);
        }

        const { data: leads, error: leadsError } = await query;

        if (leadsError) {
            throw new Error(`Failed to fetch leads: ${leadsError.message}`);
        }

        return res.status(200).json({ leads: leads || [] });
    } catch (error) {
        console.error("Admin leads error:", error);
        return res.status(500).json({ error: error.message });
    }
};
