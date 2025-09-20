const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { connectRedis } = require('./config/redis');
const { connectQdrant } = require('./config/qdrant');
const { logger } = require('./utils/logger');
const chatRoutes = require('./routes/chat');
const sessionRoutes = require('./routes/session');
const { handleSocketConnection } = require('./services/socketService');
const ragService = require('./services/ragService');


class ChatbotServer {
  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        credentials: true
      }
    });
    this.port = process.env.PORT || 5000;
  }

  setupMiddleware() {
    // Security middleware
    this.app.use(helmet());
    
    // CORS configuration
    this.app.use(cors({
      origin: process.env.FRONTEND_URL || "http://localhost:3000",
      credentials: true
    }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: 'Too many requests from this IP, please try again later.'
    });
    this.app.use('/api/', limiter);

    // Body parsing middleware
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Request logging
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path} - ${req.ip}`);
      next();
    });
  }

  setupRoutes() {
    // API routes
    this.app.use('/api/chat', chatRoutes);
    this.app.use('/api/session', sessionRoutes);
    
    // Health check endpoint
    this.app.get('/api/health', (req, res) => {
      res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0'
      });
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({ error: 'Endpoint not found' });
    });

    // Error handling middleware
    this.app.use((error, req, res, next) => {
      logger.error('Unhandled error:', error);
      res.status(error.status || 500).json({
        error: process.env.NODE_ENV === 'production' 
          ? 'Internal server error' 
          : error.message
      });
    });
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      handleSocketConnection(socket, this.io);
    });
  }


 async setupServices() {
  try {
    // Connect Redis
    await connectRedis();
    logger.info('Connected to Redis');

    // Connect Qdrant
    await connectQdrant();
    logger.info('Connected to Qdrant');

    // Initialize RAGService (sets qdrantClient and collection)
    await ragService.init();
    logger.info('RAGService initialized successfully');

    logger.info('All services connected successfully');
  } catch (error) {
    logger.error('Failed to connect to services:', error);
    process.exit(1);
  }
}
  async start() {
    try {
      // Setup middleware and routes
      this.setupMiddleware();
      this.setupRoutes();
      this.setupSocketHandlers();

      // Connect to external services
      await this.setupServices();

      // Start server
      this.server.listen(this.port, () => {
        logger.info(`🚀 Server running on port ${this.port}`);
        logger.info(`🌐 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
        logger.info(`📊 Health check: http://localhost:${this.port}/api/health`);
      });

      // Graceful shutdown
      process.on('SIGTERM', this.shutdown.bind(this));
      process.on('SIGINT', this.shutdown.bind(this));

    } catch (error) {
      logger.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  shutdown() {
    logger.info('Shutting down server...');
    this.server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  }
}

// Start the server
const chatbotServer = new ChatbotServer();
chatbotServer.start();

module.exports = ChatbotServer;