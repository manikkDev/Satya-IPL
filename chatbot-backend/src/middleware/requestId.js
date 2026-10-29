// requestId.js — every request gets an id echoed back in x-request-id and
// embedded in contract error bodies (details.requestId / error.requestId).

import { randomUUID } from "node:crypto";

export const requestId = (req, res, next) => {
  const incoming = req.headers["x-request-id"];
  req.id = typeof incoming === "string" && /^[\w.-]{8,80}$/.test(incoming) ? incoming : randomUUID();
  res.set("x-request-id", req.id);
  next();
};
