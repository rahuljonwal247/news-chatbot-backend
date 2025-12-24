const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');
const { logger } = require('../utils/logger');
const { redisClient } = require('../config/redis');
const { qdrantConnection } = require('../config/qdrant');
const { v4: uuidv4 } = require('uuid');

class RAGService {
  constructor() {
    this.qdrantClient = null;
    
    // Initialize new Google GenAI SDK
    this.genAI = new GoogleGenAI({ 
      apiKey: process.env.GEMINI_API_KEY 
    });

    this.embeddingModel = "jina-embeddings-v2-base-en";
    this.collectionName = "news_articles";
    this.topK = 5;
  }

  async init() {
    if (!qdrantConnection.isConnected) {
      await qdrantConnection.connect();
    }
    this.qdrantClient = qdrantConnection.client;
    await this.initializeCollection();
    logger.info('RAGService initialized successfully');
  }

  async generateEmbedding(text) {
    if (!text || !text.trim()) {
      logger.warn('generateEmbedding called with empty text. Returning zero vector.');
      return new Array(768).fill(0); 
    }

    try {
      const cacheKey = `embedding:${this.hashString(text)}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        const embedding = JSON.parse(cached);
        if (Array.isArray(embedding) && embedding.length === 768) {
          logger.info(`✅ Cached embedding for key: ${cacheKey}`);
          return embedding;
        }
      }

      if (!process.env.JINA_API_KEY) {
        logger.warn('Missing JINA_API_KEY, returning zero vector.');
        return new Array(768).fill(0);
      }

      const cleanText = text
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 8000);

      const response = await axios.post(
        'https://api.jina.ai/v1/embeddings',
        { 
          model: this.embeddingModel,
          input: [cleanText]
        },
        { 
          headers: { 
            'Authorization': `Bearer ${process.env.JINA_API_KEY}`, 
            'Content-Type': 'application/json' 
          },
          timeout: 30000
        }
      );

      const embedding = response.data?.data?.[0]?.embedding;

      if (!embedding || !Array.isArray(embedding)) {
        logger.warn('Jina API returned invalid embedding, using zero vector.');
        return new Array(768).fill(0);
      }

      if (embedding.length !== 768) {
        logger.warn(`Jina API returned wrong dimensions: ${embedding.length}, using zero vector.`);
        return new Array(768).fill(0);
      }

      const validEmbedding = embedding.map(val => {
        if (typeof val !== 'number' || isNaN(val) || !isFinite(val)) {
          return 0;
        }
        return val;
      });

      try {
        await redisClient.set(cacheKey, JSON.stringify(validEmbedding), { EX: 7 * 24 * 60 * 60 });
        logger.info(`✅ Cached embedding for key: ${cacheKey}`);
      } catch (e) {
        logger.error("❌ Redis set failed:", e);
      }

      return validEmbedding;
      
    } catch (err) {
      logger.error('Error generating embedding, using zero vector:', err.message || err);
      return new Array(768).fill(0);
    }
  }

  async storeDocument(document) {
    try {
      const { id, title, content, url, publishedAt, source } = document;
      
      if (!content || content.length < 50) {
        logger.warn(`Skipping document with insufficient content: ${title}`);
        return;
      }
      
      const chunks = this.chunkText(content, 500, 50);
      logger.info(`Processing ${chunks.length} chunks for: ${title}`);

      for (let i = 0; i < chunks.length; i++) {
        try {
          const chunkText = `${title}\n\n${chunks[i]}`;
          if (!chunkText.trim()) continue;
          
          const embedding = await this.generateEmbedding(chunkText);
          
          if (!Array.isArray(embedding) || embedding.length !== 768) {
            logger.error(`Invalid embedding: expected 768-dim array, got ${embedding?.length}`);
            continue;
          }

          const point = {
            id: uuidv4(),
            vector: embedding,
            payload: {
              title: title || 'Untitled',
              content: chunks[i] || '',
              url: url || '',
              publishedAt: publishedAt || new Date().toISOString(),
              source: source || 'Unknown',
              chunkIndex: i,
              originalDocId: id || 'unknown',
              originalChunkId: `${id}_chunk_${i}`
            }
          };

          await this.qdrantClient.upsert(this.collectionName, { 
            wait: true, 
            points: [point] 
          });
          
          logger.debug(`✅ Stored chunk ${i + 1}/${chunks.length} for: ${title}`);

        } catch (chunkError) {
          logger.error(`Error processing chunk ${i} for "${title}":`, chunkError.message);
          continue;
        }
      }
      
      logger.info(`✅ Successfully stored document: ${title} with ${chunks.length} chunks`);
      
    } catch (error) {
      logger.error(`❌ Failed to store document "${document.title}":`, error.message);
      throw error;
    }
  }

  sanitizeId(id) {
    return String(id)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .substring(0, 64);
  }

  sanitizePayload(payload) {
    const sanitized = {};
    
    for (const [key, value] of Object.entries(payload)) {
      if (value !== null && value !== undefined) {
        if (typeof value === 'string') {
          sanitized[key] = value
            .replace(/[\x00-\x1F\x7F]/g, '')
            .substring(0, 1000);
        } else if (typeof value === 'number') {
          sanitized[key] = isFinite(value) ? value : 0;
        } else if (Array.isArray(value)) {
          sanitized[key] = value
            .filter(item => item !== null && item !== undefined)
            .map(item => String(item).substring(0, 100))
            .slice(0, 10);
        } else {
          sanitized[key] = String(value).substring(0, 100);
        }
      }
    }
    
    return sanitized;
  }

  async retrieveDocuments(query) {
    if (!query || !query.trim()) return [];

    try {
      const embedding = await this.generateEmbedding(query);
      const searchResults = await this.qdrantClient.search(this.collectionName, {
        vector: embedding,
        limit: this.topK,
        with_payload: true,
        with_vectors: false
      });
      return searchResults.map(r => ({
        content: r.payload.content,
        title: r.payload.title,
        url: r.payload.url,
        source: r.payload.source,
        publishedAt: r.payload.publishedAt,
        score: r.score
      }));
    } catch (err) {
      logger.error('Error retrieving documents from Qdrant:', err.message || err);
      return [];
    }
  }

  async generateResponse(query, sessionId, retrievedDocsFromSearch = null) {
    if (!query || !query.trim()) {
      return { response: "Please enter a valid query.", sources: [], retrievedDocs: 0 };
    }

    try {
      const relevantDocs = retrievedDocsFromSearch || await this.retrieveDocuments(query);
      if (!relevantDocs.length) {
        return {
          response: "No relevant news found. Try rephrasing your query.",
          sources: [],
          retrievedDocs: 0
        };
      }

      const context = this.buildContext(relevantDocs);
      const history = (await this.getConversationHistory(sessionId)).filter(h => h && h.content);
      console.log("history:", history);

      const prompt = this.buildPrompt(query, context, history);
      
      logger.debug('Prompt details:', { 
        queryLength: query.length, 
        contextLength: context.length,
        promptPreview: prompt.substring(0, 200)
      });

      // NEW SDK METHOD - Use models.generateContent
      // Use gemini-2.5-flash (latest) or gemini-2.0-flash (stable)
      const result = await this.genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
      });
      
      console.log("Gemini result:", result);

      // Extract text from new SDK response
      const response = result.text || "Sorry, I could not generate a response.";
      console.log("Generated response:", response);

      const sources = this.extractUniqueSources(relevantDocs);
      console.log("Sources:", sources);

      logger.info(`Response generated for session ${sessionId} with ${relevantDocs.length} retrieved docs`);

      return { response, sources, retrievedDocs: relevantDocs.length };

    } catch (err) {
      logger.error("Error generating response:", {
        message: err.message,
        stack: err.stack,
        name: err.name,
        code: err.code,
        status: err.status,
        statusText: err.statusText,
        fullError: err
      });
      
      return {
        response: "I'm sorry, I encountered an error while processing your question. Please try again or rephrase your query.",
        sources: [],
        retrievedDocs: 0
      };
    }
  }

  buildContext(documents) {
    return documents.map((doc, i) => `
Document ${i + 1}:
Title: ${doc.title}
Source: ${doc.source}
Published: ${new Date(doc.publishedAt).toLocaleDateString()}
Content: ${doc.content}
URL: ${doc.url}
---`).join('\n');
  }

  buildPrompt(query, context, history) {
    const prompt = `
    Context: ${context}
    
    Conversation History:
    ${history.map(h => `${h.type}: ${h.content}`).join('\n')}
    
    User Query: ${query}
    
    Please provide a helpful response based on the context and conversation history.
  `;
    
    console.log('Built prompt:', prompt.substring(0, 500));
    return prompt;
  }

  async getConversationHistory(sessionId) {
    try {
      const messages = await redisClient.lRange(
        `session:${sessionId}:messages`,
        -10,
        -1
      );
      return messages.map(m => JSON.parse(m));
    } catch (error) {
      logger.error('Error getting conversation history:', error);
      return [];
    }
  }

  extractUniqueSources(documents) {
    const map = new Map();
    documents.forEach(d => map.set(d.url, { 
      title: d.title, 
      url: d.url, 
      source: d.source, 
      publishedAt: d.publishedAt 
    }));
    return Array.from(map.values());
  }

  chunkText(text, chunkSize = 500, overlap = 50) {
    const sentences = text.match(/[^\.!?]+[\.!?]+/g) || [text];
    const chunks = [];
    let current = '';
    for (const s of sentences) {
      if (current.length + s.length <= chunkSize) current += s;
      else {
        if (current) chunks.push(current.trim());
        const words = current.split(' ');
        current = words.slice(-Math.floor(overlap / 10)).join(' ') + s;
      }
    }
    if (current) chunks.push(current.trim());
    return chunks.filter(c => c.length > 50);
  }

  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString();
  }

  async initializeCollection() {
    try {
      const collections = await this.qdrantClient.getCollections();
      const exists = collections.collections.some(c => c.name === this.collectionName);
      if (!exists) {
        await this.qdrantClient.createCollection(this.collectionName, {
          vectors: { size: 768, distance: 'Cosine' },
          optimizers_config: { default_segment_number: 2 },
          replication_factor: 1
        });
        logger.info(`Created collection: ${this.collectionName}`);
      } else logger.info(`Collection ${this.collectionName} already exists`);
    } catch (error) {
      logger.error('Error initializing collection:', error);
      throw error;
    }
  }

  async getCollectionInfo() {
    try {
      const info = await this.qdrantClient.getCollection(this.collectionName);
      return { 
        pointsCount: info.points_count, 
        status: info.status, 
        vectorsCount: info.vectors_count 
      };
    } catch (error) {
      logger.error('Error getting collection info:', error);
      return null;
    }
  }
}

module.exports = new RAGService();