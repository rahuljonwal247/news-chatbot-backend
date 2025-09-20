const express = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const ragService = require('../services/ragService');
const sessionService = require('../services/sessionService');
const { logger } = require('../utils/logger');

const router = express.Router();

// Rate limiting for chat endpoints
const chatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute per IP
  message: 'Too many chat requests, please wait a moment'
});

/**
 * POST /api/chat/message
 * Send a chat message (REST API alternative to Socket.IO)
 */
router.post('/message', 
  chatLimiter,
  [
    body('message').trim().isLength({ min: 1, max: 1000 }).withMessage('Message must be 1-1000 characters'),
    body('sessionId').isUUID().withMessage('Valid session ID required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { message, sessionId } = req.body;

      // Check if session exists
      const sessionExists = await sessionService.sessionExists(sessionId);
      if (!sessionExists) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Store user message
      const userMessage = {
        id: require('uuid').v4(),
        type: 'user',
        content: message,
        timestamp: new Date().toISOString()
      };

      await sessionService.addMessage(sessionId, userMessage);

      // Generate response
      const ragResult = await ragService.generateResponse(message, sessionId);

      // Store bot response
      const botMessage = {
        id: require('uuid').v4(),
        type: 'bot',
        content: ragResult.response,
        timestamp: new Date().toISOString(),
        sources: ragResult.sources || [],
        retrievedDocs: ragResult.retrievedDocs || 0
      };

      await sessionService.addMessage(sessionId, botMessage);

      res.json({
        success: true,
        userMessage,
        botMessage
      });

    } catch (error) {
      logger.error('Error in chat message endpoint:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/chat/history/:sessionId
 * Get chat history for a session
 */
router.get('/history/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const limit = parseInt(req.query.limit) || 50;

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID format' });
    }

    const sessionExists = await sessionService.sessionExists(sessionId);
    if (!sessionExists) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const history = await sessionService.getSessionHistory(sessionId, limit);

    res.json({
      success: true,
      sessionId,
      history,
      count: history.length
    });

  } catch (error) {
    logger.error('Error getting chat history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/chat/search
 * Search through chat messages
 */
router.get('/search', async (req, res) => {
  try {
    const { q: query, limit = 20 } = req.query;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: 'Search query required' });
    }

    if (query.length > 100) {
      return res.status(400).json({ error: 'Query too long (max 100 characters)' });
    }

    const results = await sessionService.searchMessages(query.trim(), parseInt(limit));

    res.json({
      success: true,
      query: query.trim(),
      results,
      count: results.reduce((total, r) => total + r.messages.length, 0)
    });

  } catch (error) {
    logger.error('Error searching messages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;