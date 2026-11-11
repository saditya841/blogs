// corrections.js — public corrections / updates record (ZERO token).
//
// AdSense and Google's quality raters look for a visible correction policy that is actually
// used. Every correction is stored with the old text, the new text and a reason, and the post
// body gets a dated "Update" line. The public /corrections page lists the latest ones.
//
// Tables are created lazily (old databases keep working before migration_v5.sql).

const now = () => Math.floor(Date.now() / 1000);
const clean = (s, n = 400) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

export async function ensureCorrectionTable(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS corrections (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, old_text TEXT, new_text TEXT, reason TEXT, created_at INTEGER)').run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_corrections_post ON corrections(post_id, created_at)').run();
}

export async function addCorrection(env, postId, oldText, newText, reason) {
  try {
    await ensureCorrectionTable(env);
    await env.DB.prepare('INSERT INTO corrections(post_id,old_text,new_text,reason,created_at) VALUES(?,?,?,?,?)')
      .bind(Number(postId) || 0, clean(oldText), clean(newText), clean(reason, 300), now()).run();
    return true;
  } catch {
    return false;
  }
}

export async function correctionsForPost(env, postId) {
  try {
    const { results } = await env.DB.prepare(
      'SELECT id,old_text,new_text,reason,created_at FROM corrections WHERE post_id=? ORDER BY created_at DESC LIMIT 20'
    ).bind(Number(postId) || 0).all();
    return results || [];
  } catch {
    return [];
  }
}

export async function recentCorrections(env, limit = 50) {
  try {
    const { results } = await env.DB.prepare(
      'SELECT c.id,c.post_id,c.old_text,c.new_text,c.reason,c.created_at,p.title,p.slug FROM corrections c JOIN posts p ON p.id=c.post_id ORDER BY c.created_at DESC LIMIT ?'
    ).bind(Math.max(1, Math.min(100, Number(limit) || 50))).all();
    return results || [];
  } catch {
    return [];
  }
}

export function correctionLine(reason, at = now()) {
  const d = new Date((at + 19800) * 1000).toISOString().slice(0, 10); // IST date
  return `\n\nUpdate (${d}): ${clean(reason, 300)}`;
}
