// Unit tests for the cost helpers in providers/index.js. Pure functions — no
// DB, no network, no real API key needed. Run: node test/cost.mjs
process.env.ANTHROPIC_API_KEY ||= 'test-key-not-used'; // provider builds an SDK client at import
const { estimateCost, maxOutputTokensForBudget } = await import('../src/providers/index.js');

const assert = (c, m) => { if (!c) { console.error('ASSERT FAILED:', m); process.exit(1); } };
const near = (a, b) => Math.abs(a - b) < 1e-9;

// Haiku-like record: $1/1M input, $5/1M output.
const rec = { inputPrice: 1, outputPrice: 5 };

// No cache: 1M input + 1M output = $1 + $5 = $6.
assert(near(estimateCost(rec, { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 6),
  'no-cache pricing');

// Cache buckets priced at their real rates, NOT the full input rate:
//   1M input @ $1 + 1M cache_write @ $1.25 + 1M cache_read @ $0.10 = $2.35
// (the old code summed all three at $1 -> $3.00, which this guards against).
const cached = estimateCost(rec, {
  input_tokens: 1_000_000,
  cache_creation_input_tokens: 1_000_000,
  cache_read_input_tokens: 1_000_000,
  output_tokens: 0,
});
assert(near(cached, 2.35), `cache pricing should be 2.35, got ${cached}`);

// maxOutputTokensForBudget: $1 left, no input cost -> 1e6/5 = 200000 output tokens.
assert(maxOutputTokensForBudget(rec, 1, 0) === 200_000, 'budget -> max output tokens');
// Input alone exhausts the budget -> 0 (caller fails the run before billing).
assert(maxOutputTokensForBudget(rec, 1, 1_000_000) === 0, 'input over budget -> 0');

console.log('✓ estimateCost prices cache buckets at 0.1x / 1.25x');
console.log('✓ maxOutputTokensForBudget respects the ceiling');
console.log('\nALL COST TESTS PASSED');
