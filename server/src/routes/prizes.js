import { Router } from "express";
import { resolvePrizeAssetMeta } from "../services/prizes/prizeAssetMeta.js";

const router = Router();

/**
 * GET /api/prizes/asset-meta?kind=SOL|SPL|NFT&mint=
 * Public metadata for prize display (logos / NFT thumbnails).
 */
router.get("/asset-meta", async (req, res) => {
  try {
    const kind = String(req.query.kind || "").toUpperCase();
    const mint = typeof req.query.mint === "string" ? req.query.mint.trim() : "";
    if (!["SOL", "SPL", "NFT"].includes(kind)) {
      return res.status(400).json({ error: "kind must be SOL, SPL, or NFT" });
    }
    if ((kind === "SPL" || kind === "NFT") && !mint) {
      return res.status(400).json({ error: "mint required for SPL/NFT" });
    }
    const meta = await resolvePrizeAssetMeta({ kind, mint: mint || undefined });
    res.json({ kind, mint: mint || null, ...meta });
  } catch (err) {
    console.error("[prizes/asset-meta]", err?.message || err);
    res.status(500).json({ error: "Failed to resolve asset metadata" });
  }
});

export default router;
