const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

function safeSegment(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function firebaseObjectPath(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'firebasestorage.googleapis.com') return '';
    const match = parsed.pathname.match(/\/o\/(.+)$/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch (_) {
    return '';
  }
}

function normalizeAuthorizedAttachments(attachments, userId) {
  if (attachments == null) return [];
  if (!Array.isArray(attachments) || attachments.length > MAX_ATTACHMENTS) {
    throw Object.assign(new Error('Invalid attachments'), { status: 400 });
  }
  const tenant = safeSegment(userId);
  const prefix = `ai-assistant-attachments/${tenant}/`;
  return attachments.map((item) => {
    const url = String(item?.downloadUrl || item?.uri || '').trim();
    const storagePath = String(item?.storagePath || '').trim();
    const mimeType = String(item?.mimeType || item?.type || '').trim().toLowerCase();
    const declaredSize = Number(item?.size);
    if (!url || !storagePath || firebaseObjectPath(url) !== storagePath || !storagePath.startsWith(prefix)) {
      throw Object.assign(new Error('Unauthorized attachment'), { status: 403 });
    }
    if (!ALLOWED_MIME.has(mimeType)) throw Object.assign(new Error('Unsupported attachment'), { status: 400 });
    if (Number.isFinite(declaredSize) && (declaredSize <= 0 || declaredSize > MAX_ATTACHMENT_BYTES)) {
      throw Object.assign(new Error('Invalid attachment size'), { status: 400 });
    }
    return { url, storagePath, mimeType };
  });
}

async function loadAttachmentParts(attachments, userId, fetchImpl = fetch) {
  const authorized = normalizeAuthorizedAttachments(attachments, userId);
  const parts = [];
  for (const attachment of authorized) {
    const response = await fetchImpl(attachment.url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Object.assign(new Error('Attachment unavailable'), { status: 422 });
    const type = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (type !== attachment.mimeType || !ALLOWED_MIME.has(type)) {
      throw Object.assign(new Error('Attachment type mismatch'), { status: 422 });
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) {
      throw Object.assign(new Error('Invalid attachment size'), { status: 422 });
    }
    if (type === 'application/pdf' && !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw Object.assign(new Error('Invalid PDF'), { status: 422 });
    }
    parts.push({ inlineData: { data: bytes.toString('base64'), mimeType: type } });
  }
  return parts;
}

module.exports = { loadAttachmentParts, normalizeAuthorizedAttachments };
