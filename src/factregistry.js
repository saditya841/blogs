// factregistry.js — small permanent fact record (ZERO token).
//
// Why: a claim checked today can quietly go stale (an official revises a number, a report is
// withdrawn). The article then keeps a "verified" claim that is no longer true.
//
// This module stores every code-verified fact with its outlets and a last_verified time,
// links facts to the post, and can list facts that have not been re-checked recently.
// Tables are created lazily so an old database keeps working before migration_v5.sql is run.

const now = () => Math.floor(Date.now() / 1000);
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 240);

export async function ensureFactTables(env) {
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS facts (id INTEGER PRIMARY KEY AUTOINCREMENT, topic_id INTEGER, text TEXT NOT NULL, status TEXT DEFAULT \'active\', first_seen INTEGER, last_verified INTEGER)'),
    env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_facts_topic_text ON facts(topic_id, text)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS fact_sources (fact_id INTEGER NOT NULL, source TEXT, url TEXT, date INTEGER, PRIMARY KEY(fact_id, source))'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS post_facts (post_id INTEGER NOT NULL, fact_id INTEGER NOT NULL, PRIMARY KEY(post_id, fact_id))')
  ]);
}

// Saves (or refreshes) verified facts for a topic and returns their ids.
// facts = [{ text|claim, outlets: [...] }]
export async function saveFacts(env, topicId, facts, opts = {}) {
  const list = (facts || [])
    .map((f) => ({ text: clean(f && (f.text || f.claim || f.c)), outlets: (f && (f.outlets || f.agreeOutlets)) || [] }))
    .filter((f) => f.text.length > 8)
    .slice(0, Math.max(1, Number(opts.max ?? 20)));
  if (!list.length) return [];
  try {
    await ensureFactTables(env);
  } catch {
    return [];
  }

  const ids = [];
  const ts = now();
  for (const f of list) {
    try {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO facts(topic_id,text,status,first_seen,last_verified) VALUES(?,?,'active',?,?)"
      ).bind(Number(topicId) || 0, f.text, ts, ts).run();
      await env.DB.prepare('UPDATE facts SET last_verified=?,status=\'active\' WHERE topic_id=? AND text=?')
        .bind(ts, Number(topicId) || 0, f.text).run();
      const row = await env.DB.prepare('SELECT id FROM facts WHERE topic_id=? AND text=?')
        .bind(Number(topicId) || 0, f.text).first();
      if (!row || !row.id) continue;
      ids.push(row.id);
      for (const o of (f.outlets || []).slice(0, 6)) {
        const name = clean(typeof o === 'string' ? o : (o && (o.source || o.title)) || '') || 'source';
        await env.DB.prepare('INSERT OR IGNORE INTO fact_sources(fact_id,source,url,date) VALUES(?,?,?,?)')
          .bind(row.id, name, clean(o && o.url || ''), ts).run();
      }
    } catch { /* one bad fact must not stop the draft */ }
  }
  return [...new Set(ids)];
}

export async function linkPostFacts(env, postId, factIds) {
  try {
    await ensureFactTables(env);
    const stmts = (factIds || []).slice(0, 40).map((fid) =>
      env.DB.prepare('INSERT OR IGNORE INTO post_facts(post_id,fact_id) VALUES(?,?)').bind(Number(postId) || 0, Number(fid) || 0)
    );
    if (stmts.length) await env.DB.batch(stmts);
  } catch { /* best effort */ }
}

export async function factsForPost(env, postId) {
  try {
    const { results } = await env.DB.prepare(
      'SELECT f.id,f.text,f.last_verified,f.status FROM facts f JOIN post_facts pf ON pf.fact_id=f.id WHERE pf.post_id=? ORDER BY f.id'
    ).bind(Number(postId) || 0).all();
    return results || [];
  } catch {
    return [];
  }
}

// Facts whose last verification is older than maxAgeHours (default 24h).
export async function staleFacts(env, postId, maxAgeHours = 24) {
  const cutoff = now() - Math.max(1, Number(maxAgeHours) || 24) * 3600;
  try {
    const { results } = await env.DB.prepare(
      'SELECT f.id,f.text,f.last_verified FROM facts f JOIN post_facts pf ON pf.fact_id=f.id WHERE pf.post_id=? AND (f.last_verified IS NULL OR f.last_verified<?) ORDER BY f.id LIMIT 10'
    ).bind(Number(postId) || 0, cutoff).all();
    return results || [];
  } catch {
    return [];
  }
}

export async function markFactsVerified(env, topicId, facts) {  if (!Array.isArray(facts) || !facts.length) return 0;
  let n = 0;
  const ts = now();
  try {
    for (const f of facts.slice(0, 30)) {
      const text = clean(f && (f.text || f.claim || f.c));
      if (!text) continue;
      const r = await env.DB.prepare('UPDATE facts SET last_verified=? WHERE topic_id=? AND text=?')
        .bind(ts, Number(topicId) || 0, text).run();
      if (r && r.meta && r.meta.changes) n += r.meta.changes;
    }
  } catch { /* best effort */ }
  return n;
}

// Admin re-read the linked sources and confirms the facts are still current.
export async function markPostFactsVerified(env, postId) {
  const ts = now();
  try {
    const r = await env.DB.prepare(
      'UPDATE facts SET last_verified=? WHERE id IN (SELECT fact_id FROM post_facts WHERE post_id=?)'
    ).bind(ts, Number(postId) || 0).run();
    return (r && r.meta && r.meta.changes) || 0;
  } catch {
    return 0;
  }
}
