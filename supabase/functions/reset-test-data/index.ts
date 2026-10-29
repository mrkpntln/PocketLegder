import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://mrkpntln.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin"
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function tokenClaims(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    const origin = req.headers.get("origin");
    if (origin && origin !== "https://mrkpntln.github.io") return jsonResponse({ error: "Origin not allowed." }, 403);
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  const origin = req.headers.get("origin");
  if (origin && origin !== "https://mrkpntln.github.io") return jsonResponse({ error: "Origin not allowed." }, 403);

  try {
    const confirmation = (await req.json())?.confirmation;
    if (confirmation !== "RESET MY DATA") return jsonResponse({ error: "Confirmation phrase did not match." }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !publishableKey || !serviceKey) {
      console.error("Required Supabase Edge Function environment variables are missing.");
      return jsonResponse({ error: "Secure reset is not configured on the server." }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) return jsonResponse({ error: "Sign in again before resetting data." }, 401);
    const accessToken = match[1];
    const claims = tokenClaims(accessToken);
    const authTime = Number(claims?.auth_time ?? claims?.iat ?? 0);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!authTime || authTime > nowSeconds + 30 || nowSeconds - authTime > 300) {
      return jsonResponse({ error: "For security, verify your password again and retry." }, 401);
    }

    const userClient = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } }
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
    if (userError || !userData?.user?.id) return jsonResponse({ error: "Your sign-in could not be verified. Please sign in again." }, 401);
    const userId = userData.user.id;

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const deletedAt = new Date().toISOString();
    const payload = { data: {}, deleted_at: deletedAt, updated_at: deletedAt };
    const results = await Promise.all([
      admin.from("ledger_transactions").update(payload).eq("user_id", userId),
      admin.from("plan_items").update(payload).eq("user_id", userId),
      admin.from("payment_history").update(payload).eq("user_id", userId)
    ]);
    const failed = results.find((result) => result.error);
    if (failed?.error) {
      console.error("One or more account-scoped reset updates failed:", failed.error.message);
      return jsonResponse({ error: "The server could not finish resetting every record. Please retry or contact support." }, 500);
    }
    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("Reset request failed:", error instanceof Error ? error.message : "Unknown error");
    return jsonResponse({ error: "Invalid request or secure reset failed." }, 400);
  }
});
