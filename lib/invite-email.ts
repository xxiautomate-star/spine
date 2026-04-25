import { sendEmail, wrapEmail, FROM_ADDRESS } from './resend';

export async function sendInviteEmail(args: {
  to: string;
  code: string;
  plan: string;
  inviteUrl: string;
}) {
  const body = `
  <h1>You’re in.</h1>
  <div class="sub">§ Spine · rolling access · ${args.plan.toUpperCase()}</div>

  <p style="color:rgba(232,228,221,0.7); font-size:16px; line-height:1.65;">
    Your invite is ready. One click and your Spine workspace wakes up —
    append-only memory, cross-model retrieval, same corpus everywhere you
    work with AI.
  </p>

  <a class="cta" href="${args.inviteUrl}">Claim your seat →</a>

  <div class="section-label">§ Or use the code</div>
  <div class="card">
    <p style="font-family:'Courier New',monospace; font-size:18px; letter-spacing:0.08em; color:#E89A3C;">${args.code}</p>
  </div>

  <p style="color:rgba(232,228,221,0.45); font-size:13px; margin-top:28px;">
    This code is single-use and tied to the address it was sent to. It does
    not expire for 30 days. If you didn’t sign up for Spine, ignore this
    email and the code quietly dies.
  </p>
  `;

  return sendEmail({
    from: FROM_ADDRESS,
    to: args.to,
    subject: 'Your Spine invite is ready',
    html: wrapEmail('Your Spine invite', body),
  });
}
