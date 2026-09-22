import { createHmac, timingSafeEqual } from 'node:crypto';

export function signCallbackBody(rawBody: string | Buffer, secret: string): string {
  const digest = createHmac('sha256', secret).update(rawBody).digest('hex');
  return `sha256=${digest}`;
}

export function verifyCallbackSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) {
    return false;
  }
  const expected = signCallbackBody(rawBody, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
