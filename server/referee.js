require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: "postgresql://postgres.ehqbshrasyztadybvfzp:mG09CvCCASo6R5cd@aws-1-us-west-1.pooler.supabase.com:6543/postgres",
    ssl: { rejectUnauthorized: false }
});

function getMedian(values) {
    if (values.length === 0) return 0;
    values.sort((a, b) => a - b);
    const half = Math.floor(values.length / 2);
    if (values.length % 2) return values[half];
    return (values[half - 1] + values[half]) / 2.0;
}

async function flagOutliers() {
    console.log("👮‍♂️ Referee started: Enforcing the 'Distance >= 3' Rule...");

    try {
        const { rows: groups } = await pool.query(`
            SELECT DISTINCT team_id, week_number FROM rankings
        `);

        let outlierCount = 0;

        for (const group of groups) {
            // Select outlier_approved status along with other data
            const { rows: ranks } = await pool.query(`
                SELECT id, rank_number, source_id, outlier_approved FROM rankings 
                WHERE team_id = $1 AND week_number = $2
            `, [group.team_id, group.week_number]);

            if (ranks.length < 3) continue; 

            const values = ranks.map(r => r.rank_number);
            const median = getMedian(values);

            for (const rank of ranks) {
                // RULE 0: If user approved it, ignore it forever.
                if (rank.outlier_approved) {
                    continue; 
                }

                const distance = Math.abs(rank.rank_number - median);
                const isOutlier = distance >= 3; 

                if (isOutlier) {
                    console.log(`🚩 FLAGGED: Team ${group.team_id} (Week ${group.week_number}) - Rank ${rank.rank_number} is ${distance} spots away from Median ${median}`);
                    await pool.query(`UPDATE rankings SET is_outlier = TRUE WHERE id = $1`, [rank.id]);
                    outlierCount++;
                } else {
                    await pool.query(`UPDATE rankings SET is_outlier = FALSE WHERE id = $1`, [rank.id]);
                }
            }
        }
        console.log(`✅ Referee finished. Total active outliers: ${outlierCount}`);
    } catch (err) {
        console.error("Referee Error:", err);
    } finally {
        await pool.end();
    }
}

flagOutliers();