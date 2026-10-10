import rateLimit from 'express-rate-limit';

const json = (message) => ({ message });

// Credential endpoints: tight budget against brute force / credential stuffing.
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_AUTH || 30),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: json('Too many authentication attempts — try again later'),
});

// Everything else: generous but bounded.
export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_API || 1200),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: json('Rate limit exceeded'),
    skip: (req) => req.method === 'OPTIONS',
});

// Consent + rights workflows: write-heavy, keep modest.
export const writeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_WRITES || 200),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: json('Too many write requests — try again later'),
});
