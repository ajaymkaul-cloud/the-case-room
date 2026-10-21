import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function cleanString(v: unknown, max = 160): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function normalizeCaseId(v: unknown): "001" | "002" | null {
  const s = String(v ?? "").replace(/^case[-_ ]?/i, "").padStart(3, "0");
  return s === "001" || s === "002" ? s : null;
}
async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function deepEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
  }
  return JSON.stringify(a) === JSON.stringify(b);
}
function configCase(config: any, caseId: "001" | "002") {
  // Accept either {"001": {...}, "002": {...}} or {"cases":{"001": {...}}}.
  const root = config?.cases ?? config;
  const item = root?.[caseId] ?? root?.[`case-${caseId}`] ?? root?.[`case_${caseId}`];
  if (!item || typeof item !== "object") return null;
  const answer = item.answer ?? item.correct_answer ?? item.solution?.answer;
  const solution = item.solution_text ?? item.solution_narrative ?? (typeof item.solution === "string" ? item.solution : item.narrative);
  return answer && typeof solution === "string" ? { answer, solution } : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405);

  let body: any;
  try { body = await req.json(); } catch { return reply({ error: "Request body must be valid JSON." }, 400); }
  const action = cleanString(body?.action, 24);
  const caseId = normalizeCaseId(body?.case_id);
  const mechanic = cleanString(body?.mechanic, 24);
  if (!caseId || (caseId === "001" && mechanic !== "matrix") || (caseId === "002" && mechanic !== "dossier")) {
    return reply({ error: "Invalid case configuration." }, 400);
  }
  if (!["start", "accuse", "reveal"].includes(action)) return reply({ error: "Unsupported action." }, 400);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return reply({ error: "Case server configuration is incomplete." }, 500);
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const optIn = body?.analytics_opt_in === true && typeof body?.analytics_session_id === "string";
  const analyticsId = optIn ? body.analytics_session_id : null;
  const uaClass = body?.user_agent_class === "mobile" ? "mobile" : body?.user_agent_class === "desktop" ? "desktop" : null;
  async function track(event_name: string, outcome: string | null = null) {
    if (!optIn) return;
    try {
      await supabase.from("case_game_analytics").insert({
        event_name, case_id: caseId, analytics_session_id: analyticsId,
        user_agent_class: uaClass, outcome,
      });
    } catch (_) { /* Analytics must never block gameplay. */ }
  }
  const configText = Deno.env.get("CASE_ROOM_CASE_CONFIG");
  let gameConfig: any;
  try { gameConfig = configText ? JSON.parse(configText) : null; } catch {
    return reply({ error: "The case configuration secret is not valid JSON." }, 500);
  }
  const caseConfig = configCase(gameConfig, caseId);
  if (!caseConfig) return reply({ error: "The answer key or solution is missing from the case configuration." }, 500);

  let token = cleanString(body?.session_id, 160);
  let tokenHash = token ? await sha256(token) : "";
  let session: any = null;
  if (tokenHash) {
    const { data, error } = await supabase.from("case_game_sessions")
      .select("id,token_hash,case_id,mechanic,status,attempts,started_at,expires_at")
      .eq("token_hash", tokenHash).maybeSingle();
    if (error) return reply({ error: "Could not load case session." }, 500);
    session = data;
    if (session && (session.case_id !== caseId || session.mechanic !== mechanic)) {
      return reply({ error: "This session belongs to a different case." }, 400);
    }
    if (session && Date.parse(session.expires_at) <= Date.now()) {
      await supabase.from("case_game_sessions").delete().eq("id", session.id);
      return reply({ error: "Your case session expired. Start a new session.", code: "SESSION_EXPIRED" }, 410);
    }
  }

  if (action === "start") {
    if (!session) {
      token = randomToken();
      tokenHash = await sha256(token);
      const { data, error } = await supabase.from("case_game_sessions").insert({
        token_hash: tokenHash, case_id: caseId, mechanic, status: "open", attempts: 0,
      }).select("id,case_id,mechanic,status,attempts,started_at,expires_at").single();
      if (error || !data) return reply({ error: "Could not create a case session." }, 500);
      session = data;
      await track("case_started");
    }
    return reply({
      session_id: token, case_id: caseId, status: session.status, attempts: session.attempts,
      started_at: session.started_at, expires_at: session.expires_at,
    });
  }

  if (!session) return reply({ error: "Case session not found. Reload the page to start a new session." }, 400);

  if (action === "reveal") {
    if (session.status === "open") return reply({ error: "The solution is available only after the case is closed." }, 403);
    return reply({ status: session.status, attempts: session.attempts, solution: caseConfig.solution });
  }

  if (session.status !== "open") return reply({ error: "This case is already closed.", status: session.status, attempts: session.attempts }, 409);
  const maxAttempts = caseId === "001" ? 2 : Number.POSITIVE_INFINITY;
  if (session.attempts >= maxAttempts) {
    return reply({ error: "No attempts remain.", status: "failed", attempts: session.attempts }, 409);
  }

  let correct = false;
  if (caseId === "001") {
    const suspect = cleanString(body?.suspect, 100);
    const method = cleanString(body?.method, 160);
    const location = cleanString(body?.location, 160);
    if (!suspect || !method || !location) return reply({ error: "Select a suspect, method, and location." }, 400);
    const expected = caseConfig.answer;
    correct = suspect === expected.suspect && method === expected.method && location === expected.location;
  } else {
    const suspect = cleanString(body?.suspect, 100).toLowerCase();
    const exhibits = Array.isArray(body?.exhibits) ? body.exhibits.map((x: unknown) => cleanString(x, 8)).filter(Boolean) : [];
    if (!suspect || exhibits.length === 0 || exhibits.length > 8) return reply({ error: "Select a suspect and the relevant exhibits." }, 400);
    const expected = caseConfig.answer;
    const expectedSuspect = cleanString(expected.suspect, 100).toLowerCase();
    correct = suspect === expectedSuspect && deepEqual(exhibits, expected.exhibits);
  }

  const attempts = session.attempts + 1;
  const status = correct ? "solved" : (caseId === "001" && attempts >= 2 ? "failed" : "open");
  const { data: updated, error: updateError } = await supabase.from("case_game_sessions").update({
    attempts, status, updated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }).eq("id", session.id).eq("status", "open").select("status,attempts,started_at").maybeSingle();
  if (updateError) return reply({ error: "Could not save accusation." }, 500);
  if (!updated) return reply({ error: "Case state changed; refresh the page before retrying." }, 409);
  await track("accusation_submitted", correct ? "solved" : "wrong");
  if (status === "solved" || status === "failed") await track("case_completed", status);
  return reply({
    status: updated.status, attempts: updated.attempts, started_at: updated.started_at,
  });
});
