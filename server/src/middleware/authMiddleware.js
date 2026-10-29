import User from '../models/User.js';
import { verifyToken } from '../utils/jwt.js';

export const protect = async (req, res, next) => {
    let token;
    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer')
    ) {
        // Get token from header (Bearer <token>)
        const parts = req.headers.authorization.split(' ');
        token = parts[1];
    } else if (req.query && req.query.token) {
        // Fallback: token passed via query parameter (crucial for browser file downloads / exports)
        token = req.query.token;
    }

    if (token && token.trim() !== '') {
        try {
            // Verify token
            const decoded = verifyToken(token);

            // Get user from the token
            req.user = await User.findById(decoded.id).select('-password');

            const audiences = Array.isArray(decoded.aud) ? decoded.aud : [decoded.aud];
            if (!req.user || !req.user.active || !req.user.companyId || decoded.domain !== 'satya-business-v1' || !audiences.includes('satya-business-v1') || decoded.companyId !== req.user.companyId) {
                return res.status(401).json({ message: 'Valid Satya company membership is required' });
            }
            if (req.user.erasedAt) {
                return res.status(403).json({ message: 'Account erased under a data-rights request' });
            }

            return next();
        } catch (error) {
            console.error('Auth verification error:', error.message);
            if (process.env.DEMO_MODE !== '1') {
                return res.status(401).json({ message: 'Not authorized, token failed' });
            }
        }
    }

    // Demo Mode seamless fallback for browser file downloads, CSV/PDF exports, and reports
    if (process.env.DEMO_MODE === '1') {
        const demoUser = await User.findOne({ email: 'manager@satya.demo', active: true }).select('-password');
        if (demoUser) {
            req.user = demoUser;
            return next();
        }
    }

    return res.status(401).json({ message: 'Not authorized, no token' });
};
