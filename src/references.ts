// Extend the existing curated-reference format; references never become user entries.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, openSync, closeSync, fsyncSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';

function requireValue(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function text(v: any, label: string, max = 8000) { requireValue(typeof v === 'string' && v.trim().length > 0 && v.length <= max, `Invalid ${label}.`); return v; }
function list(v: any, label: string) { requireValue(Array.isArray(v) && v.length > 0 && v.length <= 50, `Invalid ${label}.`); return v; }
function date(v: any) { requireValue(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v).toISOString().slice(0, 10) === v, 'Invalid reference review date.'); return v; }
function https(v: any) { const u = new URL(text(v, 'reference URL', 2000)); requireValue(u.protocol === 'https:' && !u.username && !u.password, 'Reference URL must be HTTPS without credentials.'); return u.href; }
function canonical(v: any): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
export function referenceHash(value: any) {
  const { _seed, ...content } = value;
  return createHash('sha256').update(canonical(content)).digest('hex');
}
export function validateReference(r: any): any {
  requireValue(r && typeof r === 'object' && !Array.isArray(r), 'Invalid reference.');
  const base = ['id', 'title', 'summary', 'url', 'source_kind', '_seed'];
  const extended = ['revision', 'source_type', 'display_badge', 'curated_by', 'publisher_endorsement', 'source_review_date', 'verification_status', 'tested_cli_version', 'real_user_question', 'outcome_receipts', 'short_answer', 'documented_notes', 'aeg_suggestions', 'applies_when', 'does_not_establish', 'discussion_prompt', 'search_terms', 'source_ids', 'sources'];
  requireValue(Object.keys(r).every(k => base.includes(k) || extended.includes(k)), 'Unexpected reference fields.');
  text(r.id, 'reference ID', 100); text(r.title, 'reference title', 180); text(r.summary, 'reference summary', 4000);
  requireValue(['official_reference', 'synthetic_sample'].includes(r.source_kind), 'Invalid reference source kind.');
  const out = { ...r, url: https(r.url) }; delete out._seed; // Import bookkeeping is not public content.
  if (r.revision !== undefined) {
    requireValue(Number.isSafeInteger(r.revision) && r.revision >= 1, 'Invalid reference revision.');
    requireValue(r.source_type === 'OFFICIAL_DOCUMENTATION' && r.source_kind === 'official_reference' && r.display_badge === 'Documentation reference' && r.curated_by === 'AEG Commons', 'Invalid documentation provenance.');
    requireValue(r.publisher_endorsement === false && r.verification_status === 'NOT_RUN' && r.tested_cli_version === null && r.real_user_question === false && Array.isArray(r.outcome_receipts) && r.outcome_receipts.length === 0, 'Documentation seeds must remain NOT_RUN, without user activity or outcomes.');
    date(r.source_review_date); text(r.short_answer, 'short answer', 4000); text(r.discussion_prompt, 'discussion prompt');
    for (const key of ['aeg_suggestions', 'applies_when', 'does_not_establish', 'search_terms', 'source_ids']) list(r[key], key).forEach((v: any) => text(v, key));
    const ids = new Set<string>();
    list(r.sources, 'resolved sources').forEach((s: any) => { text(s.id, 'source ID', 100); requireValue(!ids.has(s.id), 'Duplicate source ID.'); ids.add(s.id); text(s.title, 'source title'); text(s.publisher, 'source publisher'); https(s.url); date(s.reviewed_on); });
    requireValue(r.source_ids.length === ids.size && r.source_ids.every((id: string) => ids.has(id)), 'Reference source IDs must match resolved sources.');
    list(r.documented_notes, 'documented notes').forEach((n: any) => { text(n.text, 'documented note'); list(n.source_ids, 'note source IDs').forEach((id: any) => requireValue(ids.has(id), 'Unresolved documented-note source.')); });
  }
  return out;
}
export function mapReferenceSeed(input: any) {
  requireValue(input?.schema_version === 'aeg-commons-reference-content-1' && input.language === 'en', 'Unsupported reference content interchange.');
  requireValue(input.import_policy?.opt_in === true && input.import_policy.preserve_existing_data === true && input.import_policy.create_fake_people_threads_or_activity === false && input.import_policy.count_as_verified_experience === false && input.import_policy.auto_execute_commands_or_fetch_urls === false, 'Unsafe reference import policy.');
  requireValue(input.sources && typeof input.sources === 'object', 'Missing reference sources.');
  const ids = new Set<string>();
  return list(input.records, 'reference records').map((r: any) => {
    requireValue(!ids.has(r.id), 'Duplicate seed reference ID.'); ids.add(r.id);
    const sources = list(r.source_ids, 'record source IDs').map((id: string) => { requireValue(Object.hasOwn(input.sources, id), 'Unresolved source ID.'); return { id, ...input.sources[id] }; });
    return validateReference({ ...r, summary: r.short_answer, url: sources[0].url, source_kind: 'official_reference', sources });
  });
}
export function importReferenceSeed(seedPath: string, targetPath: string) {
  const incoming = mapReferenceSeed(JSON.parse(readFileSync(seedPath, 'utf8')));
  const lockPath = targetPath + '.lock';
  let lock: number;
  try { lock = openSync(lockPath, 'wx', 0o600); } catch { throw new Error('Reference import is locked. Check for another importer before removing a stale .lock file.'); }
  let temp: string | undefined;
  try {
    const before = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : null;
    const current = before === null ? [] : JSON.parse(before);
    requireValue(Array.isArray(current), 'Existing curated references must be an array.');
    requireValue(new Set(current.map(r => r.id)).size === current.length, 'Duplicate IDs already exist; no changes made.');
    const report: any = { inserted: [], updated: [], unchanged: [], skipped: [], total: current.length };
    for (const item of incoming) {
      const index = current.findIndex(r => r.id === item.id), old = current[index];
      if (old) {
        if (!old._seed || old._seed.content_hash !== referenceHash(old)) { report.skipped.push({ id: item.id, reason: 'existing_record_modified_or_not_seed_managed' }); continue; }
        if (old._seed.revision > item.revision) { report.skipped.push({ id: item.id, reason: 'older_seed_revision' }); continue; }
        if (old._seed.revision === item.revision) {
          if (referenceHash(item) === referenceHash(old)) report.unchanged.push(item.id);
          else report.skipped.push({ id: item.id, reason: 'same_revision_different_content' });
          continue;
        }
      }
      const managed = { ...item, _seed: { schema_version: 'aeg-commons-reference-content-1', revision: item.revision, content_hash: referenceHash(item) } };
      if (old) { current[index] = managed; report.updated.push(item.id); } else { current.push(managed); report.inserted.push(item.id); }
    }
    requireValue(current.length <= 100, 'At most 100 curated references are supported.');
    if (report.inserted.length || report.updated.length) {
      temp = join(dirname(targetPath), `.${basename(targetPath)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
      const fd = openSync(temp, 'wx', 0o600);
      try { writeFileSync(fd, JSON.stringify(current, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
      requireValue((existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : null) === before, 'References changed during import; no changes made.');
      renameSync(temp, targetPath); temp = undefined;
    }
    report.total = current.length; return report;
  } finally {
    if (temp) unlinkSync(temp);
    closeSync(lock!); unlinkSync(lockPath);
  }
}
