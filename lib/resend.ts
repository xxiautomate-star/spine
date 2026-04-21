// Thin wrapper around the Resend HTTP API. No SDK dependency — keeps the
// bundle lean and avoids the edge-runtime incompatibility in Resend v2.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export type ResendPayload = {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  reply_to?: string;
};

export type ResendResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function sendEmail(payload: ResendPayload): Promise<ResendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[spine/resend] RESEND_API_KEY not configured — email skipped.');
    return { ok: false, error: 'RESEND_API_KEY not configured.' };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as { id?: string; message?: string; name?: string };

    if (!res.ok) {
      const msg = data.message ?? data.name ?? `HTTP ${res.status}`;
      return { ok: false, error: msg };
    }

    return { ok: true, id: data.id ?? 'sent' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS ?? 'Spine <digest@spine.xxiautomate.com>';

// ── Email templates ───────────────────────────────────────────────────────

export function wrapEmail(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  body { margin:0; padding:0; background:#0D0C0A; color:#E8E4DD; font-family:Georgia,'Times New Roman',serif; }
  .wrap { max-width:600px; margin:0 auto; padding:40px 24px; }
  .logo { font-family:Georgia,serif; font-size:18px; color:#E8E4DD; letter-spacing:0.05em; margin-bottom:40px; }
  .logo-dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:#E89A3C; margin-right:10px; vertical-align:middle; }
  h1 { font-family:Georgia,serif; font-size:28px; font-weight:normal; color:#E8E4DD; line-height:1.2; margin:0 0 8px; }
  .sub { font-family:'Courier New',monospace; font-size:11px; color:rgba(232,228,221,0.35); letter-spacing:0.1em; text-transform:uppercase; margin-bottom:32px; }
  .section-label { font-family:'Courier New',monospace; font-size:10px; color:rgba(232,154,60,0.6); text-transform:uppercase; letter-spacing:0.12em; margin:32px 0 12px; }
  .card { background:rgba(232,228,221,0.04); border:1px solid rgba(232,228,221,0.08); border-radius:8px; padding:16px 20px; margin-bottom:10px; }
  .card p { margin:0; font-size:15px; color:rgba(232,228,221,0.8); line-height:1.6; }
  .quote { border-left:2px solid rgba(232,154,60,0.4); padding-left:14px; margin:10px 0 0; }
  .quote p { font-style:italic; font-size:13px; color:rgba(232,228,221,0.55); }
  .nag { background:rgba(232,154,60,0.06); border:1px solid rgba(232,154,60,0.2); border-radius:8px; padding:16px 20px; margin-bottom:10px; }
  .nag p { margin:0; font-size:14px; color:rgba(232,154,60,0.9); line-height:1.6; }
  .cta { display:inline-block; margin-top:32px; padding:12px 24px; background:#E89A3C; color:#0D0C0A; text-decoration:none; font-family:'Courier New',monospace; font-size:12px; text-transform:uppercase; letter-spacing:0.1em; border-radius:6px; }
  .footer { margin-top:48px; padding-top:24px; border-top:1px solid rgba(232,228,221,0.06); font-family:'Courier New',monospace; font-size:10px; color:rgba(232,228,221,0.2); text-transform:uppercase; letter-spacing:0.08em; }
  .footer a { color:rgba(232,228,221,0.35); text-decoration:none; }
</style>
</head>
<body>
<div class="wrap">
  <div class="logo"><span class="logo-dot"></span>Spine</div>
  ${bodyHtml}
  <div class="footer">
    <p>Spine · <a href="https://spine.xxiautomate.com">spine.xxiautomate.com</a></p>
    <p><a href="https://spine.xxiautomate.com/dashboard">Manage preferences</a> · <a href="https://spine.xxiautomate.com/privacy">Privacy</a></p>
  </div>
</div>
</body>
</html>`;
}
