// Minimal structured logger for the Workers runtime (no Node deps).
// The repo's tests mock this module — keep the exported names stable.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[("info")] || 20;

function emit(level, tag, message, meta) {
  if ((LEVELS[level] || 20) < MIN_LEVEL) return;
  const line = `[cloud][${level.toUpperCase()}]${tag ? `[${tag}]` : ""} ${message}`;
  const args = meta !== undefined ? [line, meta] : [line];
  // eslint-disable-next-line no-console
  (console[level] || console.log)(...args);
}

export function debug(tag, message, meta) { emit("debug", tag, message, meta); }
export function info(tag, message, meta) { emit("info", tag, message, meta); }
export function warn(tag, message, meta) { emit("warn", tag, message, meta); }
export function error(tag, message, meta) { emit("error", tag, message, meta); }
