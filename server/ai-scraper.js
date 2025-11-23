require('dotenv').config();
const { chromium } = require('playwright');
const { Readability } = require('@mozilla/readability');
const { JSDOM, VirtualConsole } = require('jsdom');
const TurndownService = require('turndown');
const OpenAI = require('openai');
const { Pool } = require('pg');

// 1. SETUP
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Silent Console
const virtualConsole = new VirtualConsole();
virtualConsole.on("error", () => { });
virtualConsole.on("jsdomError", () => { });

const turndownService = new TurndownService({ 
    headingStyle: 'atx',
    codeBlockStyle: 'fenced' 
});

// THE MAP
const TEAM_MAP_TEXT = `
1: Arizona Cardinals (Cards)
2: Atlanta Falcons
3: Baltimore Ravens
4: Buffalo Bills
5: Carolina Panthers
6: Chicago Bears
7: Cincinnati Bengals
8: Cleveland Browns
9: Dallas Cowboys
10: Denver Broncos
11: Detroit Lions
12: Green Bay Packers
13: Houston Texans
14: Indianapolis Colts
15: Jacksonville Jaguars (Jags)
16: Kansas City Chiefs (KC)
17: Las Vegas Raiders (LV)
18: Los Angeles Chargers (Bolts)
19: Los Angeles Rams
20: Miami Dolphins
21: Minnesota Vikings
22: New England Patriots (Pats)
23: New Orleans Saints
24: New York Giants (G-Men)
25: New York Jets
26: Philadelphia Eagles (Birds)
27: Pittsburgh Steelers
28: San Francisco 49ers (Niners)
29: Seattle Seahawks
30: Tampa Bay Buccaneers (Bucs)
31: Tennessee Titans
32: Washington Commanders
`;

async function scrapeWithPlaywright(url, sourceId, weekNumber) {
    console.log(`\n🚀 Launching Browser for: ${url}`);
    
    // Add arguments to make the browser lighter and stealthier
    const browser = await chromium.launch({ 
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
        ]
    });
    
    try {
        const page = await browser.newPage();
        
        // BLOCK HEAVY ASSETS
        // We added 'websocket' and 'manifest' to stop live tickers/ads from hanging the connection
        await page.route('**/*', (route) => {
            const request = route.request();
            const resourceType = request.resourceType();
            if (['image', 'stylesheet', 'font', 'media', 'websocket', 'manifest'].includes(resourceType)) {
                route.abort();
            } else {
                route.continue();
            }
        });

        // CRITICAL FIX: "Soft Timeout"
        // We set a 30s timeout. If it fails (likely due to ads), we catch the error 
        // and proceed anyway because the text is probably already there.
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (e) {
            console.log(`⚠️ Page load timed out (likely stuck on ads). Attempting to scrape text anyway...`);
        }

        const html = await page.content();
        
        const doc = new JSDOM(html, { url, virtualConsole });
        
        // CLEANER
        const noiseSelectors = [
            'nav', 'footer', 'script', 'style', 
            '.related-content', '.ob-widget', '.taboola', 
            '.advertisement', '.ad-container', 'iframe'
        ];
        noiseSelectors.forEach(sel => {
            const elements = doc.window.document.querySelectorAll(sel);
            elements.forEach(el => el.remove());
        });

        const reader = new Readability(doc.window.document);
        const article = reader.parse();

        if (!article) throw new Error("Readability failed to parse article.");

        const markdown = turndownService.turndown(article.content);
        const cleanText = markdown.substring(0, 60000); 

        console.log("🧠 Sending Markdown to GPT-4o...");

        const completion = await openai.chat.completions.create({
            model: "gpt-4o", 
            messages: [
                {
                    role: "system",
                    content: `You are an expert NFL Data Extractor.
                    
                    YOUR MISSION: 
                    Extract the official 1-32 Power Rankings list from the provided Markdown text.
                    
                    CONTEXT MAP (Team Name -> ID):
                    ${TEAM_MAP_TEXT}
                    
                    CRITICAL EXTRACTION ALGORITHM:
                    1. **Scan for Sequence:** Look for a sequential list from 1 to 32. Do NOT pick isolated numbers. If you see "1. Chiefs" ... "2. Bills", that is the pattern.
                    2. **Distinguish Rank vs Record:** - "10-2" is a record. IGNORE.
                       - "1. Chiefs" is a rank. KEEP.
                       - "Rank 1" is a rank. KEEP.
                       - "(1)" is often a previous rank. If you see "1 (2) Chiefs", the rank is 1.
                    3. **Distinguish Subject vs Object:**
                       - Text: "The Chiefs (1) beat the Bills (2)." -> This is narrative text. IGNORE.
                       - Text: "## 1. Kansas City Chiefs" -> This is a header/list item. EXTRACT.
                    4. **Handle Formatting Noise:**
                       - Yahoo Style: "1 (1): Eagles" -> Rank is 1.
                       - Fox/Athletic Style: "#1. Rams" -> Rank is 1.
                       - Messy/Repeated: "Rank 1 1 Rams Rams" -> Rank is 1, Team is Rams.
                    
                    OUTPUT VALIDATION:
                    - You MUST return exactly 32 unique teams.
                    - If multiple teams seem to have the same rank, prioritize the one formatted as a Header or List Item.
                    
                    OUTPUT: JSON Object with a 'rankings' list.`
                },
                { role: "user", content: cleanText }
            ],
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "nfl_rankings",
                    schema: {
                        type: "object",
                        properties: {
                            rankings: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        team_id: { type: "integer", description: "1-32 only" },
                                        rank: { type: "integer", description: "1-32 only" }
                                    },
                                    required: ["team_id", "rank"],
                                    additionalProperties: false
                                }
                            }
                        },
                        required: ["rankings"],
                        additionalProperties: false
                    },
                    strict: true
                }
            }
        });

        const result = JSON.parse(completion.choices[0].message.content);
        const data = result.rankings;
        
        console.log(`✅ Extracted ${data.length} teams.`);

        if (data.length !== 32) {
            console.warn(`⚠️ WARNING: Found ${data.length} teams. Expected 32.`);
        }

        for (const item of data) {
            if (item.team_id < 1 || item.team_id > 32) continue;

            const query = `
                INSERT INTO rankings (team_id, source_id, rank_number, week_number) 
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (team_id, source_id, week_number) 
                DO UPDATE SET rank_number = EXCLUDED.rank_number, created_at = NOW();
            `;
            await pool.query(query, [item.team_id, sourceId, item.rank, weekNumber]);
        }
        console.log("💾 Saved!");

    } catch (err) {
        console.error(`❌ Error: ${err.message}`);
    } finally {
        await browser.close();
    }
}

// --- WEEKLY JOBS CONFIGURATION ---
const CURRENT_WEEK = 1;

const JOBS = [
    { name: "ESPN", sourceId: 1, url: 'https://www.espn.com/nfl/story/_/id/46999579/nfl-week-12-power-rankings-poll-32-teams-2025-pressure-players-coaches-executives' },
    { name: "NFL.com", sourceId: 2, url: 'https://www.nfl.com/news/nfl-power-rankings-week-12-2025-nfl-season' },
    { name: "CBS", sourceId: 3, url: 'https://www.cbssports.com/nfl/powerrankings/' },
    { name: "Bleacher Report", sourceId: 4, url: 'https://bleacherreport.com/articles/25296763-br-experts-week-12-nfl-power-rankings' },
    { name: "USA Today", sourceId: 5, url: 'https://www.usatoday.com/story/sports/nfl/columnist/nate-davis/2025/11/18/nfl-power-rankings-week-12-rams-seahawks-patriots-eagles/87330640007/' },
    { name: "Yahoo", sourceId: 6, url: 'https://sports.yahoo.com/nfl/article/nfl-power-rankings-entering-week-12-will-the-chiefs-really-miss-the-playoffs-042413723.html' },
    { name: "SI.com", sourceId: 7, url: 'https://www.si.com/nfl/week-12-power-rankings-top-five-shuffle-leads-to-new-no-1-team' },
    { name: "The Athletic", sourceId: 8, url: 'https://www.nytimes.com/athletic/6814386/2025/11/18/nfl-power-rankings-week-12-bills-broncos-bears/' },
    { name: "Fox Sports", sourceId: 9, url: 'https://www.foxsports.com/stories/nfl/2025-nfl-power-rankings-week-12-which-division-leaders-do-we-trust' },
    { name: "Sporting News", sourceId: 10, url: 'https://www.sportingnews.com/us/nfl/news/nfl-power-rankings-broncos-bears-49ers-chiefs-lions-chargers/267162df3da0260818558163' },
];

async function run() {
    for (const job of JOBS) {
        if (job.url) await scrapeWithPlaywright(job.url, job.sourceId, CURRENT_WEEK);
    }
    await pool.end();
}

run();