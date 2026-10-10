import crypto from "node:crypto";
import express from "express";
import User from "../models/User.js";
import { signToken } from "../utils/jwt.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();
const view = (user) => ({ _id: String(user._id), name: user.name, email: user.email, role: user.role, companyId: user.companyId });
const token = (user) => signToken({ id: String(user._id), companyId: user.companyId, role: user.role, domain: "satya-business-v1" }, { expiresIn: "8h", audience: "satya-business-v1" });

router.post("/login", async (req, res, next) => {
  try {
    if (typeof req.body.email !== "string" || typeof req.body.password !== "string" || req.body.password.length > 128) return res.status(400).json({ message: "Email and password are required" });
    const user = await User.findOne({ email: req.body.email.trim().toLowerCase(), active: true });
    if (!user?.companyId || !(await user.matchPassword(req.body.password))) return res.status(401).json({ message: "Invalid email or password" });
    return res.json({ user: view(user), token: token(user) });
  } catch (error) { next(error); }
});

router.post("/signup", async (req, res, next) => {
  try {
    const secret = process.env.BUSINESS_INVITE_CODE || "";
    const supplied = typeof req.body.inviteCode === "string" ? req.body.inviteCode : "";
    if (!secret || Buffer.byteLength(secret) !== Buffer.byteLength(supplied) || !crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(supplied))) return res.status(403).json({ message: "Company access requires an invitation from your administrator" });
    if (req.body.role && req.body.role !== "ops_analyst") return res.status(403).json({ message: "Privileged roles must be provisioned by an administrator" });
    const { name, email, password } = req.body;
    if (typeof name !== "string" || name.length < 2 || name.length > 120 || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== "string" || password.length < 12 || password.length > 128) return res.status(422).json({ message: "Valid name, email and a 12–128 character password are required" });
    if (await User.exists({ email: email.toLowerCase() })) return res.status(409).json({ message: "Account already exists" });
    const user = await User.create({ name, email, password, role: "ops_analyst", companyId: process.env.INVITE_COMPANY_ID || "satya-demo", active: true });
    return res.status(201).json({ user: view(user), token: token(user) });
  } catch (error) { next(error); }
});
router.get("/profile", protect, (req, res) => res.json(view(req.user)));
export default router;
