require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// --- SECURITY CONFIGURATION ---
// The password now lives HERE, on the server, where nobody can see it.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Touchdown2025";

const pool = new Pool({
    connectionString: "postgresql://postgres.ehqbshrasyztadybvfzp:mG09CvCCASo6R5cd@aws-1-us-west-1.pooler.supabase.com:6543/postgres",
    ssl: { rejectUnauthorized: false } 
});

// --- ROUTES ---

// 1. Login Check (New Route)
// This allows the frontend to ask "Is this password correct?" without knowing the secret.
app.post('/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: "Invalid Password" });
    }
});

// 2. Get Rankings
app.get('/rankings', async (req, res) => {
    const week = req.query.week || 1; 
    try {
        const query = `
            SELECT 
                t.name, t.logo_url,
                ROUND(AVG(r.rank_number), 1) as consensus_score,
                json_agg(json_build_object(
                    'id', r.id,               
                    'source', s.name, 
                    'rank', r.rank_number, 
                    'is_outlier', r.is_outlier,
                    'outlier_approved', r.outlier_approved 
                )) as source_ranks
            FROM rankings r
            JOIN teams t ON r.team_id = t.id
            JOIN sources s ON r.source_id = s.id
            WHERE r.week_number = $1 
            GROUP BY t.id
            ORDER BY consensus_score ASC;
        `;
        const { rows } = await pool.query(query, [week]);
        res.json(rows);
    } catch (err) { 
        console.error("DB ERROR:", err.message); 
        res.status(500).send(err.message); 
    }
});

app.get('/weeks', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT DISTINCT week_number FROM rankings ORDER BY week_number ASC');
        const weekList = rows.map(row => row.week_number);
        res.json(weekList);
    } catch (err) { console.error(err); }
});

app.get('/teams', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM teams ORDER BY name ASC');
        res.json(rows);
    } catch (err) { console.error(err); }
});

app.get('/sources', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM sources ORDER BY id ASC');
        res.json(rows);
    } catch (err) { console.error(err); }
});

// 3. Submit Rankings (SECURED)
app.post('/submit-rankings', async (req, res) => {
    const { team_id, week, ranks, password } = req.body; // We now expect a password
    
    // SECURITY CHECK
    if (password !== ADMIN_PASSWORD) {
        console.log("⛔ Blocked unauthorized save attempt.");
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    console.log(`📝 Saving rankings for Team ${team_id}, Week ${week}...`);

    try {
        for (let item of ranks) {
            if (item.value !== null && item.value !== '') {
                const query = `
                    INSERT INTO rankings (team_id, source_id, rank_number, week_number) 
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (team_id, source_id, week_number) 
                    DO UPDATE SET 
                        rank_number = EXCLUDED.rank_number, 
                        created_at = NOW(),
                        is_outlier = FALSE,
                        outlier_approved = FALSE
                `;
                await pool.query(query, [team_id, item.source_id, item.value, week]);
            }
        }
        console.log("✅ Save successful!");
        res.json({ success: true });
    } catch (err) {
        console.error("❌ Save Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. Approve Outlier (SECURED)
app.post('/approve-outlier', async (req, res) => {
    const { ranking_id, password } = req.body; // Expect password

    // SECURITY CHECK
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    try {
        await pool.query(`
            UPDATE rankings 
            SET outlier_approved = TRUE, is_outlier = FALSE 
            WHERE id = $1
        `, [ranking_id]);
        
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to approve" });
    }
});

app.listen(3000, () => console.log('✅ Backend running on port 3000'));