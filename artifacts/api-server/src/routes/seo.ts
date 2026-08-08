import { Router } from "express";
import { getPublicBaseUrl } from "../lib/public-url";

const router = Router();

router.get("/robots.txt", (_req, res) => {
  const baseUrl = getPublicBaseUrl();
  res.type("text/plain").send(`User-agent: *\nDisallow: /api/\nSitemap: ${baseUrl}/sitemap.xml\n`);
});

router.get("/sitemap.xml", (_req, res) => {
  const baseUrl = getPublicBaseUrl();
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${baseUrl}/</loc></url><url><loc>${baseUrl}/about</loc></url></urlset>`);
});

export default router;
