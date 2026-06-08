module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        return res.status(405).end('Method Not Allowed');
    }

    return res.status(200).json({
        SUPABASE_URL: process.env.SUPABASE_URL || 'https://qvrqndgulauhzyzrxepc.supabase.co',
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2cnFuZGd1bGF1aHp5enJ4ZXBjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4OTg3NjYsImV4cCI6MjA5NjQ3NDc2Nn0.ftEtn7VG6-7WikEXCVc63a4mPQ4D1TZep2Etg45TwDU'
    });
};
