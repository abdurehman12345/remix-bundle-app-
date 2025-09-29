import { createReadStream, statSync } from "fs";
import { extname, join } from "path";
import { authenticate } from "../shopify.server";

const MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export const loader = async ({ request, params }) => {
  // Must live under /apps/bundles/* because app proxy subpath = "bundles"
  try { await authenticate.public.appProxy(request); } catch (_) {}

  const file = (params.file || "").replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!file) return new Response("Not found", { status: 404 });

  const abs = join(process.cwd(), "public", "uploads", file);
  try {
    const st = statSync(abs);
    if (!st.isFile()) return new Response("Not found", { status: 404 });
    const stream = createReadStream(abs);
    const ct = MIME[extname(file).toLowerCase()] || "application/octet-stream";
    return new Response(stream, { headers: { "Content-Type": ct, "Cache-Control": "public, max-age=31536000, immutable" } });
  } catch (e) {
    return new Response("Not found", { status: 404 });
  }
};


