import User from "../models/User.js";
import { signToken } from "../utils/jwt.js";
import { google } from "googleapis";
import crypto from "crypto";

const generateToken = (user) => signToken(
  { id: user._id, role: user.role, institutionId: user.institutionId },
  { expiresIn: process.env.JWT_EXPIRES_IN || "30d" },
);

// @desc    Google login/signup (simple)
// @route   POST /api/users/google
// @access  Public
export const googleAuth = async (req, res) => {
  try {
    const { name, email, password, code, role = "citizen" } = req.body || {};
    if (role !== "citizen") {
      return res.status(403).json({ message: "Bank employee accounts require an institution invitation" });
    }
    const normalizedInstitutionId = null;

    let resolvedName = name;
    let resolvedEmail = email;
    let resolvedPassword = password;
    
    if (code) {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        return res
          .status(500)
          .json({ message: "Google OAuth is not configured on the server" });
      }

      const oauth2Client = new google.auth.OAuth2(
        clientId,
        clientSecret,
        "postmessage",
      );
console.log("fwefweiofjw");
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);
// console.log("fwefweiofjw");
      const oauth2 = google.oauth2({ auth: oauth2Client, version: "v2" });
      // console.log("fwefweiofjw");
      const {data} = await oauth2.userinfo.get();
// console.log(data,"fwefweiofjw");
      resolvedName = resolvedName || data?.name || data?.given_name;
      resolvedEmail = resolvedEmail || data?.email;
      resolvedPassword =
        resolvedPassword || crypto.randomBytes(24).toString("hex");
    }
// console.log("fwefweiofjw");
    if (!resolvedName || !resolvedEmail || !resolvedPassword) {
      return res
        .status(400)
        .json({ message: "Please provide name, email, and password" });
    }
    let user = await User.findOne({ email: resolvedEmail });
    
console.log("fwefweiofjw");
    if (!user) {
      user = await User.create({
        name: resolvedName,
        email: resolvedEmail,
        password: resolvedPassword,
        role,
        institutionId: normalizedInstitutionId,
      });
    }

    return res.status(200).json({
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        institutionId: user.institutionId,
        customerRef: user.customerRef,
      },
      token: generateToken(user),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
