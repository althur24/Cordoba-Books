const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const WAHA_API_KEY = process.env.WAHA_API_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        return res.status(500).json({ error: 'Supabase credentials missing' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // --- GET: Dipanggil oleh Admin Dashboard untuk mengecek status terakhir ---
    if (req.method === 'GET') {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing or invalid token' });
        }
        const token = authHeader.split(' ')[1];
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        try {
            const { data, error } = await supabase
                .from('waha_logs')
                .select('status, created_at')
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (error) {
                // Jika error karena tabel belum ada atau kosong
                return res.status(200).json({ status: 'UNKNOWN', message: 'Belum ada data status' });
            }

            return res.status(200).json({ 
                status: data.status, 
                last_update: data.created_at 
            });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    // --- POST: Dipanggil oleh WAHA webhook ketika ada perubahan status (session.status) ---
    if (req.method === 'POST') {
        const { key } = req.query;

        // Verifikasi kunci (opsional tapi sangat disarankan)
        if (WAHA_API_KEY && key !== WAHA_API_KEY) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const body = req.body;
        
        // Memastikan event yang masuk adalah session.status
        if (body.event === 'session.status') {
            const status = body.payload?.status || 'UNKNOWN';
            
            try {
                // Simpan status baru ke tabel waha_logs
                const { error } = await supabase
                    .from('waha_logs')
                    .insert([
                        { status: status }
                    ]);

                if (error) {
                    console.error("Supabase insert error:", error);
                    return res.status(500).json({ error: 'Database error' });
                }

                return res.status(200).json({ success: true, logged_status: status });
            } catch (e) {
                return res.status(500).json({ error: e.message });
            }
        }

        // Jika bukan event session.status, abaikan saja (biarkan webhook lain yang urus di webhook.js)
        return res.status(200).json({ message: 'Event diabaikan, bukan session.status' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
