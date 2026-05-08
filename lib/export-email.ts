import { sendEmail, wrapEmail, FROM_ADDRESS } from './resend';

// Confirmation email fired after a large memory-export streams to the
// user. "Large" is intentionally low (>= 1000 rows) — most accidental
// exports are tiny, so the inbox-noise tradeoff favours over-notifying
// for big dumps. Dedup is left to the per-user 1/60s rate limit on the
// export endpoint itself; we don't try to suppress repeats from our side.

const LARGE_EXPORT_THRESHOLD = 1000;

export function isLargeExport(rowCount: number): boolean {
  return rowCount >= LARGE_EXPORT_THRESHOLD;
}

export async function sendExportConfirmation(args: {
  to: string;
  rowCount: number;
  includeEmbeddings: boolean;
  ip: string;
  filters: Record<string, string | null>;
}) {
  const filtersHtml = Object.entries(args.filters)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `<li><strong>${k}</strong>: ${v}</li>`)
    .join('');

  const filtersBlock = filtersHtml
    ? `<div class="section-label">§ Filters applied</div>
       <div class="card"><ul style="margin:0; padding-left:18px; color:rgba(232,228,221,0.75);">${filtersHtml}</ul></div>`
    : '';

  const body = `
  <h1>Your memory export is ready.</h1>
  <div class="sub">§ Spine · ${args.rowCount.toLocaleString()} memories streamed</div>

  <p style="color:rgba(232,228,221,0.7); font-size:16px; line-height:1.65;">
    A copy of your archive just streamed to your browser as a single
    JSONL file. The download is one-shot — your Spine corpus is unchanged
    and remains queryable from every connected client.
  </p>

  <div class="section-label">§ What was in it</div>
  <div class="card">
    <p><strong>${args.rowCount.toLocaleString()}</strong> memory rows</p>
    <p>Embeddings included: <strong>${args.includeEmbeddings ? 'yes (1536-dim vectors)' : 'no'}</strong></p>
    <p>Triggered from: <code style="font-family:'Courier New',monospace; color:rgba(232,154,60,0.85);">${args.ip}</code></p>
  </div>
  ${filtersBlock}

  <div class="nag" style="margin-top:24px;">
    <p>If this wasn't you, rotate your dashboard session and revoke any
    suspicious API keys in <a href="https://spine.xxiautomate.com/dashboard/keys" style="color:#E89A3C;">your key settings</a>.
    Your full audit trail lives at <a href="https://spine.xxiautomate.com/dashboard/audit" style="color:#E89A3C;">/dashboard/audit</a>.</p>
  </div>

  <p style="color:rgba(232,228,221,0.45); font-size:13px; margin-top:28px;">
    Spine's archive is append-only. No memories were deleted by this
    export; you simply have a portable copy.
  </p>
  `;

  return sendEmail({
    from: FROM_ADDRESS,
    to: args.to,
    subject: `Your Spine memory export — ${args.rowCount.toLocaleString()} rows`,
    html: wrapEmail('Your Spine memory export', body),
  });
}
