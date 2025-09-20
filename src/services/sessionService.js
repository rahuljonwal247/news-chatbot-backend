const { redisClient } = require('../config/redis');
const { logger } = require('../utils/logger');

class SessionService {
  constructor() {
    this.sessionTTL = 24 * 60 * 60; // 24 hours in seconds
    this.maxMessagesPerSession = 200;
  }

  /**
   * Create a new session
   */
  async createSession(sessionId) {
    try {
      const sessionKey = `session:${sessionId}`;
      const messagesKey = `session:${sessionId}:messages`;

      const sessionData = {
        id: sessionId,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        messageCount: 0
      };

      // Set session with TTL
      await redisClient.set(sessionKey, JSON.stringify(sessionData), { EX: this.sessionTTL });

      // Initialize empty messages list
      await redisClient.del(messagesKey); // ensure empty
      // For Redis v4, you can store empty array as list if needed
      await redisClient.rPush(messagesKey, JSON.stringify([]));
      await redisClient.expire(messagesKey, this.sessionTTL);

      logger.info(`Created session: ${sessionId}`);
      return sessionData;
    } catch (error) {
      logger.error('Error creating session:', error);
      throw new Error('Failed to create session');
    }
  }

  /**
   * Check if session exists
   */
  async sessionExists(sessionId) {
    try {
      const sessionKey = `session:${sessionId}`;
      const exists = await redisClient.exists(sessionKey);
      return exists === 1;
    } catch (error) {
      logger.error('Error checking session existence:', error);
      return false;
    }
  }

  /**
   * Get session metadata
   */
  async getSession(sessionId) {
    try {
      const sessionKey = `session:${sessionId}`;
      const sessionData = await redisClient.get(sessionKey);

      if (!sessionData) return null;

      return JSON.parse(sessionData);
    } catch (error) {
      logger.error('Error getting session:', error);
      return null;
    }
  }

  /**
   * Update session activity timestamp
   */
  async updateSessionActivity(sessionId) {
    try {
      const session = await this.getSession(sessionId);
      if (!session) return false;

      session.lastActivity = new Date().toISOString();

      const sessionKey = `session:${sessionId}`;
      await redisClient.set(sessionKey, JSON.stringify(session), { EX: this.sessionTTL });

      return true;
    } catch (error) {
      logger.error('Error updating session activity:', error);
      return false;
    }
  }

  /**
   * Add message to session
   */
  async addMessage(sessionId, message) {
    try {
      const messagesKey = `session:${sessionId}:messages`;

      // Add message to list (Redis v4: lPush)
      await redisClient.lPush(messagesKey, JSON.stringify(message));

      // Trim list to max messages
      await redisClient.lTrim(messagesKey, 0, this.maxMessagesPerSession - 1);

      // Update session metadata
      const session = await this.getSession(sessionId);
      if (session) {
        session.messageCount = await redisClient.lLen(messagesKey);
        session.lastActivity = new Date().toISOString();

        const sessionKey = `session:${sessionId}`;
        await redisClient.set(sessionKey, JSON.stringify(session), { EX: this.sessionTTL });
      }

      // Reset TTL for messages
      await redisClient.expire(messagesKey, this.sessionTTL);

      logger.debug(`Added message to session ${sessionId}: ${message.type}`);
    } catch (error) {
      logger.error('Error adding message to session:', error);
      throw new Error('Failed to add message');
    }
  }

  /**
   * Get session message history
   */
  async getSessionHistory(sessionId, limit = 50) {
    try {
      const messagesKey = `session:${sessionId}:messages`;
      const messages = await redisClient.lRange(messagesKey, 0, limit - 1);

      const parsedMessages = messages
        .map(msg => JSON.parse(msg))
        .reverse();

      logger.debug(`Retrieved ${parsedMessages.length} messages for session ${sessionId}`);
      return parsedMessages;
    } catch (error) {
      logger.error('Error getting session history:', error);
      return [];
    }
  }

  /**
   * Get message count for session
   */
  async getMessageCount(sessionId) {
    try {
      const messagesKey = `session:${sessionId}:messages`;
      const count = await redisClient.lLen(messagesKey);
      return count;
    } catch (error) {
      logger.error('Error getting message count:', error);
      return 0;
    }
  }

  /**
   * Clear session messages
   */
  async clearSession(sessionId) {
    try {
      const messagesKey = `session:${sessionId}:messages`;
      await redisClient.del(messagesKey);

      const session = await this.getSession(sessionId);
      if (session) {
        session.messageCount = 0;
        session.lastActivity = new Date().toISOString();

        const sessionKey = `session:${sessionId}`;
        await redisClient.set(sessionKey, JSON.stringify(session), { EX: this.sessionTTL });
      }

      logger.info(`Cleared session: ${sessionId}`);
    } catch (error) {
      logger.error('Error clearing session:', error);
      throw new Error('Failed to clear session');
    }
  }

  /**
   * Delete session completely
   */
  async deleteSession(sessionId) {
    try {
      const sessionKey = `session:${sessionId}`;
      const messagesKey = `session:${sessionId}:messages`;

      await redisClient.del(sessionKey);
      await redisClient.del(messagesKey);

      logger.info(`Deleted session: ${sessionId}`);
    } catch (error) {
      logger.error('Error deleting session:', error);
      throw new Error('Failed to delete session');
    }
  }

  /**
   * Get all active sessions
   */
  async getActiveSessions() {
    try {
      const pattern = 'session:*';
      const keys = await redisClient.keys(pattern);

      const sessions = [];
      for (const key of keys) {
        if (!key.includes(':messages')) {
          const sessionData = await redisClient.get(key);
          if (sessionData) sessions.push(JSON.parse(sessionData));
        }
      }

      return sessions.sort((a, b) =>
        new Date(b.lastActivity) - new Date(a.lastActivity)
      );
    } catch (error) {
      logger.error('Error getting active sessions:', error);
      return [];
    }
  }

  /**
   * Get session statistics
   */
  async getSessionStats() {
    try {
      const sessions = await this.getActiveSessions();
      const now = new Date();

      const stats = {
        totalSessions: sessions.length,
        activeLastHour: 0,
        activeLastDay: 0,
        totalMessages: 0,
        averageMessagesPerSession: 0
      };

      for (const session of sessions) {
        const lastActivity = new Date(session.lastActivity);
        const hoursDiff = (now - lastActivity) / (1000 * 60 * 60);

        if (hoursDiff <= 1) stats.activeLastHour++;
        if (hoursDiff <= 24) stats.activeLastDay++;
        stats.totalMessages += session.messageCount || 0;
      }

      stats.averageMessagesPerSession = sessions.length
        ? Math.round(stats.totalMessages / sessions.length * 100) / 100
        : 0;

      return stats;
    } catch (error) {
      logger.error('Error getting session stats:', error);
      return {
        totalSessions: 0,
        activeLastHour: 0,
        activeLastDay: 0,
        totalMessages: 0,
        averageMessagesPerSession: 0
      };
    }
  }
}

module.exports = new SessionService();
