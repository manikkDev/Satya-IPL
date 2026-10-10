import express from 'express';
import { apiLimiter, authLimiter, writeLimiter } from '../middleware/rateLimit.js';
import authRoutes from './authRoutes.js';
import graphRouter from "./graph.js";
import userRoutes from "./userRoutes.js";
import consentRoutes from "./consentRoutes.js";
import auditRoutes from "./auditRoutes.js";
import flProgressRouter from "./flProgress.js";
import conversationRoutes from "./conversationRoutes.js";

const router = express.Router();

router.use(apiLimiter);

// Health check route
router.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'API is healthy' });
});

// Authentication routes
router.use('/auth', authLimiter, authRoutes);
router.use('/users', writeLimiter, userRoutes);
router.use('/consent', writeLimiter, consentRoutes);
router.use('/audit', auditRoutes);
router.use('/conversations', conversationRoutes);
router.use("/", flProgressRouter);
router.use("/", graphRouter);
// Add your resource routes here

export default router;
