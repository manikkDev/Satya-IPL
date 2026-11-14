import express from 'express';
import mongoose from 'mongoose';
import { apiLimiter, authLimiter, writeLimiter } from '../middleware/rateLimit.js';
import authRoutes from './businessAuth.js';
import businessRoutes from './businessRoutes.js';
import conversationRoutes from "./conversationRoutes.js";
import v2Routes from "./v2/index.js";
import internalRoutes from "./internal.js";

const router = express.Router();

// Liveness: always 200 once the port is bound (Render health check);
// `db` says whether data routes can be served yet. Mounted before the rate
// limiter so platform probes never get throttled.
router.get('/health', (req, res) => {
    const db = ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown';
    res.status(200).json({ status: 'OK', message: 'API is healthy', db });
});

router.use(apiLimiter);

// Authentication routes
router.use('/auth', (req, res, next) => req.method === 'POST' ? authLimiter(req, res, next) : next(), authRoutes);
router.use('/v1', writeLimiter, businessRoutes);
router.use('/v2', v2Routes);
router.use('/internal', internalRoutes);
router.use('/conversations', conversationRoutes);
// Add your resource routes here

export default router;
