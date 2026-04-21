// Daily digest: for each user who captured memories in the last 24h,
// generate a structured summary via Haiku-4.5 and send via Resend.
//
// Haiku receives all captures from the window, returns:
//   - 5 themes (what dominated the day)
//   - 3 decisions (choices explicitly made, quoting actual phrasing)
//   - 2 open questions (problems raised but not resolved)
//   - 1 nag (topic asked about 2+ times without visible progress)
//
// The nag compares the last 24h against the prior 7 days to find re-asked
// questions. This is Spine's "you already solved this" signal.

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail, wrapEmail, FROM_ADDRESS } from './resend';

const MODEL = 'claude-haiku-4-5-20251001';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

// ── Haiku prompt ──────────────────────────────────────────────────────────

const SYSTEM = `You are the daily memory analyst for Spine, a persistent AI memory layer.

You receive a user's AI conversation memories from the past 24 hours.
Your job: synthesise them into a tightly-scoped daily digest.

CRITICAL RULES:
- Quotes must be verbatim fragments from the input text. Never paraphrase.
- Themes must be specific ("Supabase pgvector indexing" not "database work").
- Decisions must capture the actual pivot ("switched to Coolify" not "changed deployment approach").
- Questions must be specific, answerable questions the user raised.
- Nag identifies a topic that recurred without progress (null if none).
- Return STRICT JSON ONLY. No prose, no markdown, no code fences.

JSON shape:
{
  "themes": [
    { "title": "<short specific phrase>", "summary": "<1-2 sentences>", "memory_count": <int> }
  ],
  "decisions": [
    { "decision": "<specific choice made>", "quote": "<verbatim fragment from input>", "context": "<one sentence>" }
  ],
  "questions": [
    { "question": "<specific open question>", "context": "<one sentence>", "urgency": "high|medium|low" }
  ],
  "nag": { "topic": "<specific topic>", "occurrences": <int>, "last_seen": "<phrase from most recent instance>" } | null
}`;

type DigestTheme = {
  title: string;
  summary: string;
  memory_count: number;
};

type DigestDecision = {
  decision: string;
  quote: string;
  context: string;
};

type DigestQuestion = {
  question: string;
  context: string;
  urgency: 'high' | 'medium' | 'low';
};

type DigestNag = {
  topic: string;
  occurrences: number;
  last_seen: string;
};

export type DigestPayload = {
  themes: DigestTheme[];
  decisions: DigestDecision[];
  questions: DigestQuestion[];
  nag: DigestNag | null;
};

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function truncateMemory(content: string, max = 300): string {
  return content.length > max ? content.slice(0, max - 1) + '…' : content;
}

async function callHaiku(
  memories: Array<{ content: string; source: string | null; created_at: string }>,
  priorContext: string
): Promise<DigestPayload> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not configured.');

  const todayBlock = memories
    .map((m, i) => `[${i + 1}] (${m.source ?? 'unknown'}) ${truncateMemory(m.content)}`)
    .join('\n\n');

  const userMsg = `TODAY'S MEMORIES (${memories.length} total):
${todayBlock}

${priorContext ? `PRIOR 7-DAY CONTEXT (for nag detection):
${priorContext}` : ''}

Return the digest JSON.`;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMsg }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Haiku digest ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  const text = data.content.find((b) => b.type === 'text')?.text ?? '{}';

  let parsed: Partial<DigestPayload> = {};
  try {
    parsed = JSON.parse(stripFences(text)) as Partial<DigestPayload>;
  } catch {
    parsed = {};
  }

  return {
    themes: Array.isArray(parsed.themes) ? parsed.themes.slice(0, 5) : [],
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions.slice(0, 3) : [],
    questions: Array.isArray(parsed.questions) ? parsed.questions.slice(0, 2) : [],
    nag: parsed.nag ?? null,
  };
}

// ── Email rendering ────────────────────────────────────────────────────────

function renderDigestEmail(
  digest: DigestPayload,
  date: string,
  memoryCount: number,
  dashboardUrl: string
): string {
  const urgencyColor = (u: string) => {
    if (u === 'high') return '#E89A3C';
    if (u === 'medium') return 'rgba(232,228,221,0.6)';
    return 'rgba(232,228,221,0.35)';
  };

  const themesHtml = digest.themes
    .map(
      (t) => `<div class="card">
    <p><strong>${t.title}</strong> <span style="font-family:'Courier New',monospace;font-size:10px;color:rgba(232,228,221,0.35);margin-left:8px;">${t.memory_count} memories</span></p>
    <p style="margin-top:6px;font-size:13px;color:rgba(232,228,221,0.55);">${t.summary}</p>
  </div>`
    )
    .join('');

  const decisionsHtml = digest.decisions
    .map(
      (d) => `<div class="card">
    <p>${d.decision}</p>
    <div class="quote"><p>"${d.quote}"</p></div>
    <p style="margin-top:8px;font-size:12px;color:rgba(232,228,221,0.4);">${d.context}</p>
  </div>`
    )
    .join('');

  const questionsHtml = digest.questions
    .map(
      (q) => `<div class="card">
    <p><span style="color:${urgencyColor(q.urgency)};font-family:'Courier New',monospace;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;">${q.urgency}</span></p>
    <p style="margin-top:4px;">${q.question}</p>
    <p style="margin-top:6px;font-size:12px;color:rgba(232,228,221,0.4);">${q.context}</p>
  </div>`
    )
    .join('');

  const nagHtml = digest.nag
    ? `<p class="section-label">↺ Still unresolved</p>
  <div class="nag">
    <p>You mentioned <strong>${digest.nag.topic}</strong> ${digest.nag.occurrences} times without implementing it.</p>
    <p style="margin-top:6px;font-size:12px;">Last seen: "${digest.nag.last_seen}"</p>
  </div>`
    : '';

  const body = `
  <h1>Your day in memory.</h1>
  <p class="sub">${date} &middot; ${memoryCount} memories captured</p>

  ${digest.themes.length > 0 ? `<p class="section-label">§ Themes</p>${themesHtml}` : ''}
  ${digest.decisions.length > 0 ? `<p class="section-label">§ Decisions made</p>${decisionsHtml}` : ''}
  ${digest.questions.length > 0 ? `<p class="section-label">§ Open questions</p>${questionsHtml}` : ''}
  ${nagHtml}

  <a href="${dashboardUrl}/digest" class="cta">Open full digest →</a>`;

  return wrapEmail('Your Spine daily digest', body);
}

// ── Fetch memories ─────────────────────────────────────────────────────────

type MemoryRow = {
  id: string;
  content: string;
  source: string | null;
  created_at: string;
};

async function fetchWindowMemories(
  sb: SupabaseClient,
  userId: string,
  since: string,
  until: string
): Promise<MemoryRow[]> {
  const { data, error } = await sb
    .from('memories')
    .select('id, content, source, created_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .gte('created_at', since)
    .lt('created_at', until)
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) throw new Error(error.message);
  return (data ?? []) as MemoryRow[];
}

async function fetchPriorContext(
  sb: SupabaseClient,
  userId: string,
  daysBack: number,
  since: string
): Promise<string> {
  const from = new Date(new Date(since).getTime() - daysBack * 86_400_000).toISOString();
  const { data } = await sb
    .from('memories')
    .select('content, created_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .gte('created_at', from)
    .lt('created_at', since)
    .order('created_at', { ascending: false })
    .limit(50);

  if (!data || data.length === 0) return '';
  return (data as MemoryRow[])
    .map((m) => truncateMemory(m.content, 150))
    .join('\n');
}

// ── Digest generation ──────────────────────────────────────────────────────

export type GenerateDigestResult = {
  userId: string;
  date: string;
  memoryCount: number;
  digest: DigestPayload;
  emailResult: { ok: boolean; id?: string; error?: string };
  storedDigestId: string | null;
};

/**
 * Generate and store the daily digest for a single user.
 * `windowStart` / `windowEnd` are ISO strings defining the 24h window.
 * `userEmail` is used to send the digest email.
 */
export async function generateDigest(
  sb: SupabaseClient,
  userId: string,
  userEmail: string,
  windowStart: string,
  windowEnd: string
): Promise<GenerateDigestResult> {
  const date = windowStart.slice(0, 10);

  const memories = await fetchWindowMemories(sb, userId, windowStart, windowEnd);
  if (memories.length === 0) {
    return {
      userId,
      date,
      memoryCount: 0,
      digest: { themes: [], decisions: [], questions: [], nag: null },
      emailResult: { ok: false, error: 'No memories in window.' },
      storedDigestId: null,
    };
  }

  const priorContext = await fetchPriorContext(sb, userId, 7, windowStart);
  const digest = await callHaiku(memories, priorContext);

  // Upsert the digest record.
  const { data: digestRow } = await sb
    .from('digests')
    .upsert(
      {
        user_id: userId,
        date,
        themes: digest.themes,
        decisions: digest.decisions,
        questions: digest.questions,
        nags: digest.nag ? [digest.nag] : [],
        memory_count: memories.length,
      },
      { onConflict: 'user_id,date' }
    )
    .select('id')
    .maybeSingle();

  const storedDigestId = digestRow?.id ?? null;

  const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://spine.xxiautomate.com';
  const html = renderDigestEmail(digest, date, memories.length, dashboardUrl);

  const emailResult = await sendEmail({
    from: FROM_ADDRESS,
    to: userEmail,
    subject: `Your Spine digest — ${date}`,
    html,
    text: `Spine daily digest ${date}: ${memories.length} memories. ${digest.themes.length} themes. ${digest.decisions.length} decisions. Open your dashboard: ${dashboardUrl}/digest`,
  });

  // Mark sent timestamp.
  if (storedDigestId && emailResult.ok) {
    await sb
      .from('digests')
      .update({ sent_at: new Date().toISOString() })
      .eq('id', storedDigestId as string);
  }

  return {
    userId,
    date,
    memoryCount: memories.length,
    digest,
    emailResult,
    storedDigestId: storedDigestId as string | null,
  };
}

// ── Active user scan ──────────────────────────────────────────────────────

type UserProfile = {
  user_id: string;
  email: string | null;
  plan: string;
};

/**
 * Find all users who have memories in the last 24h window and have email
 * addresses. Used by the cron to determine who gets a digest today.
 */
export async function findActiveUsersForDigest(
  sb: SupabaseClient,
  windowStart: string,
  windowEnd: string
): Promise<UserProfile[]> {
  // Get distinct user IDs from memories in window.
  const { data: memoryUsers } = await sb
    .from('memories')
    .select('user_id')
    .is('deleted_at', null)
    .gte('created_at', windowStart)
    .lt('created_at', windowEnd)
    .limit(1000);

  if (!memoryUsers || memoryUsers.length === 0) return [];

  const uniqueIds = [...new Set((memoryUsers as { user_id: string }[]).map((r) => r.user_id))];

  // Fetch profiles + auth emails via service role (admin API).
  const results: UserProfile[] = [];

  for (const uid of uniqueIds) {
    const { data: profile } = await sb
      .from('profiles')
      .select('plan')
      .eq('user_id', uid)
      .maybeSingle();

    // Get email from auth.users via admin client.
    const { data: authUser } = await sb.auth.admin.getUserById(uid);
    const email = authUser?.user?.email ?? null;

    if (!email) continue; // Skip users without email — can't send digest.

    results.push({
      user_id: uid,
      email,
      plan: (profile?.plan as string) ?? 'free',
    });
  }

  return results;
}

/**
 * Run the daily digest job: scan active users, generate + email each digest.
 * Called from /api/cron/daily-digest.
 */
export async function runDailyDigestJob(
  sb: SupabaseClient
): Promise<{ sent: number; skipped: number; errors: number }> {
  const now = new Date();
  const windowEnd = now.toISOString();
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const users = await findActiveUsersForDigest(sb, windowStart, windowEnd);

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const user of users) {
    try {
      const result = await generateDigest(
        sb,
        user.user_id,
        user.email!,
        windowStart,
        windowEnd
      );
      if (result.memoryCount === 0) {
        skipped++;
      } else if (result.emailResult.ok) {
        sent++;
      } else {
        errors++;
        console.error('[spine/daily-digest] email failed', user.user_id, result.emailResult.error);
      }
    } catch (err) {
      errors++;
      console.error('[spine/daily-digest] user error', user.user_id, err);
    }
    // Brief pause between users to avoid Haiku rate limits.
    await new Promise((r) => setTimeout(r, 500));
  }

  return { sent, skipped, errors };
}
