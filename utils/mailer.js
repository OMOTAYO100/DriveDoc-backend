const crypto = require('crypto');
const axios = require('axios');

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Send a transactional email through Resend.
 *
 * If RESEND_API_KEY is not set the message is logged instead of sent, so the
 * password reset and reminder flows are still testable locally without a mail
 * account. The caller cannot tell the difference, which is deliberate: a reset
 * request must never reveal whether delivery actually happened.
 */
const sendEmail = async ({ to, subject, html, text, headers }) => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM || 'DriveDoc <onboarding@resend.dev>';

  if (!apiKey) {
    console.warn('⚠️  RESEND_API_KEY not set — email not sent. Contents below:');
    console.warn(`    To:      ${to}`);
    console.warn(`    Subject: ${subject}`);
    console.warn(`    Body:    ${text || html}`);
    return { delivered: false, reason: 'no-api-key' };
  }

  try {
    await axios.post(
      RESEND_ENDPOINT,
      { from, to: [to], subject, html, text, headers },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );
    return { delivered: true };
  } catch (err) {
    // Log and swallow. A mail provider outage must not turn into a 500 that
    // tells an attacker their target address exists.
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error(`❌ Email send failed for ${to}: ${detail}`);
    return { delivered: false, reason: 'send-failed' };
  }
};

// ---------------------------------------------------------------------------
// Unsubscribe links
//
// An HMAC over the user id, so the link works from an email client with no
// session and nothing extra stored. Rotating JWT_SECRET invalidates every
// outstanding link, which is the behaviour you want if one ever leaks.
// ---------------------------------------------------------------------------

const unsubscribeToken = (userId) =>
  crypto
    .createHmac('sha256', process.env.JWT_SECRET || '')
    .update(`unsubscribe:${userId}`)
    .digest('hex');

const verifyUnsubscribeToken = (userId, token) => {
  const expected = unsubscribeToken(userId);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token || ''));
  // Constant-time compare, and length-check first because timingSafeEqual
  // throws on a length mismatch.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const apiBase = () =>
  (process.env.API_PUBLIC_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, '');

const unsubscribeUrl = (userId) =>
  `${apiBase()}/api/notifications/email/unsubscribe?u=${userId}&t=${unsubscribeToken(userId)}`;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const SHELL = (inner, footer) => `<!doctype html>
<html><body style="margin:0;padding:0;background:#f3f4f6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#15191c">
<tr><td>
<div style="font-size:22px;font-weight:700;margin-bottom:24px">Drive<span style="color:#2563eb">Doc</span></div>
${inner}
</td></tr>
</table>
<div style="max-width:560px;margin-top:16px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:12px;line-height:1.6;color:#6b7280;text-align:center">
${footer}
</div>
</td></tr>
</table>
</body></html>`;

const BUTTON = (href, label) =>
  `<a href="${esc(href)}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">${esc(label)}</a>`;

const passwordResetEmail = (fullName, resetUrl) => {
  const firstName = (fullName || '').split(' ')[0] || 'there';

  return {
    subject: 'Reset your DriveDoc password',
    text:
      `Hi ${firstName},\n\n` +
      `Use this link to choose a new DriveDoc password. It expires in one hour.\n\n` +
      `${resetUrl}\n\n` +
      `If you didn't ask to reset your password, you can ignore this email — ` +
      `nothing has changed on your account.\n\n— DriveDoc`,
    html: SHELL(
      `<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Hi ${esc(firstName)},</p>
       <p style="font-size:16px;line-height:1.6;margin:0 0 20px">Use this link to choose a new DriveDoc password. It expires in one hour.</p>
       <p style="margin:0 0 20px">${BUTTON(resetUrl, 'Choose a new password')}</p>
       <p style="font-size:13px;line-height:1.6;color:#5b6b73;margin:0 0 16px">Or paste this into your browser:<br>${esc(resetUrl)}</p>
       <p style="font-size:14px;line-height:1.6;color:#5b6b73;margin:0">If you didn't ask to reset your password you can ignore this email — nothing has changed on your account.</p>`,
      `You received this because someone requested a password reset for this address.`
    )
  };
};

const urgencyLine = (item) => {
  if (item.kind === 'expired') return 'Expired';
  if (item.days <= 1) return 'Expires today';
  return `${item.days} day${item.days === 1 ? '' : 's'} left`;
};

/**
 * One email covering everything due for a user right now, rather than one per
 * document. Each row carries the renewal guidance for that document so the
 * email answers "what do I do about it?", not just "something is expiring".
 *
 * @param {object}  user   with fullName, _id
 * @param {Array}   items  [{ document, decision, guidance, days, kind }]
 * @param {string}  appUrl the web app base url
 */
const expiryReminderEmail = (user, items, appUrl) => {
  const firstName = (user.fullName || '').split(' ')[0] || 'there';
  const expired = items.filter((i) => i.kind === 'expired');
  const soonest = items.reduce((min, i) => Math.min(min, i.days), Infinity);

  const subject =
    expired.length === items.length
      ? items.length === 1
        ? `Your ${items[0].document.type} has expired`
        : `${items.length} of your documents have expired`
      : items.length === 1
        ? `${items[0].document.type}: ${urgencyLine(items[0]).toLowerCase()}`
        : `${items.length} documents need attention — soonest in ${soonest} day${soonest === 1 ? '' : 's'}`;

  // ---- plain text ----
  const textRows = items
    .map((i) => {
      const g = i.guidance;
      const lines = [
        `• ${i.document.type} (No. ${i.document.number}) — ${urgencyLine(i)}`,
        `  Expiry: ${i.expiryLabel}`,
      ];
      if (g?.authority) lines.push(`  Renew with: ${g.authority}`);
      if (g?.where) lines.push(`  Where: ${g.where}`);
      if (g?.bring?.length) lines.push(`  Bring: ${g.bring.slice(0, 4).join('; ')}`);
      if (g?.processingTime) lines.push(`  Typically takes: ${g.processingTime}`);
      if (g?.officialUrl) lines.push(`  Official info: ${g.officialUrl}`);
      return lines.join('\n');
    })
    .join('\n\n');

  const text =
    `Hi ${firstName},\n\n` +
    `${items.length === 1 ? 'A document needs' : 'Some of your documents need'} your attention:\n\n` +
    `${textRows}\n\n` +
    `See everything: ${appUrl}\n\n` +
    `Fees and requirements change — always confirm with the official source before you travel or pay.\n\n` +
    `— DriveDoc\n\n` +
    `Stop these reminders: ${unsubscribeUrl(user._id)}`;

  // ---- html ----
  const htmlRows = items
    .map((i) => {
      const g = i.guidance || {};
      const accent = i.kind === 'expired' ? '#b3261e' : i.days <= 7 ? '#b45309' : '#2563eb';
      const wash = i.kind === 'expired' ? '#fdf0ee' : i.days <= 7 ? '#fdf5e9' : '#eff4fe';

      const detail = (label, value) =>
        value
          ? `<tr><td style="padding:3px 0;font-size:13px;color:#6b7280;width:96px;vertical-align:top">${label}</td>
               <td style="padding:3px 0;font-size:13px;color:#374151;vertical-align:top">${esc(value)}</td></tr>`
          : '';

      const bring = g.bring?.length
        ? `<tr><td style="padding:3px 0;font-size:13px;color:#6b7280;vertical-align:top">Bring</td>
             <td style="padding:3px 0;font-size:13px;color:#374151">${g.bring
               .slice(0, 5)
               .map((b) => esc(b))
               .join(' · ')}</td></tr>`
        : '';

      return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;background:${wash};border-left:3px solid ${accent};border-radius:0 8px 8px 0">
  <tr><td style="padding:16px 18px">
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${accent};margin-bottom:4px">${esc(urgencyLine(i))}</div>
    <div style="font-size:17px;font-weight:600;color:#15191c;margin-bottom:2px">${esc(i.document.type)}</div>
    <div style="font-size:13px;color:#6b7280;margin-bottom:12px">No. ${esc(i.document.number)} · expires ${esc(i.expiryLabel)}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      ${detail('Renew with', g.authority)}
      ${detail('Where', g.where)}
      ${bring}
      ${detail('Cost', g.cost)}
      ${detail('Takes', g.processingTime)}
    </table>
    ${
      g.officialUrl
        ? `<div style="margin-top:12px"><a href="${esc(g.officialUrl)}" style="font-size:13px;color:${accent};font-weight:600">Official information &rarr;</a></div>`
        : ''
    }
  </td></tr>
</table>`;
    })
    .join('');

  const html = SHELL(
    `<p style="font-size:16px;line-height:1.6;margin:0 0 6px">Hi ${esc(firstName)},</p>
     <p style="font-size:16px;line-height:1.6;margin:0 0 22px">${
       items.length === 1 ? 'One of your documents needs' : `${items.length} of your documents need`
     } attention.</p>
     ${htmlRows}
     <p style="margin:24px 0 18px">${BUTTON(appUrl, 'Open DriveDoc')}</p>
     <p style="font-size:12px;line-height:1.6;color:#6b7280;margin:0;padding-top:16px;border-top:1px solid #e5e7eb">
       Fees, requirements and processing times change and vary by office. Always confirm with the official source before you travel or pay.
     </p>`,
    `You're getting this because you asked DriveDoc to track your documents.<br>
     <a href="${esc(unsubscribeUrl(user._id))}" style="color:#6b7280">Stop email reminders</a>`
  );

  return {
    subject,
    text,
    html,
    // Lets Gmail and friends show a native unsubscribe control, which keeps
    // these out of spam far better than a link in the footer alone.
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl(user._id)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    }
  };
};

module.exports = {
  sendEmail,
  passwordResetEmail,
  expiryReminderEmail,
  unsubscribeToken,
  verifyUnsubscribeToken,
  unsubscribeUrl
};
