// internalToken.js — service-to-service auth for /internal/* routes.
// Contract 02 §1: calls carry `x-internal-token: $NODE_INTERNAL_TOKEN`.

export const requireInternalToken = (req, res, next) => {
  const expected = process.env.NODE_INTERNAL_TOKEN;
  if (!expected) {
    return res.status(503).json({
      error: { code: "UPSTREAM_UNAVAILABLE", message: "Internal auth is not configured" },
    });
  }
  const token = req.headers["x-internal-token"];
  if (token !== expected) {
    return res.status(403).json({
      error: { code: "FORBIDDEN", message: "Internal access only", details: { reason: "bad_internal_token" } },
    });
  }
  return next();
};
