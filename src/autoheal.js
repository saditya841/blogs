// autoheal.js — 0-token maintenance agent for topics/posts, plus a manual draft healer.
//
// Why: a research queue is useful, but without pruning it grows forever. Old thin/rejected
// topics, stale ready topics and leftover news topics clutter the admin and confuse "what
// should I write next". This module:
//   1. builds a deterministic cleanup plan (no AI, no token),
//   2. deletes only what the plan approves (with a preview first),
//   3. fills missing summary/tags/meta from the article itself (no AI),
//   4. can deepen ONE thin Business draft per click (AI token, manual only),
//   5. logs every run so each admin click has a visible before/after result.
//
// It never changes a live post body and never publishes anything.

import { deepenOne, gapReport } from './deepen.js';

const now = () => Math.floor(Date.now() / 1000);
const SECONDS_PER_DAY = 86400;

const STOPWORDS = new Set(
  ('the a an and or but of for to in on at by with from is are was were be been being this that these those ' +
    'it its as your you we our their they he she his her not no how why what when where who which will would ' +
    'can could should may might have has had do does did than then also into over under about more most less ' +
    'least very just only from with without within between after before during while because if so such same ' +
    'other another each every both few many much some any all own out up down off again further once here there ' +
    'whenever wherever however therefore thus hence able about above across actually almost alone along already ' +
    'although always among around become becomes became becoming behind below beside besides beyond cannot could ' +
    'did does doing done during else enough even ever every everything everywhere except far few first former ' +
    'forth found four full get gets got give gives go goes going gone good great had has have having her here ' +
    'hers herself him himself his how however i if important in into is it its itself just keep keeps kept know ' +
    'known last later least less let like likely little long made make makes making many may me might more most ' +
    'much must my myself near need needs never new next no none nor not now number off often on once one only ' +
    'onto or other others otherwise our ours ourselves out over own part per perhaps place put quite rather ' +
    'really right said same saw say says second see seem seen several shall she should since six so some ' +
    'someone something sometimes still such take taken takes than that the their theirs them themselves then ' +
    'there these they thing things think this those though three through thus time to today together too took ' +
    'toward towards two under until up upon us use used uses very via want wants was way we well went were what ' +
    'when where whether which while who whom whose why will with within without work would year years yet you ' +
    'your yours yourself yourselves')
    .split(/\s+/)
);

// Normalise a query so "DMart: low margin?" and "dmart low margin" count as the same topic.
export function normalizeTopicQuery(query) {
  return String(query || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const topicAgeDays = (row, nowSec) => {
  const ts = Number(row && (row.updated_at || row.created_at)) || 0;
  return ts > 0 ? Math.max(0, (nowSec - ts) / SECONDS_PER_DAY) : Infinity;
};

const isBusinessTopic = (row) => {
  if (String((row && row.traffic) || '').toLowerCase() === 'business') return true;
  const r = String((row && row.research) || '');
  return r.includes('"mode":"business"') || r.includes('"mode": "business"');
};

const heatOf = (row) => {
  try {
    const d = JSON.parse((row && row.research) || '{}');
    return d.heat === 'high' ? 2 : d.heat === 'fresh' ? 1 : 0;
  } catch {
    return 0;
  }
};

// A duplicate should keep the row that is most useful: drafted > ready > new, then more sources,
// then the freshest, then the newest id.
const betterTopic = (a, b) => {
  const rank = (r) => (r.status === 'drafted' ? 4 : r.status === 'ready' ? 3 : r.status === 'new' ? 2 : 1);
  return (
    rank(a) - rank(b) ||
    (Number(a.source_count) || 0) - (Number(b.source_count) || 0) ||
    (Number(a.updated_at) || 0) - (Number(b.updated_at) || 0) ||
    (Number(a.id) || 0) - (Number(b.id) || 0)
  );
};

// Pure planner: same input -> same deletion list. No DB, no network, no AI.
export function topicCleanupPlan(rows, opts = {}) {
  const nowSec = Number(opts.nowSec) || now();
  const thinDays = Math.max(1, Number(opts.thinDays) || 7);
  const readyDays = Math.max(1, Number(opts.readyDays) || 14);
  const readyMax = Math.max(1, Number(opts.readyMax) || 12);
  const draftedDays = Math.max(1, Number(opts.draftedDays) || 30);
  const otherModeDays = Math.max(1, Number(opts.otherModeDays) || 7);
  const businessMode = opts.businessMode !== false;

  const list = (Array.isArray(rows) ? rows : []).filter(Boolean);
  const deletions = [];
  const deleted = new Set();
  const addDeletion = (row, reason) => {
    const id = Number(row && row.id);
    if (!id || deleted.has(id)) return;
    deleted.add(id);
    deletions.push({ id, query: String((row && row.query) || ''), status: String((row && row.status) || ''), reason });
  };

  // 1) Duplicate queries (punctuation/case/spacing variants).
  const byNorm = new Map();
  const unique = [];
  for (const row of list) {
    const key = normalizeTopicQuery(row.query);
    if (!key) {
      unique.push(row);
      continue;
    }
    const prev = byNorm.get(key);
    if (!prev) {
      byNorm.set(key, row);
      continue;
    }
    if (betterTopic(row, prev) > 0) {
      addDeletion(prev, 'duplicate_query');
      byNorm.set(key, row);
    } else {
      addDeletion(row, 'duplicate_query');
    }
  }
  for (const row of byNorm.values()) unique.push(row);

  // 2) Age + status rules. Business mode ON means old news topics are dead weight (and vice versa).
  const ready = [];
  const kept = [];
  for (const row of unique) {
    if (deleted.has(Number(row.id))) continue;
    const age = topicAgeDays(row, nowSec);
    const status = String(row.status || '').toLowerCase();

    if (businessMode && !isBusinessTopic(row) && age > otherModeDays) {
      addDeletion(row, 'old_news_topic');
      continue;
    }
    if (!businessMode && isBusinessTopic(row) && age > otherModeDays) {
      addDeletion(row, 'old_business_topic');
      continue;
    }

    if (status === 'thin' || status === 'rejected' || status === 'duplicate') {
      if (age > thinDays) {
        addDeletion(row, `stale_${status}`);
        continue;
      }
      kept.push(row);
      continue;
    }

    if (status === 'ready') {
      if (age > readyDays) {
        addDeletion(row, 'stale_ready');
        continue;
      }
      ready.push(row);
      continue;
    }

    if (status === 'drafted') {
      if (age > draftedDays) {
        addDeletion(row, 'old_drafted');
        continue;
      }
      kept.push(row);
      continue;
    }

    if (age > 30) {
      addDeletion(row, `stale_${status || 'unknown'}`);
      continue;
    }
    kept.push(row);
  }

  // 3) Cap the ready backlog. Research is free, so 12 ready topics is a 3-4 day buffer, not 100.
  ready.sort(
    (a, b) =>
      heatOf(b) - heatOf(a) ||
      (Number(b.source_count) || 0) - (Number(a.source_count) || 0) ||
      (Number(b.updated_at) || 0) - (Number(a.updated_at) || 0) ||
      (Number(b.id) || 0) - (Number(a.id) || 0)
  );
  const readyKept = ready.slice(0, readyMax);
  for (const row of ready.slice(readyMax)) addDeletion(row, 'ready_over_cap');

  const counts = {};
  for (const d of deletions) counts[d.reason] = (counts[d.reason] || 0) + 1;

  return {
    total: list.length,
    deleteCount: deletions.length,
    keepCount: list.length - deletions.length,
    readyKept: readyKept.length,
    counts,
    deletions,
    keepIds: [...kept.map((r) => Number(r.id)), ...readyKept.map((r) => Number(r.id))]
  };
}

// ---------- 0-token metadata repair ----------

export function deriveSummary(body, max = 240) {
  const text = String(body || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+.*$/gm, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_>#`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  const parts = text.split(/(?<=[.!?।])\s+/).filter(Boolean);
  let out = '';
  for (const p of parts) {
    const next = (out ? out + ' ' : '') + p;
    if (next.length > max) break;
    out = next;
    if (out.split(/\s+/).filter(Boolean).length >= 28) break;
  }
  if (!out) out = text.slice(0, max);
  return out.slice(0, max).trim();
}

export function deriveTags(title, summary = '', category = '', max = 5) {
  const words = `${title || ''} ${summary || ''}`
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  const out = [];
  const seen = new Set();
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= max) break;
  }
  for (const extra of [category, 'business', 'India']) {
    if (out.length >= 3) break;
    const k = String(extra || '').trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(String(extra).trim());
  }
  return out.slice(0, max).join(', ');
}

// ---------- DB actions ----------

export async function ensureAgentTable(env) {
  try {
    await env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS agent_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, result TEXT, created_at INTEGER NOT NULL)'
    ).run();
  } catch {
    /* logging must never break the action */
  }
}

export async function logAgentRun(env, kind, result) {
  try {
    await ensureAgentTable(env);
    await env.DB.prepare('INSERT INTO agent_runs(kind,result,created_at) VALUES(?,?,?)')
      .bind(String(kind || 'run'), JSON.stringify(result || {}).slice(0, 4000), now())
      .run();
  } catch {
    /* best-effort */
  }
}

export async function recentAgentRuns(env, limit = 10) {
  try {
    await ensureAgentTable(env);
    const { results } = await env.DB.prepare('SELECT kind,result,created_at FROM agent_runs ORDER BY id DESC LIMIT ?')
      .bind(Math.max(1, Math.min(30, Number(limit) || 10)))
      .all();
    return results || [];
  } catch {
    return [];
  }
}

export async function cleanupPreview(env, opts = {}) {
  const { results } = await env.DB.prepare(
    'SELECT id,query,traffic,status,source_count,research,created_at,updated_at FROM topics'
  ).all();
  const rows = results || [];
  return { scanned: rows.length, plan: topicCleanupPlan(rows, opts) };
}

export async function cleanupTopics(env, opts = {}) {
  const preview = await cleanupPreview(env, opts);
  let deleted = 0;
  for (const d of preview.plan.deletions) {
    try {
      const r = await env.DB.prepare('DELETE FROM topics WHERE id=?').bind(d.id).run();
      deleted += Number(r && r.meta && r.meta.changes != null ? r.meta.changes : 1);
    } catch {
      /* skip one row, keep cleaning */
    }
  }
  const summary = {
    scanned: preview.scanned,
    deleted,
    kept: Math.max(0, preview.scanned - deleted),
    readyKept: preview.plan.readyKept,
    counts: preview.plan.counts
  };
  await logAgentRun(env, 'topic_cleanup', summary);
  return summary;
}

export async function fixPostBasics(env, opts = {}) {
  const limit = Math.max(1, Math.min(20, Number(opts.limit) || 10));
  const { results } = await env.DB.prepare(
    "SELECT id,title,summary,body,tags,category,meta_description FROM posts WHERE (summary IS NULL OR summary='' OR tags IS NULL OR tags='' OR meta_description IS NULL OR meta_description='') ORDER BY id DESC LIMIT ?"
  ).bind(limit).all();
  const rows = results || [];
  let fixed = 0;
  const changes = [];
  for (const p of rows) {
    const summary = String(p.summary || '').trim() || deriveSummary(p.body);
    const tags = String(p.tags || '').trim() || deriveTags(p.title, summary, p.category);
    const meta = String(p.meta_description || '').trim() || summary.slice(0, 155).trim();
    if (!summary && !tags && !meta) continue;
    await env.DB.prepare('UPDATE posts SET summary=?,tags=?,meta_description=?,updated_at=? WHERE id=?')
      .bind(summary, tags, meta, now(), p.id).run();
    fixed++;
    changes.push({
      id: p.id,
      title: String(p.title || '').slice(0, 120),
      summary: !String(p.summary || '').trim(),
      tags: !String(p.tags || '').trim(),
      meta: !String(p.meta_description || '').trim()
    });
  }
  const out = { scanned: rows.length, fixed, changes };
  await logAgentRun(env, 'fix_post_basics', out);
  return out;
}

// Manual only: one thin Business draft per click, because deepenOne spends AI tokens.
export async function healDrafts(env, opts = {}) {
  const limit = Math.max(1, Math.min(3, Number(opts.limit) || 1));
  const { results } = await env.DB.prepare(
    "SELECT * FROM posts WHERE category='Business' AND status='draft' ORDER BY id DESC LIMIT 40"
  ).all();
  const rows = results || [];
  const candidates = rows
    .map((post) => ({ post, gap: gapReport(post) }))
    .filter((x) => x.gap.needed)
    .sort((a, b) => b.gap.gaps.length - a.gap.gaps.length || a.gap.words - b.gap.words);

  if (!candidates.length) {
    const out = { scanned: rows.length, candidates: 0, healed: 0, results: [], reason: 'Koi thin Business draft nahi mila — sab drafts detailed hain.' };
    await logAgentRun(env, 'heal_drafts', out);
    return out;
  }

  const out = [];
  for (const c of candidates.slice(0, limit)) {
    const r = await deepenOne(env, c.post.id);
    out.push({
      postId: c.post.id,
      title: String(c.post.title || '').slice(0, 140),
      ok: !!r.ok,
      reason: String(r.reason || '').slice(0, 300),
      fromWords: Number(r.fromWords) || c.gap.words,
      words: Number(r.words) || c.gap.words,
      score: Number(r.score) || 0,
      gaps: c.gap.gaps.map((g) => g.code)
    });
  }
  const summary = {
    scanned: rows.length,
    candidates: candidates.length,
    healed: out.filter((x) => x.ok).length,
    results: out
  };
  await logAgentRun(env, 'heal_drafts', summary);
  return summary;
}
