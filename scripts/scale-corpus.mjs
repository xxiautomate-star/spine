// Varied synthetic memory generator. Output reads like real Spine data — a
// mix of project notes, code decisions, constraints, quotes, meeting snippets —
// not repeated lorem ipsum. Deterministic per seed so bench runs are
// reproducible.
//
// Usage:
//   import { generateMemory, generateNeedle } from './scale-corpus.mjs'
//   const mem = generateMemory(i)

import { createHash } from 'node:crypto';

const PROJECTS = [
  'Atlas', 'Beacon', 'Cinder', 'Delta', 'Echo', 'Forge', 'Gravity', 'Halo',
  'Ion', 'Jupiter', 'Kestrel', 'Lumen', 'Meridian', 'Nimbus', 'Orbit', 'Pulse',
  'Quartz', 'Ravel', 'Slate', 'Tempo', 'Umbra', 'Vessel', 'Warden', 'Xenon',
  'Yarrow', 'Zenith'
];

const STACK = [
  'Postgres 15', 'Redis', 'Supabase', 'Next.js 15', 'Remix', 'Fastify',
  'SvelteKit', 'Cloudflare Workers', 'Hono', 'Drizzle', 'Prisma', 'Bun',
  'Deno', 'Node 22', 'Vercel', 'Fly.io', 'Railway', 'AWS Lambda', 'GCP Run'
];

const PEOPLE = [
  'Marcus', 'Priya', 'Dmitri', 'Lena', 'Tomas', 'Yuki', 'Anika', 'Rafael',
  'Nadia', 'Hiro', 'Odessa', 'Kai', 'Soraya', 'Gareth', 'Freya'
];

const TOPICS = [
  'auth flow', 'rate limiting', 'queue backpressure', 'cache invalidation',
  'index tuning', 'schema migration', 'replication lag', 'telemetry sampling',
  'retry budget', 'backfill strategy', 'feature-flag rollout', 'circuit breaker',
  'request coalescing', 'batching window', 'connection pooling'
];

const DECISIONS = [
  'we decided to', 'the team agreed on', 'locked in', 'chose to', 'ended up using',
  'pivoted to', 'standardised on', 'moved off', 'deprecated in favour of'
];

const CONSTRAINTS = [
  'must stay under 100ms p99', 'cannot drop writes on restart', 'has to survive a region failover',
  'needs to hold 10k RPS burst', 'must not leak user data across tenants', 'has to handle 500MB payloads',
  'needs idempotent retries', 'requires strict read-after-write', 'cannot block the UI'
];

// Fast deterministic pseudo-random from an integer index.
function rand(seed) {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function sentence(rng, idx) {
  const p = pick(rng, PROJECTS);
  const s = pick(rng, STACK);
  const t = pick(rng, TOPICS);
  const d = pick(rng, DECISIONS);
  const c = pick(rng, CONSTRAINTS);
  const person = pick(rng, PEOPLE);
  const tmpl = Math.floor(rng() * 8);

  switch (tmpl) {
    case 0:
      return `${p} — ${person} ${d} ${s} for ${t}. Constraint: ${c}. Decision logged 2026-0${1 + (idx % 4)}-${1 + (idx % 27)}.`;
    case 1:
      return `${t} in ${p} ${c}. Current approach: ${s}. Owner: ${person}. Review scheduled.`;
    case 2:
      return `"${person}: we ${d} ${s} because the previous path ${c.replace('must', 'had to').replace('cannot', 'could not')}." — ${p} sync note.`;
    case 3:
      return `Bug #${1000 + (idx % 9000)} (${p}): ${t} regression when ${c.toLowerCase()}. Fix: ${d} ${s}. Status: monitored.`;
    case 4:
      return `Spec: ${p} ${t} will use ${s}. ${c}. ${person} owns the rollout.`;
    case 5:
      return `Migration plan for ${p}: step 1 — ${d} ${s}. Step 2 — verify ${t} still ${c.toLowerCase()}.`;
    case 6:
      return `${person}'s note on ${p}: "the ${t} needs to be treated as hot-path. ${c}. ${d} ${s} is the only viable option I see."`;
    default:
      return `${p} retrospective — what worked: ${s} for ${t}. What didn't: ignoring that it ${c}. Lesson: ${d} ${s} earlier.`;
  }
}

/**
 * Generate a reproducible synthetic memory keyed by index. Returns content +
 * source + tags so it looks real when queried.
 */
export function generateMemory(index) {
  const rng = rand(index + 1337);
  const content = sentence(rng, index);
  const project = pick(rng, PROJECTS);
  const src = [
    'claude-code',
    'claude-desktop',
    'cursor',
    'meeting-notes',
    'terminal',
    'slack',
  ][index % 6];
  const tags = [project.toLowerCase(), pick(rng, TOPICS).replace(/\s+/g, '-')];
  return { content, source: src, tags };
}

/**
 * Generate a needle memory — one with a unique token embedded that we can
 * search for to verify retrieval at scale.
 */
export function generateNeedle(token) {
  // Wrap the token in plausible context so it isn't trivial to find via BM25
  // alone. The vector similarity should be what surfaces it.
  const content = `Internal note on Spine scale proof. Project checkpoint marker: ${token}. This memory exists so a benchmark can verify retrieval accuracy at scale. If you are seeing this outside a benchmark run, you can safely ignore it.`;
  return {
    content,
    source: 'bench-needle',
    tags: ['bench', 'needle', token.slice(0, 16)],
  };
}

/**
 * A short recall query that should match exactly one needle.
 */
export function needleQuery(token) {
  return `Spine scale proof checkpoint marker ${token}`;
}

/**
 * Produce a unique-looking token. SHA1 first 16 hex of (prefix + i).
 */
export function makeToken(prefix, i) {
  return createHash('sha1').update(`${prefix}:${i}`).digest('hex').slice(0, 16).toUpperCase();
}
