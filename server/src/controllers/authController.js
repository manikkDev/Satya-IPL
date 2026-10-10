import crypto from 'crypto';
import User from '../models/User.js';
import { signToken } from '../utils/jwt.js';

const INVITE_CODE = process.env.ANALYST_INVITE_CODE || '';

const inviteCodeMatches = (provided) => {
    if (!INVITE_CODE || typeof provided !== 'string' || !provided) return false;
    const expected = Buffer.from(INVITE_CODE);
    const actual = Buffer.from(provided);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

const generateToken = (user) => {
    return signToken(
        { id: user._id, role: user.role, institutionId: user.institutionId },
        { expiresIn: process.env.JWT_EXPIRES_IN || '30d' },
    );
};

const userResponse = (user) => ({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    institutionId: user.institutionId,
    customerRef: user.customerRef,
});

// @desc    Register a new user
// @route   POST /api/auth/signup
// @access  Public
export const signupUser = async (req, res) => {
    try {
        const { name, email, password, role = 'citizen', inviteCode, institutionId } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ message: 'Please provide all required fields' });
        }
        let normalizedInstitutionId = null;
        if (role === 'analyst') {
            // Invite-only: analysts are provisioned with an institution-issued code.
            if (!inviteCodeMatches(inviteCode)) {
                return res.status(403).json({ message: 'Bank employee accounts require a valid institution invitation code' });
            }
            const institution = Number(institutionId);
            if (!Number.isInteger(institution) || institution < 0 || institution > 4) {
                return res.status(400).json({ message: 'A valid institution (0-4) is required for analyst accounts' });
            }
            normalizedInstitutionId = institution;
        } else if (role !== 'citizen') {
            return res.status(403).json({ message: 'Bank employee accounts require an institution invitation' });
        }

        const userExists = await User.findOne({ email });

        if (userExists) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const user = await User.create({
            name,
            email,
            password,
            role,
            institutionId: normalizedInstitutionId,
        });

        if (user) {
            res.status(201).json({
                user: userResponse(user),
                token: generateToken(user),
            });
        } else {
            res.status(400).json({ message: 'Invalid user data received' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Auth user & get token
// @route   POST /api/auth/login
// @access  Public
export const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        const user = await User.findOne({ email });

        if (user?.erasedAt) {
            return res.status(403).json({ message: 'This account was erased under a data-rights request' });
        }
        if (user && (await user.matchPassword(password))) {
            res.json({
                user: userResponse(user),
                token: generateToken(user),
            });
        } else {
            // Return same generic error message for invalid email or password
            res.status(401).json({ message: 'Invalid email or password' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get user profile (Protected example route)
// @route   GET /api/auth/profile
// @access  Private
export const getUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);

        if (user) {
            res.json(userResponse(user));
        } else {
            res.status(404).json({ message: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
