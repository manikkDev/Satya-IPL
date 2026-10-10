import jwt from 'jsonwebtoken';

const FALLBACK_SECRET = 'fallback_secret_key_123';

export const getJwtSecret = () => {
    const secret = process.env.JWT_SECRET ? process.env.JWT_SECRET.trim() : '';
    if (secret) return secret;
    if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET is not set');
    }
    return FALLBACK_SECRET;
};

export const signToken = (payload, options = {}) => {
    return jwt.sign(payload, getJwtSecret(), options);
};

export const verifyToken = (token) => {
    return jwt.verify(token, getJwtSecret());
};
