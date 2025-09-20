const { v4: uuidv4 } = require('uuid');
const ragService = require('./ragService');
const sessionService = require('./sessionService');
const { logger } = require('../utils/logger');

class SocketService {
  constructor() {
    this.activeConnections = new Map();
  }

  handleConnection(socket, io) {
    logger.info(`New connection: ${socket.id}`);

    this.activeConnections.set(socket.id, {
      sessionId: null,
      connectedAt: new Date()
    });

    // --- Join Session ---
    socket.on('join_session', async (data) => {
      try {
        const { sessionId } = data;
        let validSessionId = sessionId;

        if (!sessionId || !(await sessionService.sessionExists(sessionId))) {
          validSessionId = uuidv4();
          await sessionService.createSession(validSessionId);
          logger.info(`Created new session: ${validSessionId}`);
        }

        const connectionInfo = this.activeConnections.get(socket.id);
        if (connectionInfo) connectionInfo.sessionId = validSessionId;

        socket.join(validSessionId);

        const history = await sessionService.getSessionHistory(validSessionId);
        socket.emit('session_joined', { sessionId: validSessionId, history });

        logger.info(`Socket ${socket.id} joined session ${validSessionId}`);
      } catch (error) {
        logger.error('Error joining session:', error);
        socket.emit('error', { message: 'Failed to join session' });
      }
    });

    // --- Chat Message ---
  //   socket.on('chat_message', async (data) => {
  //      logger.info('Received chat_message:', data); // <-- log this
  // const rawMessage = data.message || data.content;
  // if (!rawMessage || !rawMessage.trim()) {
  //   socket.emit('error', { message: 'Message cannot be empty' });
  //   return;
  // }
  //     try {
  //       const connectionInfo = this.activeConnections.get(socket.id);
  //       if (!connectionInfo || !connectionInfo.sessionId) {
  //         socket.emit('error', { message: 'No active session' });
  //         return;
  //       }

  //       // Handle both message and content fields
  //       const rawMessage = data.message || data.content;
  //       if (!rawMessage || !rawMessage.trim()) {
  //         socket.emit('error', { message: 'Message cannot be empty' });
  //         return;
  //       }

  //       const message = rawMessage.trim();
  //       if (message.length > 1000) {
  //         socket.emit('error', { message: 'Message too long (max 1000 characters)' });
  //         return;
  //       }

  //       const sessionId = connectionInfo.sessionId;
  //       const messageId = uuidv4();
  //       const timestamp = new Date().toISOString();

  //       // Store user message
  //       await sessionService.addMessage(sessionId, {
  //         id: messageId,
  //         type: 'user',
  //         content: message,
  //         timestamp
  //       });

  //       io.to(sessionId).emit('message_received', {
  //         id: messageId,
  //         type: 'user',
  //         content: message,
  //         timestamp
  //       });

  //       // Show typing indicator
  //       io.to(sessionId).emit('bot_typing', { isTyping: true });

  //       logger.info(`Processing message for session ${sessionId}: "${message.substring(0, 50)}..."`);

  //       const responseId = uuidv4();
  //       const responseTimestamp = new Date().toISOString();

       

  //       try {
  //         const ragResult = await ragService.generateResponse(message, sessionId);


  //         const botMessage = {
  //           id: responseId,
  //           type: 'bot',
  //           content: ragResult.response,
  //           timestamp: responseTimestamp,
  //           sources: ragResult.sources || [],
  //           retrievedDocs: ragResult.retrievedDocs || 0
  //         };

  //         await sessionService.addMessage(sessionId, botMessage);

  //         io.to(sessionId).emit('bot_typing', { isTyping: false });

  //         if (ragResult.response.length > 100) {
  //           await this.streamResponse(io, sessionId, botMessage);
  //         } else {
  //           io.to(sessionId).emit('message_received', botMessage);
  //         }

  //         logger.info(`Response generated for session ${sessionId} with ${ragResult.retrievedDocs} retrieved docs`);
  //       } catch (ragError) {
  //         logger.error('RAG service error:', ragError);

  //         io.to(sessionId).emit('bot_typing', { isTyping: false });

  //         const errorMessage = {
  //           id: responseId,
  //           type: 'bot',
  //           content: "I'm sorry, I encountered an error while processing your question. Please try again or rephrase your query.",
  //           timestamp: responseTimestamp,
  //           sources: [],
  //           isError: true
  //         };

  //         await sessionService.addMessage(sessionId, errorMessage);
  //         io.to(sessionId).emit('message_received', errorMessage);
  //       }

  //     } catch (error) {
  //       logger.error('Error handling chat message:', error);
  //       socket.emit('error', { message: 'Failed to process message' });
  //     }
  //   });


//   socket.on('chat_message', async (data) => {
//   logger.info('Received chat_message:', data);
  
//   try {
//     // Check connection first
//     const connectionInfo = this.activeConnections.get(socket.id);
//     if (!connectionInfo || !connectionInfo.sessionId) {
//       socket.emit('error', { message: 'No active session' });
//       return;
//     }

//     // Single message validation
//     const rawMessage = data.message || data.content;
//     if (!rawMessage || !rawMessage.trim()) {
//       socket.emit('error', { message: 'Message cannot be empty' });
//       return;
//     }

//     const message = rawMessage.trim();
//     if (message.length > 1000) {
//       socket.emit('error', { message: 'Message too long (max 1000 characters)' });
//       return;
//     }

//     const sessionId = connectionInfo.sessionId;
//     const messageId = uuidv4();
//     const timestamp = new Date().toISOString();

//     // Store user message
//     await sessionService.addMessage(sessionId, {
//       id: messageId,
//       type: 'user',
//       content: message,
//       timestamp
//     });

//     // Emit user message once
//     io.to(sessionId).emit('message_received', {
//       id: messageId,
//       type: 'user',
//       content: message,
//       timestamp
//     });

//     // Show typing indicator
//     io.to(sessionId).emit('bot_typing', { isTyping: true });

//     logger.info(`Processing message for session ${sessionId}: "${message.substring(0, 50)}..."`);

//     const responseId = uuidv4();
//     const responseTimestamp = new Date().toISOString();

//     try {
//       const ragResult = await ragService.generateResponse(message, sessionId);

//       const botMessage = {
//         id: responseId,
//         type: 'bot',
//         content: ragResult.response,
//         timestamp: responseTimestamp,
//         sources: ragResult.sources || [],
//         retrievedDocs: ragResult.retrievedDocs || 0
//       };

//       // Store bot message
//       await sessionService.addMessage(sessionId, botMessage);

//       // Stop typing indicator
//       io.to(sessionId).emit('bot_typing', { isTyping: false });

//       // Send response - choose ONE method only
//       if (ragResult.response.length > 100) {
//         // Use streaming for long responses
//         await this.streamResponse(io, sessionId, botMessage);
//       } else {
//         // Use direct emission for short responses
//         io.to(sessionId).emit('message_received', botMessage);
//       }

//       logger.info(`Response generated for session ${sessionId} with ${ragResult.retrievedDocs} retrieved docs`);
      
//     } catch (ragError) {
//       logger.error('RAG service error:', ragError);

//       // Stop typing indicator
//       io.to(sessionId).emit('bot_typing', { isTyping: false });

//       const errorMessage = {
//         id: responseId,
//         type: 'bot',
//         content: "I'm sorry, I encountered an error while processing your question. Please try again or rephrase your query.",
//         timestamp: responseTimestamp,
//         sources: [],
//         isError: true
//       };

//       // Store error message
//       await sessionService.addMessage(sessionId, errorMessage);
      
//       // Emit error message once
//       io.to(sessionId).emit('message_received', errorMessage);
//     }

//   } catch (error) {
//     logger.error('Error handling chat message:', error);
//     socket.emit('error', { message: 'Failed to process message' });
//   }
// });


socket.on('chat_message', async (data) => {
  const handlerId = `handler-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  logger.info(`🔵 ${handlerId} - START processing chat_message:`, data);
  
  try {
    const connectionInfo = this.activeConnections.get(socket.id);
    if (!connectionInfo || !connectionInfo.sessionId) {
      socket.emit('error', { message: 'No active session' });
      return;
    }

    const rawMessage = data.message || data.content;
    if (!rawMessage || !rawMessage.trim()) {
      socket.emit('error', { message: 'Message cannot be empty' });
      return;
    }

    const message = rawMessage.trim();
    if (message.length > 1000) {
      socket.emit('error', { message: 'Message too long (max 1000 characters)' });
      return;
    }

    const sessionId = connectionInfo.sessionId;
    const messageId = uuidv4();
    const timestamp = new Date().toISOString();

    logger.info(`🟡 ${handlerId} - About to store user message: ${messageId}`);

    // Store user message
    await sessionService.addMessage(sessionId, {
      id: messageId,
      type: 'user',
      content: message,
      timestamp
    });

    logger.info(`🟢 ${handlerId} - About to emit user message_received: ${messageId}`);

    // Emit user message
    io.to(sessionId).emit('message_received', {
      id: messageId,
      type: 'user',
      content: message,
      timestamp
    });

    logger.info(`✅ ${handlerId} - User message emitted: ${messageId}`);

    // Show typing indicator
    io.to(sessionId).emit('bot_typing', { isTyping: true });

    logger.info(`Processing message for session ${sessionId}: "${message.substring(0, 50)}..."`);

    const responseId = uuidv4();
    const responseTimestamp = new Date().toISOString();

    try {
      logger.info(`🔄 ${handlerId} - About to call RAG service`);
      
      const ragResult = await ragService.generateResponse(message, sessionId);

      logger.info(`🔄 ${handlerId} - RAG service completed, response length: ${ragResult.response.length}`);

      const botMessage = {
        id: responseId,
        type: 'bot',
        content: ragResult.response,
        timestamp: responseTimestamp,
        sources: ragResult.sources || [],
        retrievedDocs: ragResult.retrievedDocs || 0
      };

      logger.info(`🟡 ${handlerId} - About to store bot message: ${responseId}`);

      // Store bot message
      await sessionService.addMessage(sessionId, botMessage);

      logger.info(`🟢 ${handlerId} - Bot message stored: ${responseId}`);

      // Stop typing indicator
      io.to(sessionId).emit('bot_typing', { isTyping: false });

      logger.info(`🔵 ${handlerId} - Typing stopped. Response length: ${ragResult.response.length}`);

      // CRITICAL: Only emit once
      if (ragResult.response.length > 100) {
        logger.info(`🟠 ${handlerId} - Using streamResponse for: ${responseId}`);
        await this.streamResponse(io, sessionId, botMessage);
        logger.info(`🟠 ${handlerId} - streamResponse completed for: ${responseId}`);
      } else {
        logger.info(`🟢 ${handlerId} - Using direct emit for: ${responseId}`);
        io.to(sessionId).emit('message_received', botMessage);
        logger.info(`✅ ${handlerId} - Direct emit completed for: ${responseId}`);
      }

      logger.info(`🔴 ${handlerId} - FINISHED processing with ${ragResult.retrievedDocs} retrieved docs`);
      
    } catch (ragError) {
      logger.error(`❌ ${handlerId} - RAG service error:`, ragError);

      // Stop typing indicator
      io.to(sessionId).emit('bot_typing', { isTyping: false });

      const errorMessage = {
        id: responseId,
        type: 'bot',
        content: "I'm sorry, I encountered an error while processing your question. Please try again or rephrase your query.",
        timestamp: responseTimestamp,
        sources: [],
        isError: true
      };

      logger.info(`🟡 ${handlerId} - About to store error message: ${responseId}`);

      // Store error message
      await sessionService.addMessage(sessionId, errorMessage);
      
      logger.info(`🟢 ${handlerId} - About to emit error message: ${responseId}`);
      
      // Emit error message
      io.to(sessionId).emit('message_received', errorMessage);
      
      logger.info(`✅ ${handlerId} - Error message emitted: ${responseId}`);
    }

  } catch (error) {
    logger.error(`💥 ${handlerId} - Handler error:`, error);
    socket.emit('error', { message: 'Failed to process message' });
  }
});

    // --- Clear Session ---
    socket.on('clear_session', async () => {
      try {
        const connectionInfo = this.activeConnections.get(socket.id);
        if (!connectionInfo || !connectionInfo.sessionId) {
          socket.emit('error', { message: 'No active session' });
          return;
        }

        const sessionId = connectionInfo.sessionId;
        await sessionService.clearSession(sessionId);

        io.to(sessionId).emit('session_cleared', { sessionId });
        logger.info(`Session ${sessionId} cleared`);
      } catch (error) {
        logger.error('Error clearing session:', error);
        socket.emit('error', { message: 'Failed to clear session' });
      }
    });

    // --- Get Session Info ---
    socket.on('get_session_info', async () => {
      try {
        const connectionInfo = this.activeConnections.get(socket.id);
        if (!connectionInfo || !connectionInfo.sessionId) {
          socket.emit('session_info', { sessionId: null, messageCount: 0 });
          return;
        }

        const sessionId = connectionInfo.sessionId;
        const messageCount = await sessionService.getMessageCount(sessionId);

        socket.emit('session_info', {
          sessionId,
          messageCount,
          connectedAt: connectionInfo.connectedAt
        });
      } catch (error) {
        logger.error('Error getting session info:', error);
        socket.emit('error', { message: 'Failed to get session info' });
      }
    });

    // --- Disconnect ---
    socket.on('disconnect', (reason) => {
      logger.info(`Socket ${socket.id} disconnected: ${reason}`);
      this.activeConnections.delete(socket.id);
    });

    socket.on('error', (error) => {
      logger.error(`Socket error for ${socket.id}:`, error);
    });
  }

async streamResponse(io, sessionId, message) {
  const handlerId = `stream-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  console.log(`🟠 ${handlerId} - Starting stream for message: ${message.id}`);
  
  const words = message.content.split(' ');
  let streamedContent = '';
  const chunkSize = 3;
  const delay = 100;

  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    streamedContent += (i === 0 ? '' : ' ') + chunk;
    const isComplete = i + chunkSize >= words.length;

    // Only emit message_stream events, not message_received
    io.to(sessionId).emit('message_stream', {
      id: message.id,
      type: message.type,
      content: streamedContent,
      timestamp: message.timestamp,
      sources: isComplete ? message.sources : [],
      isComplete: isComplete,
      retrievedDocs: message.retrievedDocs
    });

    console.log(`📡 ${handlerId} - Streamed chunk ${Math.floor(i/chunkSize) + 1}, complete: ${isComplete}`);

    if (!isComplete) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // ❌ REMOVE THIS LINE - This was causing the duplicate!
  // io.to(sessionId).emit('message_received', message);
  
  console.log(`✅ ${handlerId} - Stream completed for message: ${message.id}`);
}

  getStats() {
    const connections = Array.from(this.activeConnections.values());
    const activeSessions = new Set(connections.filter(c => c.sessionId).map(c => c.sessionId));
    return {
      totalConnections: this.activeConnections.size,
      activeSessions: activeSessions.size,
      connectionsWithSessions: connections.filter(c => c.sessionId).length
    };
  }

  broadcastSystemMessage(io, message) {
    io.emit('system_message', { content: message, timestamp: new Date().toISOString() });
    logger.info(`Broadcasted system message: ${message}`);
  }

  async cleanupInactiveSessions() {
    try {
      const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
      let cleanedCount = 0;

      for (const [socketId, connectionInfo] of this.activeConnections.entries()) {
        if (connectionInfo.connectedAt < cutoffTime && connectionInfo.sessionId) {
          await sessionService.deleteSession(connectionInfo.sessionId);
          this.activeConnections.delete(socketId);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        logger.info(`Cleaned up ${cleanedCount} inactive sessions`);
      }
    } catch (error) {
      logger.error('Error cleaning up inactive sessions:', error);
    }
  }
}

const socketService = new SocketService();

// Export handlers
const handleSocketConnection = (socket, io) => {
  socketService.handleConnection(socket, io);
};

// Cleanup inactive sessions every hour
setInterval(() => {
  socketService.cleanupInactiveSessions();
}, 60 * 60 * 1000);

module.exports = {
  handleSocketConnection,
  getStats: () => socketService.getStats(),
  broadcastSystemMessage: (io, message) => socketService.broadcastSystemMessage(io, message)
};
