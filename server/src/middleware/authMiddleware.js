import User from '../models/User.js';
import { verifyToken } from '../utils/jwt.js';

// v1 bearer auth. Every branch returns exactly one response — an empty or
// malformed "Bearer" header used to fall through to a second res.json()
// (ERR_HTTP_HEADERS_SENT). No query-string tokens and no unauthenticated
// fallback: without a valid bearer token the answer is always 401.
export const protect = async (req, res, next) => {
    const match = /^Bearer\s+(\S+)$/.exec((req.headers.authorization || '').trim());
    if (!match) {
        return res.status(401).json({ message: 'Not authorized, no token' });
    }
    try {
        const decoded = verifyToken(match[1]);
        req.user = await User.findById(decoded.id).select('-password');
        const audiences = Array.isArray(decoded.aud) ? decoded.aud : [decoded.aud];
        if (!req.user || !req.user.active || !req.user.companyId || decoded.domain !== 'satya-business-v1' || !audiences.includes('satya-business-v1') || decoded.companyId !== req.user.companyId) {
            return res.status(401).json({ message: 'Valid Satya company membership is required' });
        }
        if (req.user.erasedAt) {
            return res.status(403).json({ message: 'Account erased under a data-rights request' });
        }
    } catch {
        return res.status(401).json({ message: 'Not authorized, token failed' });
    }
    return next();
};
