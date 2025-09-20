const express = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const sessionService = require('../services/sessionService');
const { logger } = require('../utils/logger');

const router = express.Router();

/**
 * POST /api/session/create
 * Create a new chat session
 */
router.post('/create', async (req, res) => {
  try {
    const sessionId = uuidv4();
    const session = await sessionService.createSession(sessionId);
    
    res.json({
      success: true,
      session
    });

  } catch (error) {
    logger.error('Error creating session:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

/**
 * GET /api/session/:sessionId
 * Get session information
 */
router.get('/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID format' });
    }

    const session = await sessionService.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const messageCount = await sessionService.getMessageCount(sessionId);

    res.json({
      success: true,
      session: {
        ...session,
        messageCount
      }
    });

  } catch (error) {
    logger.error('Error getting session:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/session/:sessionId/clear
 * Clear session messages
 */
router.delete('/:sessionId/clear', async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID format' });
    }

    const sessionExists = await sessionService.sessionExists(sessionId);
    if (!sessionExists) {
      return res.status(404).json({ error: 'Session not found' });
    }

    await sessionService.clearSession(sessionId);

    res.json({
      success: true,
      message: 'Session cleared successfully'
    });

  } catch (error) {
    logger.error('Error clearing session:', error);
    res.status(500).json({ error: 'Failed to clear session' });
  }
});

/**
 * GET /api/session/:sessionId/export
 * Export session data
 */
router.get('/:sessionId/export', async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID format' });
    }

    const exportData = await sessionService.exportSession(sessionId);
    if (!exportData) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({
      success: true,
      exportData
    });

  } catch (error) {
    logger.error('Error exporting session:', error);
    res.status(500).json({ error: 'Failed to export session' });
  }
});

/**
 * GET /api/session/stats
 * Get session statistics
 */
router.get('/', async (req, res) => {
  try {
    const stats = await sessionService.getSessionStats();

    res.json({
      success: true,
      stats
    });

  } catch (error) {
    logger.error('Error getting session stats:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

module.exports = router;