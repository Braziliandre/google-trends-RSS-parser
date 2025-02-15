const Parser = require('rss-parser');
const express = require('express');
const parser = new Parser({
  customFields: {
    item: [
      ['ht:approx_traffic', 'traffic'],
      ['ht:picture', 'picture'],
      ['ht:news_item', 'news'],
      ['ht:news_item_title', 'newsTitle'],
      ['ht:news_item_snippet', 'newsSnippet'],
      ['ht:news_item_url', 'newsUrl']
    ]
  }
});

const app = express();

// Configuration
const GOOGLE_TRENDS_RSS = 'https://trends.google.com/trends/trendingsearches/daily/rss?geo=US';
const PORT = process.env.PORT || 3000;

let cachedData = null;
let trendHistory = new Map(); // Store historical data for time-based analysis

async function processTrendingTopics() {
    try {
        const feed = await parser.parseURL(GOOGLE_TRENDS_RSS);
        const currentTime = new Date();
        
        const processedItems = await Promise.all(feed.items.map(async item => {
            // Track historical data
            if (!trendHistory.has(item.title)) {
                trendHistory.set(item.title, []);
            }
            
            // Convert traffic string to number (e.g., "2M+" to 2000000)
            const trafficNum = parseTraffic(item.traffic);
            
            // Store historical point
            trendHistory.get(item.title).push({
                timestamp: currentTime,
                traffic: trafficNum
            });
            
            // Clean history older than 24 hours
            cleanOldHistory(item.title);

            // Process news items for better description
            const newsItems = Array.isArray(item.news) ? item.news : [item.news];
            const enrichedDescription = newsItems.map(news => {
                return {
                    title: news?.ht_news_item_title || news?.newsTitle,
                    snippet: news?.ht_news_item_snippet || news?.newsSnippet,
                    url: news?.ht_news_item_url || news?.newsUrl
                };
            }).filter(news => news.title || news.snippet);

            return {
                title: item.title,
                description: enrichedDescription,
                link: item.link,
                pubDate: item.pubDate,
                traffic: item.traffic,
                picture: item.picture,
                metrics: {
                    trafficNumber: trafficNum,
                    hoursSinceTrending: getHoursSinceTrending(item.pubDate),
                    trendVelocity: calculateTrendVelocity(item.title)
                },
                timestamp: currentTime.toISOString()
            };
        }));

        const output = {
            lastUpdated: currentTime.toISOString(),
            totalItems: processedItems.length,
            items: processedItems
        };

        cachedData = output;
        return output;
    } catch (error) {
        console.error('Error processing trending topics:', error);
        throw error;
    }
}

function parseTraffic(trafficStr) {
    if (!trafficStr || trafficStr === 'N/A') return 0;
    
    const num = parseFloat(trafficStr.replace(/[^0-9.]/g, ''));
    const multiplier = trafficStr.includes('M') ? 1000000 :
                      trafficStr.includes('K') ? 1000 : 1;
    
    return num * multiplier;
}

function getHoursSinceTrending(pubDate) {
    const pubTime = new Date(pubDate);
    const now = new Date();
    return Math.round((now - pubTime) / (1000 * 60 * 60));
}

function calculateTrendVelocity(title) {
    const history = trendHistory.get(title);
    if (!history || history.length < 2) return 0;
    
    const latest = history[history.length - 1];
    const previous = history[history.length - 2];
    const hoursDiff = (latest.timestamp - previous.timestamp) / (1000 * 60 * 60);
    
    return hoursDiff === 0 ? 0 : (latest.traffic - previous.traffic) / hoursDiff;
}

function cleanOldHistory(title) {
    const history = trendHistory.get(title);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const filteredHistory = history.filter(point => point.timestamp > dayAgo);
    trendHistory.set(title, filteredHistory);
}

// Routes
app.get('/', (req, res) => {
    res.send(`
        <h1>Google Trends Parser</h1>
        <p>Access the JSON data at: <a href="/trends">/trends</a></p>
        <p>View metrics at: <a href="/trends/metrics">/trends/metrics</a></p>
        <p>Last updated: ${cachedData?.lastUpdated ? new Date(cachedData.lastUpdated).toLocaleString() : 'Never'}</p>
    `);
});

app.get('/trends', async (req, res) => {
    if (!cachedData) {
        try {
            await processTrendingTopics();
        } catch (error) {
            return res.status(500).json({ error: 'Failed to fetch trends' });
        }
    }
    res.json(cachedData);
});

app.get('/trends/metrics', async (req, res) => {
    if (!cachedData) {
        try {
            await processTrendingTopics();
        } catch (error) {
            return res.status(500).json({ error: 'Failed to fetch trends' });
        }
    }
    
    const metrics = cachedData.items.map(item => ({
        title: item.title,
        traffic: item.traffic,
        metrics: item.metrics
    }));
    
    res.json(metrics);
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    // Initial data fetch
    processTrendingTopics().catch(console.error);
    
    // Update every 15 minutes
    setInterval(processTrendingTopics, 15 * 60 * 1000);
});