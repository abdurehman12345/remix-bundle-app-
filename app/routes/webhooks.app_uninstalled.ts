import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import crypto from "crypto";
import prisma from "../db.server";

function verifyHmac(headers: Headers, rawBody: string): boolean {
  const secret = process.env.SHOPIFY_API_SECRET!;
  const hmac = headers.get("X-Shopify-Hmac-Sha256") || headers.get("x-shopify-hmac-sha256") || "";
  const digest = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  return Buffer.byteLength(hmac) > 0 && crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(digest));
}

export async function action({ request }: ActionFunctionArgs) {
  const raw = await request.text();
  if (!verifyHmac(request.headers, raw)) return json({ ok: false }, { status: 401 });
  const shop = request.headers.get("X-Shopify-Shop-Domain") || "";
  await prisma.shopSubscription.deleteMany({ where: { shop } }).catch(() => {});
  await prisma.shopSettings.update({ where: { shop }, data: { plan: "FREE" } }).catch(() => {});
  return json({ ok: true });
}

export const loader = () => json({ ok: false }, { status: 405 });


