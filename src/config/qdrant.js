const { QdrantClient } = require("@qdrant/js-client-rest");
const { logger } = require("../utils/logger");

class QdrantConnection {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      this.client = new QdrantClient({
        url: process.env.QDRANT_URL || "http://localhost:6333",
        apiKey: process.env.QDRANT_API_KEY || undefined,
      });

      // ✅ Correct method
      const collections = await this.client.getCollections();
      logger.info(`Connected to Qdrant. Collections: ${JSON.stringify(collections.collections)}`);

      this.isConnected = true;
    } catch (err) {
      logger.error("Failed to connect to Qdrant:", err);
      throw err;
    }
  }
}

const qdrantConnection = new QdrantConnection();

const connectQdrant = async () => {
  if (!qdrantConnection.isConnected) {
    await qdrantConnection.connect();
  }
  return qdrantConnection.client;
};

module.exports = { connectQdrant, qdrantConnection };
