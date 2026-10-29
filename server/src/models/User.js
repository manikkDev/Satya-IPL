import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { newId } from '../lib/ids.js';

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },
        password: {
            type: String,
            required: true,
        },
        role: {
            type: String,
            enum: ['ops_analyst', 'ap_manager', 'auditor', 'admin'],
            default: 'ops_analyst',
            index: true,
        },
        companyId: { type: String, required: true, index: true },
        // v2 identity (02 §4): prefixed ULID, group memberships per entity,
        // platform role and session revocation version.
        v2id: { type: String, unique: true, sparse: true },
        memberships: {
            type: [{ groupId: String, entityId: String, roles: [String] }],
            default: [],
        },
        platformRole: { type: String, enum: ["platform_admin"], default: null },
        activeGroupId: { type: String },
        tokenVersion: { type: Number, default: 0 },
        active: { type: Boolean, default: true },
        institutionId: {
            type: Number,
            min: 0,
            max: 4,
            default: null,
        },
        customerRef: {
            type: String,
            unique: true,
            sparse: true,
            default: () => crypto.randomBytes(12).toString('hex'),
        },
        erasedAt: {
            type: Date,
            default: null,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

// Hash password before saving
userSchema.pre('save', async function () {
    if (this.isNew && !this.v2id) this.v2id = newId("usr");
    if (!this.isModified('password')) return;

    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
});

// Match user entered password to hashed password in database
userSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

// Exclude password when converting to JSON
userSchema.set('toJSON', {
    transform: (doc, ret) => {
        delete ret.password;
        return ret;
    }
});

const User = mongoose.model('User', userSchema);

export default User;
