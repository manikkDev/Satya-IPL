import jwt from 'jsonwebtoken';

export const getJwtSecret = () => {
    const secret = process.env.JWT_SECRET ? process.env.JWT_SECRET.trim() : '';
    if (!secret) throw new Error('JWT_SECRET is not set');
    return secret;
};

export const signToken = (payload, options = {}) => {
    return jwt.sign(payload, getJwtSecret(), options);
};

export const verifyToken = (token, audience = 'satya-business-v1') => {
    return jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'], audience });
};
