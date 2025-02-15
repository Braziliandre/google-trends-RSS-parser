const Parser = require('rss-parser');
const express = require('express');
const parser = new Parser();
const app = express();

// Configuration
const GOOGLE_TRENDS_RSS = 'https://trends.google.com/trends/trendingsearches/daily/rss?geo=US';
const PORT = process.env.PORT || 3000;

let cachedData = null;
let lastFetch = null;

const categories = {
    entertainment: ['movie', 'actor', 'actress', 'film', 'tv', 'show', 'celebrity', 'music', 'song'],
    technology: ['app', 'software', 'device', 'phone', 'computer', 'tech', 'digital'],
    sports: ['game', 'match', 'player', 'team', 'sport', 'tournament', 'championship'],
    politics: ['election', 'politician', 'government', 'policy', 'political', 'vote'],
    business: ['company', 'stock', 'market', 'business', 'economic', 'finance'],
    health: ['medical', 'health', 'disease', 'treatment', 'vaccine', 'medicine']
};

async function classifyTopic(title, description) {
    const text = `${title} ${description}`.toLowerCase();
    const matchedCategories = [];

    for (const [category, keywords] of Object.entries(categories)) {
        if (keywords.some(keyword => text.includes(keyword))) {
            matchedCategories.push(category);
        }
    }

    return matchedCategories.length > 0 ? matchedCategories : ['uncategorized'];
}

async function processTrendingTopics() {
    try {
        const feed = await parser.parseURL(GOOGLE_TRENDS_RSS);
        
        const processedItems = await Promise.all(feed.items.map(async item => {
            const categories = await classifyTopic(item.title, item.description || '');
            
            return {
                title: item.title,
                description: item.description || '',
                link: item.link,
                pubDate: item.pubDate,
                categories: categories,
                traffic: item.traffic || 'N/A',
                timestamp: new Date().toISOString()
            };
        }));

        const output = {
            lastUpdated: new Date().toISOString(),
            totalItems: processedItems.length,
            items: processedItems
        };

        cachedData = output;
        lastFetch = Date.now();
        
        return output;
    } catch (error) {
        console.error('Error processing trending topics:', error);
        throw error;
    }
}

// Add a basic health check endpoint for Render
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Routes
app.get('/', (req, res) => {
    res.send(`
        <h1>Google Trends Parser</h1>
        <p>Access the JSON data at: <a href="/trends">/trends</a></p>
        <p>Last updated: ${lastFetch ? new Date(lastFetch).toLocaleString() : 'Never'}</p>
    `);
});

app.get('/trends', async (req, res) => {
    const now = Date.now();
    if (!cachedData || !lastFetch || (now - lastFetch) > 3600000) {
        try {
            await processTrendingTopics();
        } catch (error) {
            return res.status(500).json({ error: 'Failed to fetch trends' });
        }
    }
    res.json(cachedData);
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    processTrendingTopics().catch(console.error);
});