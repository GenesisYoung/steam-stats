/**
 * Minimal structured logger (JSON lines, Cloud Logging compatible).
 * Redacts secrets and personal data: never pass raw request objects.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const severity: Record<Level, string> = { debug: 'DEBUG', info: 'INFO', warn: 'WARNING', error: 'ERROR' };

const SENSITIVE_KEYS = /^(authorization|cookie|password|token|idtoken|key|secret|email|sig|openid\..*)$/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[depth]';
  if (typeof value === 'string') {
    return value
      .replace(/([?&]key=)[^&\s]+/gi, '$1[redacted]')
      .replace(/Bearer\s+[\w.-]+/g, 'Bearer [redacted]')
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]');
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redact(value.message), stack: value.stack?.split('\n').slice(0, 5).join('\n') };
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1)]),
    );
  }
  return value;
}

let minLevel: Level = (process.env.LOG_LEVEL as Level) ?? 'info';
export const setLogLevel = (l: Level) => (minLevel = l);

function write(level: Level, message: string, fields?: Record<string, unknown>) {
  if (order[level] < order[minLevel] || process.env.NODE_ENV === 'test') return;
  const line = JSON.stringify({ severity: severity[level], message: redact(message), ...(fields ? (redact(fields) as object) : {}), time: new Date().toISOString() });
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
}

export const logger = {
  debug: (m: string, f?: Record<string, unknown>) => write('debug', m, f),
  info: (m: string, f?: Record<string, unknown>) => write('info', m, f),
  warn: (m: string, f?: Record<string, unknown>) => write('warn', m, f),
  error: (m: string, f?: Record<string, unknown>) => write('error', m, f),
};
