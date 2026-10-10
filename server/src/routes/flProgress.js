import express from "express";

const router = express.Router();

router.post("/fl/progress", (req, res) => {
  if (!process.env.NODE_INTERNAL_TOKEN || req.headers["x-internal-token"] !== process.env.NODE_INTERNAL_TOKEN) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  if (!req.body?.run_id || !req.body?.event) {
    return res.status(400).json({ message: "run_id and event are required" });
  }
  const io = req.app.get("io");
  io.to(`fl:${req.body.run_id}`).emit("fl:progress", req.body);
  io.emit("fl:any", req.body);
  return res.json({ ok: true });
});

export default router;
