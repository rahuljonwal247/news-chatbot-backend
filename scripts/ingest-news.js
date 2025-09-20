const axios = require('axios');
const cheerio = require('cheerio');
const RSSParser = require('rss-parser');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const ragService = require('../src/services/ragService');
const { logger } = require('../src/utils/logger');
const { connectRedis } = require('../src/config/redis');
const { connectQdrant } = require('../src/config/qdrant');

class NewsIngestionService {
  constructor() {
    this.rssParser = new RSSParser({
      customFields: {
        item: [
          ['media:content', 'mediaContent'],
          ['content:encoded', 'contentEncoded'],
          ['description', 'description']
        ]
      }
    });
    
    this.newsSources = [
      {
        name: 'Reuters',
        url: 'https://feeds.reuters.com/reuters/topNews',
        type: 'rss'
      },
      {
        name: 'BBC News',
        url: 'http://feeds.bbci.co.uk/news/rss.xml',
        type: 'rss'
      },
      {
        name: 'CNN',
        url: 'http://rss.cnn.com/rss/edition.rss',
        type: 'rss'
      },
      {
        name: 'Associated Press',
        url: 'https://feeds.apnews.com/ApNews/apf-topnews',
        type: 'rss'
      },
      {
        name: 'NPR',
        url: 'https://feeds.npr.org/1001/rss.xml',
        type: 'rss'
      },
      {
        name: 'The Guardian',
        url: 'https://www.theguardian.com/world/rss',
        type: 'rss'
      },
      {
        name: 'TechCrunch',
        url: 'https://techcrunch.com/feed/',
        type: 'rss'
      },
      {
        name: 'Ars Technica',
        url: 'https://feeds.arstechnica.com/arstechnica/index',
        type: 'rss'
      }
    ];
    
    this.maxArticlesPerSource = 10;
    this.minContentLength = 200;
  }

  /**
   * Initialize services
   */

async initialize() {
  try {
    await connectRedis();
    await connectQdrant();
    await ragService.init(); // Change this line - was initializeCollection()
    logger.info('News ingestion service initialized');
  } catch (error) {
    logger.error('Failed to initialize services:', error);
    throw error;
  }
}

  /**
   * Main ingestion process
   */
  async ingestNews() {
    try {
      logger.info(`🚀 Starting news ingestion from ${this.newsSources.length} sources`);
      
      let totalArticles = 0;
      let successfulArticles = 0;
      
      for (const source of this.newsSources) {
        try {
          logger.info(`📰 Processing source: ${source.name}`);
          
          const articles = await this.fetchFromSource(source);
          logger.info(`Found ${articles.length} articles from ${source.name}`);
          
          for (const article of articles.slice(0, this.maxArticlesPerSource)) {
            try {
              totalArticles++;
              
              // Enhance article content
              const enhancedArticle = await this.enhanceArticle(article);
              
              if (this.isValidArticle(enhancedArticle)) {
                await ragService.storeDocument(enhancedArticle);
                successfulArticles++;
                logger.debug(`✅ Stored: ${enhancedArticle.title.substring(0, 60)}...`);
              } else {
                logger.debug(`❌ Skipped invalid article: ${article.title?.substring(0, 60) || 'No title'}...`);
              }
              
              // Small delay to avoid rate limiting
              await this.delay(100);
              
            } catch (error) {
              logger.error(`Error processing article "${article.title}":`, error.message);
            }
          }
          
          // Delay between sources
          await this.delay(500);
          
        } catch (error) {
          logger.error(`Error processing source ${source.name}:`, error.message);
        }
      }
      
      logger.info(`🏁 Ingestion complete: ${successfulArticles}/${totalArticles} articles stored`);
      
      // Get collection statistics
      const collectionInfo = await ragService.getCollectionInfo();
      if (collectionInfo) {
        logger.info(`📊 Collection stats: ${collectionInfo.pointsCount} total points`);
      }
      
      return {
        totalArticles,
        successfulArticles,
        collectionInfo
      };
      
    } catch (error) {
      logger.error('Error during news ingestion:', error);
      throw error;
    }
  }

  /**
   * Fetch articles from a news source
   */
  async fetchFromSource(source) {
    try {
      if (source.type === 'rss') {
        return await this.fetchFromRSS(source);
      } else {
        throw new Error(`Unsupported source type: ${source.type}`);
      }
    } catch (error) {
      logger.error(`Error fetching from ${source.name}:`, error.message);
      return [];
    }
  }

  /**
   * Fetch articles from RSS feed
   */
  async fetchFromRSS(source) {
    try {
      const response = await axios.get(source.url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'NewsBot/1.0 (+https://example.com/bot)'
        }
      });
      
      const feed = await this.rssParser.parseString(response.data);
      
      return feed.items.map(item => ({
        id: uuidv4(),
        title: this.cleanText(item.title || ''),
        content: this.extractContent(item),
        url: item.link || '',
        publishedAt: item.pubDate || item.isoDate || new Date().toISOString(),
        source: source.name,
        author: item.creator || item['dc:creator'] || '',
        categories: this.extractCategories(item)
      }));
      
    } catch (error) {
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        logger.warn(`Network error for ${source.name}: ${error.message}`);
      } else {
        logger.error(`RSS parsing error for ${source.name}:`, error.message);
      }
      return [];
    }
  }

  /**
   * Extract content from RSS item
   */
  extractContent(item) {
    let content = '';
    
    // Try different content fields in order of preference
    if (item.contentEncoded) {
      content = item.contentEncoded;
    } else if (item.content) {
      content = item.content;
    } else if (item.description) {
      content = item.description;
    } else if (item.summary) {
      content = item.summary;
    }
    
    // Clean HTML and return plain text
    return this.htmlToText(content);
  }

  /**
   * Convert HTML to clean text
   */
  htmlToText(html) {
    if (!html) return '';
    
    const $ = cheerio.load(html);
    
    // Remove script and style elements
    $('script, style, nav, footer, aside').remove();
    
    // Get text content
    let text = $.text();
    
    // Clean up whitespace
    text = text
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '\n')
      .trim();
    
    return text;
  }

  /**
   * Clean text content
   */
  cleanText(text) {
    if (!text) return '';
    
    return text
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s\-.,!?;:()"']/g, '')
      .trim();
  }

  /**
   * Extract categories from RSS item
   */
  extractCategories(item) {
    const categories = [];
    
    if (item.categories) {
      categories.push(...item.categories);
    }
    
    if (item.category) {
      if (Array.isArray(item.category)) {
        categories.push(...item.category);
      } else {
        categories.push(item.category);
      }
    }
    
    return categories.map(cat => typeof cat === 'string' ? cat : cat._).filter(Boolean);
  }

  /**
   * Enhance article with additional processing
   */
  async enhanceArticle(article) {
    try {
      // If content is too short, try to scrape the full article
      if (article.content.length < this.minContentLength && article.url) {
        const scrapedContent = await this.scrapeArticle(article.url);
        if (scrapedContent && scrapedContent.length > article.content.length) {
          article.content = scrapedContent;
        }
      }
      
      // Generate summary if content is very long
      if (article.content.length > 2000) {
        article.summary = this.generateSummary(article.content);
      }
      
      // Extract keywords
      article.keywords = this.extractKeywords(article.content);
      
      return article;
      
    } catch (error) {
      logger.error('Error enhancing article:', error.message);
      return article;
    }
  }

  /**
   * Scrape full article content
   */
  async scrapeArticle(url) {
    try {
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      const $ = cheerio.load(response.data);
      
      // Remove unwanted elements
      $('script, style, nav, footer, aside, .advertisement, .ads, .social-share').remove();
      
      // Try to find main content
      const contentSelectors = [
        'article',
        '.article-body',
        '.entry-content',
        '.post-content',
        '.content',
        'main',
        '.story-body'
      ];
      
      for (const selector of contentSelectors) {
        const content = $(selector);
        if (content.length && content.text().length > this.minContentLength) {
          return this.htmlToText(content.html());
        }
      }
      
      // Fallback to body content
      const bodyText = this.htmlToText($('body').html());
      return bodyText.length > this.minContentLength ? bodyText : '';
      
    } catch (error) {
      logger.debug(`Could not scrape ${url}:`, error.message);
      return '';
    }
  }

  /**
   * Generate simple summary
   */
  generateSummary(content, maxLength = 300) {
    const sentences = content.match(/[^\.!?]+[\.!?]+/g) || [];
    let summary = '';
    
    for (const sentence of sentences) {
      if (summary.length + sentence.length <= maxLength) {
        summary += sentence;
      } else {
        break;
      }
    }
    
    return summary.trim();
  }

  /**
   * Extract simple keywords
   */
  extractKeywords(content) {
    const words = content
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 3);
    
    const stopWords = new Set([
      'this', 'that', 'with', 'have', 'will', 'from', 'they', 'been', 
      'said', 'each', 'which', 'their', 'time', 'more', 'very', 'when',
      'come', 'here', 'also', 'some', 'what', 'about', 'just', 'first'
    ]);
    
    const wordCount = {};
    words.forEach(word => {
      if (!stopWords.has(word)) {
        wordCount[word] = (wordCount[word] || 0) + 1;
      }
    });
    
    return Object.entries(wordCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  }

  /**
   * Validate article before storage
   */
  isValidArticle(article) {
    // Check required fields
    if (!article.title || !article.content || !article.url) {
      return false;
    }
    
    // Check minimum content length
    if (article.content.length < this.minContentLength) {
      return false;
    }
    
    // Check for spam/invalid content
    const spamKeywords = ['viagra', 'casino', 'lottery', 'click here', 'free money'];
    const contentLower = article.content.toLowerCase();
    
    if (spamKeywords.some(keyword => contentLower.includes(keyword))) {
      return false;
    }
    
    // Check if URL is valid
    try {
      new URL(article.url);
    } catch {
      return false;
    }
    
    return true;
  }

  /**
   * Add delay between operations
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get ingestion statistics
   */
  async getIngestionStats() {
    try {
      const collectionInfo = await ragService.getCollectionInfo();
      
      return {
        timestamp: new Date().toISOString(),
        sources: this.newsSources.length,
        maxArticlesPerSource: this.maxArticlesPerSource,
        collectionInfo: collectionInfo
      };
    } catch (error) {
      logger.error('Error getting ingestion stats:', error);
      return null;
    }
  }

  /**
   * Clean old articles from the collection
   */
  async cleanOldArticles(daysOld = 7) {
    try {
      logger.info(`🧹 Cleaning articles older than ${daysOld} days`);
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);
      
      // This would require implementing a filter in Qdrant
      // For now, we'll just log the intent
      logger.info(`Would clean articles published before: ${cutoffDate.toISOString()}`);
      
      // TODO: Implement actual cleanup logic with Qdrant filtering
      
    } catch (error) {
      logger.error('Error cleaning old articles:', error);
    }
  }
}

/**
 * CLI interface
 */
async function main() {
  const ingestionService = new NewsIngestionService();
  
  try {
    await ingestionService.initialize();
    
    const args = process.argv.slice(2);
    const command = args[0] || 'ingest';
    
    switch (command) {
      case 'ingest':
        const result = await ingestionService.ingestNews();
        console.log('\n📊 Ingestion Results:');
        console.log(`Total articles processed: ${result.totalArticles}`);
        console.log(`Successfully stored: ${result.successfulArticles}`);
        console.log(`Success rate: ${((result.successfulArticles / result.totalArticles) * 100).toFixed(1)}%`);
        
        if (result.collectionInfo) {
          console.log(`Total points in collection: ${result.collectionInfo.pointsCount}`);
        }
        break;
        
      case 'stats':
        const stats = await ingestionService.getIngestionStats();
        console.log('\n📈 Ingestion Statistics:');
        console.log(JSON.stringify(stats, null, 2));
        break;
        
      case 'clean':
        const days = parseInt(args[1]) || 7;
        await ingestionService.cleanOldArticles(days);
        break;
        
      default:
        console.log('Usage: node ingest-news.js [command]');
        console.log('Commands:');
        console.log('  ingest    - Ingest news from all sources (default)');
        console.log('  stats     - Show ingestion statistics');
        console.log('  clean [days] - Clean articles older than specified days (default: 7)');
    }
    
    process.exit(0);
    
  } catch (error) {
    logger.error('Ingestion failed:', error);
    console.error('❌ Ingestion failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = NewsIngestionService;