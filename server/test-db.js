const { Pool } = require('pg');

// This is the exact string currently in your server/index.js
const pool = new Pool({
    connectionString: "postgresql://postgres.ehqbshrasyztadybvfzp:mG09CvCCASo6R5cd@aws-1-us-west-1.pooler.supabase.com:6543/postgres",
    ssl: { rejectUnauthorized: false }
});

async function testConnection() {
    console.log("🔌 Attempting to connect...");
    try {
        const res = await pool.query('SELECT NOW()');
        console.log("✅ SUCCESS! Connected to Database.");
        console.log("Time from DB:", res.rows[0].now);
    } catch (err) {
        console.error("❌ CONNECTION FAILED:");
        console.error(err.message);
        
        if (err.message.includes("password")) {
            console.log("\n💡 HINT: Your password might be wrong. Reset it in Supabase Settings -> Database.");
        } else if (err.message.includes("addrinfo")) {
            console.log("\n💡 HINT: Your Host URL (aws-1-...) might be wrong.");
        } else if (err.message.includes("Tenant")) {
            console.log("\n💡 HINT: You are using the wrong Project ID in the user field.");
        }
    } finally {
        await pool.end();
    }
}

testConnection();