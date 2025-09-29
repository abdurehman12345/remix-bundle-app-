import { json } from "@remix-run/node";

// Injection removed by request. Keep route as a no-op to avoid 404s from old buttons/links.
export const loader = async () => json({ ok: false, error: "Injection disabled" }, { status: 410 });
export const action = async () => json({ ok: false, error: "Injection disabled" }, { status: 410 });


