// Create this as scripts/test-fixed-jina.js
require('dotenv').config();
const axios = require('axios');

async function testFixedJinaAPI() {
  console.log('Testing Fixed Jina API Implementation...\n');

  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) {
    console.error('JINA_API_KEY not found');
    return;
  }

  try {
    console.log('Making corrected API request...');
    
    const response = await axios.post(
      'https://api.jina.ai/v1/embeddings',
      { 
        model: 'jina-embeddings-v2-base-en',
        input: ['This is a test sentence for embedding generation.']
      },
      { 
        headers: { 
          'Authorization': `Bearer ${apiKey}`, 
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    console.log('Success! Response status:', response.status);
    
    const embedding = response.data?.data?.[0]?.embedding;
    
    if (embedding) {
      console.log('Embedding received:');
      console.log(`  Dimensions: ${embedding.length}`);
      console.log(`  Type: ${typeof embedding[0]}`);
      console.log(`  First 5 values: [${embedding.slice(0, 5).join(', ')}]`);
      console.log(`  All zeros: ${embedding.every(val => val === 0)}`);
      console.log(`  Expected 768 dimensions: ${embedding.length === 768 ? 'YES' : 'NO'}`);
    } else {
      console.error('No embedding data in response');
      console.log('Response data:', JSON.stringify(response.data, null, 2));
    }

  } catch (error) {
    console.error('API call failed:');
    if (error.response) {
      console.error(`  Status: ${error.response.status}`);
      console.error(`  Data:`, error.response.data);
    } else {
      console.error(`  Error: ${error.message}`);
    }
  }
}

testFixedJinaAPI();