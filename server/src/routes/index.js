import express from 'express';
import { apiLimiter, authLimiter, writeLimiter } from '../middleware/rateLimit.js';
import authRoutes from './businessAuth.js';
import businessRoutes from './businessRoutes.js';
import conversationRoutes from "./conversationRoutes.js";

const router = express.Router();

router.use(apiLimiter);

// Health check route
router.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'API is healthy' });
});

// Authentication routes
router.use('/auth', (req, res, next) => req.method === 'POST' ? authLimiter(req, res, next) : next(), authRoutes);
router.use('/v1', writeLimiter, businessRoutes);
router.use('/conversations', conversationRoutes);
// Add your resource routes here

export default router;
