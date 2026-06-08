// Diagnostic endpoint - cek apakah Vercel functions berjalan
module.exports = async (req, res) => {
    const info = {
        ok: true,
        node_version: process.version,
        has_fetch: typeof fetch !== 'undefined',
        env_keys: {
            SUPABASE_URL: !!process.env.SUPABASE_URL,
            SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
            SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
            WAHA_API_KEY: !!process.env.WAHA_API_KEY,
            PIXEL_ID: !!process.env.PIXEL_ID,
            CAPI_ACCESS_TOKEN: !!process.env.CAPI_ACCESS_TOKEN,
        },
        timestamp: new Date().toISOString()
    };
    return res.status(200).json(info);
};
