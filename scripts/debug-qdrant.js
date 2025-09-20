// Create this as scripts/debug-qdrant.js
require('dotenv').config();

const ragService = require('../src/services/ragService');
const { connectRedis } = require('../src/config/redis');
const { connectQdrant } = require('../src/config/qdrant');
const { logger } = require('../src/utils/logger');

async function debugQdrant() {
  try {
    console.log('🔍 Qdrant-Specific Diagnostic Starting...\n');

    // Initialize
    await connectRedis();
    await connectQdrant();
    await ragService.init();

    // Step 1: Get a real cached embedding to test with
    console.log('1. Getting a real embedding from cache...');
    const testText = "Test embedding for diagnostic purposes";
    const embedding = await ragService.generateEmbedding(testText);
    
    console.log(`   Embedding length: ${embedding.length}`);
    console.log(`   All zeros: ${embedding.every(v => v === 0)}`);
    console.log(`   First 3 values: [${embedding.slice(0, 3).join(', ')}]`);

    // Step 2: Test minimal point structure
    console.log('\n2. Testing minimal point structure...');
    const minimalPoint = {
      id: 'test-minimal',
      vector: embedding,
      payload: {
        title: 'Test'
      }
    };

    try {
      await ragService.qdrantClient.upsert('news_articles', {
        wait: true,
        points: [minimalPoint]
      });
      console.log('   ✅ Minimal point structure works');
      
      // Clean up
      await ragService.qdrantClient.delete('news_articles', {
        wait: true,
        points: ['test-minimal']
      });
    } catch (error) {
      console.log('   ❌ Minimal point failed:', error.message);
      console.log('   Full error:', error);
    }

    // Step 3: Test problematic payload fields one by one
    console.log('\n3. Testing payload fields individually...');
    
    const payloadTests = [
      { title: 'Basic string field', payload: { title: 'Test Title' } },
      { title: 'URL field', payload: { url: 'https://example.com/test' } },
      { title: 'Date field', payload: { publishedAt: new Date().toISOString() } },
      { title: 'Number field', payload: { chunkIndex: 0 } },
      { title: 'Array field', payload: { categories: ['test', 'diagnostic'] } },
      { title: 'Long content field', payload: { content: 'This is a longer content field that might cause issues if it contains special characters or is too long for Qdrant to handle properly.' } },
      { title: 'Full payload', payload: {
        title: 'Full Test Document',
        content: 'Test content for diagnostic',
        url: 'https://example.com/test',
        publishedAt: new Date().toISOString(),
        source: 'Test Source',
        chunkIndex: 0,
        originalDocId: 'test-doc-123'
      }}
    ];

    for (let i = 0; i < payloadTests.length; i++) {
      const test = payloadTests[i];
      const pointId = `test-payload-${i}`;
      
      try {
        const testPoint = {
          id: pointId,
          vector: embedding,
          payload: test.payload
        };

        await ragService.qdrantClient.upsert('news_articles', {
          wait: true,
          points: [testPoint]
        });
        
        console.log(`   ✅ ${test.title}: OK`);
        
        // Clean up
        await ragService.qdrantClient.delete('news_articles', {
          wait: true,
          points: [pointId]
        });
        
      } catch (error) {
        console.log(`   ❌ ${test.title}: ${error.message}`);
        console.log(`      Payload:`, JSON.stringify(test.payload, null, 2));
      }
    }

    // Step 4: Test problematic ID formats
    console.log('\n4. Testing point ID formats...');
    
    const idTests = [
      'simple-id',
      'test_with_underscores',
      'test-with-dashes',
      'test123numbers',
      'uuid-style-12345678-1234-1234-1234-123456789012',
      'doc_chunk_0',
      'very-long-id-that-might-cause-issues-in-qdrant-if-there-are-length-limits'
    ];

    for (const testId of idTests) {
      try {
        const testPoint = {
          id: testId,
          vector: embedding,
          payload: { title: 'ID Test' }
        };

        await ragService.qdrantClient.upsert('news_articles', {
          wait: true,
          points: [testPoint]
        });
        
        console.log(`   ✅ ID "${testId}": OK`);
        
        // Clean up
        await ragService.qdrantClient.delete('news_articles', {
          wait: true,
          points: [testId]
        });
        
      } catch (error) {
        console.log(`   ❌ ID "${testId}": ${error.message}`);
      }
    }

    // Step 5: Test exact format from your failing code
    console.log('\n5. Testing exact format from failing ingestion...');
    
    try {
      const exactPoint = {
        id: 'test-doc-123_chunk_0',
        vector: embedding,
        payload: { 
          title: 'Two UK teens charged in connection to Scattered Spider ransomware attacks',
          content: 'Test content that mimics real article content', 
          url: 'https://example.com/test-article',
          publishedAt: new Date().toISOString(),
          source: 'Test Source',
          chunkIndex: 0, 
          originalDocId: 'test-doc-123'
        }
      };

      console.log('   Point structure:');
      console.log('     ID:', exactPoint.id);
      console.log('     Vector length:', exactPoint.vector.length);
      console.log('     Payload keys:', Object.keys(exactPoint.payload));

      await ragService.qdrantClient.upsert('news_articles', {
        wait: true,
        points: [exactPoint]
      });
      
      console.log('   ✅ Exact format works!');
      
      // Clean up
      await ragService.qdrantClient.delete('news_articles', {
        wait: true,
        points: ['test-doc-123_chunk_0']
      });
      
    } catch (error) {
      console.log('   ❌ Exact format failed:', error.message);
      console.log('   This is the same error as your ingestion!');
      
      // Let's examine the error more closely
      if (error.response) {
        console.log('   Response status:', error.response.status);
        console.log('   Response data:', error.response.data);
      }
    }

    // Step 6: Check collection configuration
    console.log('\n6. Checking collection configuration...');
    
    try {
      const collectionInfo = await ragService.qdrantClient.getCollection('news_articles');
      console.log('   Collection config:');
      console.log('     Vector size:', collectionInfo.config?.params?.vectors?.size);
      console.log('     Distance:', collectionInfo.config?.params?.vectors?.distance);
      console.log('     Points count:', collectionInfo.points_count);
      console.log('     Status:', collectionInfo.status);
      
      if (collectionInfo.config?.params?.vectors?.size !== 768) {
        console.log('   ⚠️  WARNING: Collection expects different vector size!');
      }
      
    } catch (error) {
      console.log('   ❌ Could not get collection info:', error.message);
    }

    console.log('\n🎉 Qdrant diagnostic complete!');

  } catch (error) {
    console.error('❌ Diagnostic failed:', error);
  } finally {
    process.exit(0);
  }
}

debugQdrant();