// Strip loopback RPC credentials from logs and status payloads.
export function redact(value) {
  return String(value)
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/("token"\s*:\s*")[^"]*(")/gi, '$1[redacted]$2');
}

export function redactObject(value) {
  if (Array.isArray(value)) return value.map(redactObject);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (key === 'token' || key === 'authorization') out[key] = '[redacted]';
      else out[key] = redactObject(inner);
    }
    return out;
  }
  if (typeof value === 'string') return redact(value);
  return value;
}
