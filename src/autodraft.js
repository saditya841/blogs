// autodraft.js — ZERO-token safety rules for the "AI drafts, human approves" mode.
//
// Hourly cron pehle se hai. Bina in rules ke 24 drafts/day ban sakte hain: free AI keys
// rate-limit ho jayengi, approval queue kabhi khali nahi hoga, aur AdSense ki nazar me
// site "scaled content" jaisi lagegi. Isliye auto-draft sirf tab chalta hai jab:
//   1. approve karne ke liye queue me jagah ho, aur
//   2. draft business depth gate + minimum score pass kare.
// Fail hone par post auto-reject hota hai, taaki admin ko sirf accha draft dikhe.

export function autoDraftQueue(pending, env = {}) {
  const raw = Number(env.AUTO_DRAFT_QUEUE_MAX);
  const max = Number.isFinite(raw) && raw >= 1 ? raw : 6;
  const p = Math.max(0, Number(pending) || 0);
  const allowed = p < max;
  return {
    allowed,
    pending: p,
    max,
    reason: allowed ? '' : `Approval queue full (${p}/${max}) — pehle purane drafts approve ya reject karo`
  };
}

export function autoDraftKeep(result = {}, env = {}) {
  if (!result.ok || !result.postId) {
    return { keep: false, reason: String(result.reason || 'auto-draft fail').slice(0, 220) };
  }
  if (!result.business) return { keep: true, reason: '' };
  const raw = Number(env.AUTO_DRAFT_MIN_SCORE);
  const min = Number.isFinite(raw) && raw >= 0 ? raw : 60;
  if (result.businessOk === false) {
    return { keep: false, reason: `Business depth gate fail (${result.businessScore ?? '-'}/100)` };
  }
  if (Number(result.score) < min) {
    return { keep: false, reason: `Score ${result.score} < auto-draft minimum ${min}` };
  }
  return { keep: true, reason: '' };
}
