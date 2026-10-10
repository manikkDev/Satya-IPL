import jwt from "jsonwebtoken";

const tokenFrom = (req) => {
  const value = req.headers.authorization || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : null;
};

export const authenticate = (req, _res, next) => {
  const token = tokenFrom(req);
  if (!token || !process.env.JWT_SECRET) {
    req.user = null;
    req.userId = null;
    return next();
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      id: decoded.id,
      _id: decoded.id,
      role: decoded.role || "citizen",
      institutionId: decoded.institutionId ?? null,
    };
    req.userId = decoded.id;
  } catch {
    req.user = null;
    req.userId = null;
  }
  return next();
};

export const requireAuth = (req, res, next) => {
  if (!req.userId) return res.status(401).json({ error: "Authentication required" });
  return next();
};

export const protect = [authenticate, requireAuth];

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  return next();
};

export const audit = async (req, action, target = null, meta = {}) => {
  const base = process.env.GRAPH_API_URL || "http://localhost:5002";
  const response = await fetch(`${base}/api/audit/internal`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-token": process.env.NODE_INTERNAL_TOKEN || "",
    },
    body: JSON.stringify({
      actor: req.user?.id || null,
      role: req.user?.role || "system",
      institutionId: req.user?.institutionId ?? null,
      action,
      target,
      meta,
    }),
  });
  if (!response.ok) throw new Error(`Audit API returned ${response.status}`);
};
