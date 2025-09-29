// Deprecated incorrect singular path; keep to avoid 404s but return 410
import { json } from "@remix-run/node";
export const loader = async () => json({ error: "Gone" }, { status: 410 });
export const action = async () => json({ error: "Gone" }, { status: 410 });


