'use strict';

function redact(value) {
  return String(value)
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/("token"\s*:\s*")[^"]*(")/gi, '$1[redacted]$2');
}

module.exports = { redact };
