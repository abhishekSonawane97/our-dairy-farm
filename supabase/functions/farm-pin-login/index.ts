import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const encoder = new TextEncoder();
const jsonHeaders = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin");
  const allowedOrigins = (Deno.env.get("FARM_PIN_ALLOWED_ORIGINS") ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  if (!origin) return {};
  const parsed = new URL(origin);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const octets = hostname.split(".").map(Number);
  const privateIpv4 = octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    && (octets[0] === 10
      || octets[0] === 192 && octets[1] === 168
      || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31
      || octets[0] === 169 && octets[1] === 254);
  const privateIpv6 = hostname === "::1" || /^(fc|fd|fe[89ab])/i.test(hostname);
  const privateLanHost = ["localhost", "127.0.0.1", "0.0.0.0"].includes(hostname)
    || privateIpv4 || privateIpv6;
  const localOriginAllowed = Deno.env.get("FARM_PIN_ALLOW_LOCAL_ORIGINS") === "true"
    && parsed.protocol === "http:" && privateLanHost;
  if (!allowedOrigins.includes(origin) && !localOriginAllowed) throw new Error("This app origin is not allowed to sign in.");
  return { "Access-Control-Allow-Origin": origin, "Vary": "Origin" };
}

function ipFromGateway(request: Request): string | null {
  // Hosted Supabase sets cf-connecting-ip at its gateway. Do not trust client-
  // supplied forwarding headers in production. The explicitly local-only
  // environment accepts simulated headers so separate devices can be tested.
  const localSimulation = Deno.env.get("FARM_PIN_ALLOW_LOCAL_ORIGINS") === "true";
  const candidate = localSimulation
    ? request.headers.get("x-dairy-test-ip")
      ?? request.headers.get("cf-connecting-ip")
      ?? request.headers.get("x-real-ip")
      ?? request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim()
    : request.headers.get("cf-connecting-ip");
  if (!candidate || candidate.length > 64) return null;
  return candidate;
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameHex(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  let difference = 0;
  for (let index = 0; index < 64; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function response(request: Request, status: number, body: Record<string, unknown>, extra: HeadersInit = {}): Response {
  let cors: HeadersInit = {};
  try { cors = corsHeaders(request); } catch { /* caller adds a generic origin error below */ }
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...jsonHeaders, ...cors, ...extra }
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    try {
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(request),
          "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Max-Age": "300",
          "Vary": "Origin"
        }
      });
    } catch {
      return new Response(null, { status: 403 });
    }
  }
  if (request.method !== "POST") return response(request, 405, { error: "Use POST to sign in." });

  let cors: HeadersInit;
  try { cors = corsHeaders(request); }
  catch { return response(new Request(request.url), 403, { error: "This app origin is not allowed to sign in." }); }

  const pinPepper = Deno.env.get("FARM_PIN_PEPPER");
  const pinHash = Deno.env.get("FARM_PIN_HASH");
  const ratePepper = Deno.env.get("FARM_PIN_RATE_PEPPER");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authEmail = Deno.env.get("FARM_AUTH_EMAIL");
  const authPassword = Deno.env.get("FARM_AUTH_PASSWORD");
  if (![pinPepper, pinHash, ratePepper, supabaseUrl, anonKey, serviceKey, authEmail, authPassword].every(Boolean)) {
    return response(request, 503, { error: "Farm PIN sign-in is not configured." }, cors);
  }

  const ip = ipFromGateway(request);
  if (!ip) return response(request, 503, { error: "The sign-in service could not identify this connection. Try again shortly." }, cors);

  try {
    const rateKey = await hmacHex(ratePepper!, ip);
    const admin = createClient(supabaseUrl!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    const { data: limit, error: limitError } = await admin.rpc("farm_pin_login_reserve", { p_ip_key: rateKey }).maybeSingle();
    if (limitError || !limit) throw new Error("Rate limit check failed.");
    if (!limit.allowed) {
      return response(request, 429, { error: "Too many attempts. Wait a little and try again." }, {
        ...cors,
        "Retry-After": String(Math.max(1, Number(limit.retry_after_seconds) || 900))
      });
    }

    let payload: { pin?: unknown };
    try {
      const length = Number(request.headers.get("content-length") ?? "0");
      if (length > 1024) return response(request, 400, { error: "Invalid PIN request." }, cors);
      payload = await request.json();
    } catch {
      return response(request, 400, { error: "Invalid PIN request." }, cors);
    }
    const suppliedPin = typeof payload.pin === "string" ? payload.pin : "";
    const candidate = /^\d{6}$/.test(suppliedPin) ? await hmacHex(pinPepper!, suppliedPin) : "";
    if (!sameHex(candidate, pinHash!)) {
      return response(request, 401, { error: "Incorrect PIN. No session was created." }, cors);
    }

    const auth = createClient(supabaseUrl!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    const { data: signedIn, error: authError } = await auth.auth.signInWithPassword({ email: authEmail!, password: authPassword! });
    if (authError || !signedIn.session || signedIn.user?.app_metadata?.farm_access !== true) {
      return response(request, 503, { error: "The farm account could not sign in. Contact the person who set up the app." }, cors);
    }

    const { error: clearError } = await admin.rpc("farm_pin_login_clear", { p_ip_key: rateKey });
    if (clearError) return response(request, 503, { error: "Sign-in could not be completed. Please try again." }, cors);
    return response(request, 200, {
      access_token: signedIn.session.access_token,
      refresh_token: signedIn.session.refresh_token,
      expires_in: signedIn.session.expires_in,
      token_type: signedIn.session.token_type,
      user: signedIn.user
    }, cors);
  } catch {
    // Do not log secrets, PINs, Auth errors, or request bodies.
    return response(request, 503, { error: "Farm PIN sign-in is temporarily unavailable. Try again shortly." }, cors);
  }
});
