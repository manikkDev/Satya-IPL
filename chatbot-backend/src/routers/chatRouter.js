import express from 'express';
import { uploadArray } from "../middleware/upload.js";
import { authenticate, requireAuth } from "../middleware/auth.js";
import { handleChatGenerate, handleChatStreamGenerate, getConversations, getConversationHistory, deleteConversation, handleMlGenerate, handleClassify } from "../controllers/chatController.js";

const router = express.Router();

// Create new chat or continue existing conversation (non-stream)
router.post('/', authenticate, requireAuth, uploadArray, handleChatGenerate);

// Stream chat responses
router.post('/stream', authenticate, requireAuth, uploadArray, handleChatStreamGenerate);

// Generate ML-ready JSON (P1–P6 format) from user prompt via Groq for the ML model
router.post('/ml-generate', authenticate, requireAuth, handleMlGenerate);

// Classify AML sample against P1–P6 patterns (scores 0–1, threshold 0.75)
router.post('/classify', authenticate, requireAuth, handleClassify);

// Get all conversations for the authenticated user
router.get('/conversations', authenticate, requireAuth, getConversations);

// Get a specific conversation with its messages
router.get('/conversations/:conversationId', authenticate, requireAuth, getConversationHistory);

// Delete a conversation
router.delete('/conversations/:conversationId', authenticate, requireAuth, deleteConversation);

export default router;
