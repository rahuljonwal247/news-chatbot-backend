const { createClient } = require('redis');
const { logger } = require('../utils/logger');

class RedisClient {
  constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) return new Error('Redis connection failed after 10 retries');
          return retries * 1000; // exponential backoff
        }
      }
    });

    this.client.on('error', (error) => {
      logger.error('Redis client error:', error);
    });

    this.client.on('connect', () => {
      logger.info('Connected to Redis');
    });

    this.client.on('end', () => {
      logger.warn('Redis disconnected');
    });
  }

  async connect() {
    if (!this.client.isOpen) {
      await this.client.connect();
    }
    return this.client;
  }

  async disconnect() {
    if (this.client.isOpen) {
      await this.client.disconnect();
    }
  }
}

// Singleton instance
const redisInstance = new RedisClient();

// Export ready-to-use client
const redisClient = redisInstance.client;

module.exports = { redisClient, connectRedis: () => redisInstance.connect() };
