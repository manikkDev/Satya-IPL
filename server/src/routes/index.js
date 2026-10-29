import express from 'express';
import { apiLimiter, authLimiter, writeLimiter } from '../middleware/rateLimit.js';
import authRoutes from './businessAuth.js';
import businessRoutes from './businessRoutes.js';
import conversationRoutes from "./conversationRoutes.js";
import contractRoutes from "./contractRoutes.js";
import predictiveRiskRoutes from "./predictiveRiskRoutes.js";
import outboxRoutes from "./outboxRoutes.js";
import v2Routes from "./v2/index.js";

const router = express.Router();

router.use(apiLimiter);

// Health check route
router.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'API is healthy' });
});

// Authentication routes
router.use('/auth', (req, res, next) => req.method === 'POST' ? authLimiter(req, res, next) : next(), authRoutes);
router.use('/v1/contracts', writeLimiter, contractRoutes);
router.use('/v1/predictive-risk', writeLimiter, predictiveRiskRoutes);
router.use('/v1/outbox', writeLimiter, outboxRoutes);
router.use('/v1', writeLimiter, businessRoutes);
router.use('/v2', v2Routes);
router.use('/conversations', conversationRoutes);
// Add your resource routes here

export default router;
