import User from '../models/User.js';
import { verifyToken } from '../utils/jwt.js';

export const protect = async (req, res, next) => {
    let token;
    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer')
    ) {
        try {
            // Get token from header (Bearer <token>)
            const parts = req.headers.authorization.split(' ');
            token = parts[1];

            if (!token || token.trim() === '') {
                return res.status(401).json({ message: 'Not authorized, no token provided' });
            }

            // Verify token
            const decoded = verifyToken(token);

            // Get user from the token
            req.user = await User.findById(decoded.id).select('-password');

            if (!req.user || !req.user.active || !req.user.companyId || decoded.domain !== 'satya-business-v1' || decoded.aud !== 'satya-business-v1' || decoded.companyId !== req.user.companyId) {
                return res.status(401).json({ message: 'Valid Satya company membership is required' });
            }
            if (req.user.erasedAt) {
                return res.status(403).json({ message: 'Account erased under a data-rights request' });
            }

            return next();
        } catch (error) {
            console.error('Auth verification error:', error.message);
            return res.status(401).json({ message: 'Not authorized, token failed' });
        }
    }

    if (!token) {
        return res.status(401).json({ message: 'Not authorized, no token' });
    }
};
