/**
 * Sends the site's emails (account verification, password resets) through
 * Resend's SMTP relay, from noreply@certamenreader.org. Needs RESEND_API_KEY.
 */

import { CERTAMENREADER_EMAIL_ADDRESS } from '../constants.js';

import { createTransport } from 'nodemailer';

const apiKey = process.env.RESEND_API_KEY;

const transporter = apiKey && createTransport({
  host: 'smtp.resend.com',
  port: 465,
  secure: true,
  auth: { user: 'resend', pass: apiKey }
});

// Report a bad key at startup rather than on someone's first sign-up. Logged,
// not thrown: email trouble shouldn't take the rest of the site down.
transporter?.verify(error => {
  if (error) console.error('Email (Resend) is misconfigured:', error.message);
});

/**
 * @param {Object} param0
 * @param {String} param0.to
 * @param {String} [param0.subject='']
 * @param {String} param0.text
 * @param {String} param0.html
 */
async function sendEmail ({ to, subject = '', text, html }) {
  // Without a key, local dev prints the email (so verification and reset links
  // can still be followed); production refuses, so sign-up fails loudly instead
  // of creating accounts that can never be verified.
  if (!transporter) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Email is not configured: set RESEND_API_KEY.');
    }
    console.log(`\n[email not sent: RESEND_API_KEY is unset]\nTo: ${to}\nSubject: ${subject}\n\n${text}\n`);
    return null;
  }

  return await transporter.sendMail({
    from: `Certamen Reader <${CERTAMENREADER_EMAIL_ADDRESS}>`,
    to,
    subject,
    text,
    html
  });
}

export { sendEmail };
