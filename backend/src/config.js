// Numeric settings from the environment. Every cost or loop guard compares
// against one of these, and `n >= NaN` / `cost > NaN` are always false, so a
// typo such as MAX_MAIL_DEPTH=three would silently switch a guard off. Parse
// strictly and refuse to boot instead.
export function numEnv(name, fallback, { min = 0 } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n < min) {
    throw new Error(`${name}="${raw}" is not a number >= ${min}; fix or unset it in backend/.env (default ${fallback})`);
  }
  return n;
}
