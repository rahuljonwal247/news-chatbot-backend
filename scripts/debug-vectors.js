// Create this as scripts/debug-vectors.js
require('dotenv').config();

const ragService = require('../src/services/ragService');
const { logger } = require('../src/utils/logger');
const { connectRedis } = require('../src/config/redis');
const { connectQdrant } = require('../src/config/qdrant');

async function debugVectorDimensions() {
  try {
    logger.info('🔍 Starting vector dimension diagnostic...');
    
    // Initialize services
    await connectRedis();
    await connectQdrant();
    await ragService.init();
    
    // Test different text inputs
    const testTexts = [
      'This is a short test',
      'This is a longer test with more content to see if length affects the embedding generation process',
      '', // Empty string
      '   ', // Whitespace only
      'Special characters: !@#$%^&*()_+-=[]{}|;:,.<>?',
      'Test with\nnewlines\nand\ttabs'
    ];
    
    logger.info('📊 Testing embedding generation with various inputs...');
    
    for (let i = 0; i < testTexts.length; i++) {
      const text = testTexts[i];
      const displayText = text.length > 30 ? text.substring(0, 30) + '...' : text;
      
      try {
        logger.info(`\n--- Test ${i + 1}: "${displayText}" ---`);
        
        const embedding = await ragService.generateEmbedding(text);
        
        logger.info(`✅ Embedding generated successfully`);
        logger.info(`📏 Dimensions: ${embedding ? embedding.length : 'null'}`);
        logger.info(`🔢 Type: ${Array.isArray(embedding) ? 'Array' : typeof embedding}`);
        
        if (Array.isArray(embedding)) {
          logger.info(`📈 First 5 values: [${embedding.slice(0, 5).join(', ')}]`);
          logger.info(`📉 All zeros: ${embedding.every(val => val === 0)}`);
          logger.info(`🎯 Expected dimension (768): ${embedding.length === 768 ? 'MATCH' : 'MISMATCH'}`);
        }
        
      } catch (error) {
        logger.error(`❌ Embedding generation failed: ${error.message}`);
      }
    }
    
    // Test collection configuration
    logger.info('\n🗃️ Checking collection configuration...');
    try {
      const collectionInfo = await ragService.getCollectionInfo();
      logger.info(`📊 Collection info:`, JSON.stringify(collectionInfo, null, 2));
      
      // Get detailed collection config from Qdrant directly
      const qdrantClient = ragService.qdrantClient;
      const fullCollectionInfo = await qdrantClient.getCollection('news_articles');
      
      logger.info(`🔧 Vector configuration:`);
      logger.info(`  Size: ${fullCollectionInfo.config?.params?.vectors?.size}`);
      logger.info(`  Distance: ${fullCollectionInfo.config?.params?.vectors?.distance}`);
      
    } catch (error) {
      logger.error(`❌ Failed to get collection info: ${error.message}`);
    }
    
    // Test a simple upsert with known good data
    logger.info('\n🧪 Testing direct upsert with valid data...');
    try {
      const testPoint = {
        id: 'test-point-diagnostic',
        vector: new Array(768).fill(0.1), // Valid 768-dimensional vector
        payload: {
          title: 'Test Document',
          content: 'Test content for diagnostic',
          source: 'diagnostic'
        }
      };
      
      logger.info(`📤 Attempting upsert with test point...`);
      logger.info(`  Vector dimensions: ${testPoint.vector.length}`);
      logger.info(`  Vector sample: [${testPoint.vector.slice(0, 5).join(', ')}]`);
      
      const result = await ragService.qdrantClient.upsert('news_articles', {
        wait: true,
        points: [testPoint]
      });
      
      logger.info(`✅ Test upsert successful:`, result);
      
      // Clean up the test point
      await ragService.qdrantClient.delete('news_articles', {
        wait: true,
        points: ['test-point-diagnostic']
      });
      
      logger.info(`🧹 Test point cleaned up`);
      
    } catch (error) {
      logger.error(`❌ Test upsert failed: ${error.message}`);
      logger.error(`Stack trace:`, error.stack);
    }
    
    // Test with actual article data
    logger.info('\n📰 Testing with sample article data...');
    try {
      const sampleArticle = {
        id: 'diagnostic-article-123',
        title: 'Sample Article for Testing',
        content: 'This is a sample article content that we will use to test the complete document storage process. It should be long enough to create proper embeddings and test the chunking functionality.',
        url: 'https://example.com/test',
        publishedAt: new Date().toISOString(),
        source: 'Diagnostic Test',
        author: 'Test Author',
        categories: ['test'],
        keywords: ['diagnostic', 'test']
      };
      
      logger.info(`📝 Sample article prepared:`);
      logger.info(`  Title: ${sampleArticle.title}`);
      logger.info(`  Content length: ${sampleArticle.content.length}`);
      
      // Test just the embedding part first
      const testEmbedding = await ragService.generateEmbedding(sampleArticle.content);
      logger.info(`📊 Article embedding:`);
      logger.info(`  Dimensions: ${testEmbedding.length}`);
      logger.info(`  All zeros: ${testEmbedding.every(val => val === 0)}`);
      
      if (testEmbedding.length !== 768) {
        logger.error(`❌ DIMENSION MISMATCH: Expected 768, got ${testEmbedding.length}`);
      } else {
        logger.info(`✅ Embedding dimensions are correct`);
      }
      
    } catch (error) {
      logger.error(`❌ Article embedding test failed: ${error.message}`);
    }
    
    logger.info('\n🎉 Vector diagnostic complete!');
    
  } catch (error) {
    logger.error('❌ Diagnostic failed:', error);
  } finally {
    process.exit(0);
  }
}

// Run diagnostic
debugVectorDimensions();