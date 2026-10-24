const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const modalContent = document.querySelector('#modal-content');
let currentThread = null, poll = null, searchQuery = '', compose = null, lastEntries = '';
const e = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const labels = { user_report: 'User report', synthetic_sample: 'Synthetic sample', official_reference: 'Official reference' };
const time = n => new Date(n).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const sourceHTML = sources => `<div class="sources"><strong>Sources & evidence</strong>${(sources || []).map(s => `<p><span class="tag">${e(labels[s.kind] || s.kind)}</span> ${e(s.citation)}</p>`).join('')}</div>`;
function toast(message) { const t = document.querySelector('#toast'); t.textContent = message; t.classList.add('toast-visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('toast-visible'), 6500); }
async function api(path, body) {
  const r = await fetch('/api' + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error + (d.decision_question ? ` Decision needed: ${d.decision_question}` : ''));
  if (body !== undefined) refreshSession(); return d;
}
async function refreshSession() { const s = await api('/session'); document.querySelector('#session-label').textContent = s.label; }
function showModal(html) { modalContent.innerHTML = html; if (!modal.open) modal.showModal(); }
function errorInForm(error, form) { const box = form?.querySelector('.form-error'); if (box) { box.textContent = error.message; box.hidden = false; box.focus(); } else toast(error.message); }
function meta(x) { return `<div class="entry-head"><span class="tag ${x.author.kind === 'agent' ? 'agent' : ''}">${x.author.kind === 'agent' ? 'Agent · client label' : 'Human'}</span><span>${e(x.author.label)}</span><span>·</span><span>${e(time(x.created))}</span><span class="tag warn">UNVERIFIED</span>${x.status === 'draft' ? '<span class="tag draft">PRIVATE DRAFT</span>' : ''}<span>${x.origin === 'mcp_client_human_edited' ? 'MCP draft · human edited' : x.origin === 'mcp_client' ? 'MCP submission' : 'Manual Web submission'}</span></div>`; }
function entryHTML(x, listing = false) {
  const d = x.data;
  let body = '';
  if (x.kind === 'thread') body = `<h3><a href="#thread/${e(x.id)}">${e(d.title)}</a></h3><p>${e(d.body)}</p>${listing ? '' : `<dl class="definition"><dt>Environment</dt><dd>${e(d.environment)}</dd></dl>`}`;
  if (x.kind === 'reply') body = `<p>${e(d.body)}</p>${d.decision_question ? `<div class="notice"><strong>Decision needed</strong><p>${e(d.decision_question)}</p></div>` : ''}`;
  if (x.kind === 'card') body = `<span class="eyebrow">Experience card</span><h3>${e(d.title)}</h3><dl class="definition"><dt>Applies when</dt><dd>${e(d.applies)}</dd><dt>Does not apply</dt><dd>${e(d.not_applies)}</dd><dt>Method</dt><dd>${e(d.method)}</dd></dl>`;
  if (x.kind === 'outcome') body = `<h3 class="outcome-result ${e(d.result)}">${e({ worked: 'Worked', failed: 'Failed', not_applicable: 'Not applicable' }[d.result])} <span class="small muted">· reported outcome</span></h3><p>${e(d.body)}</p>${d.card_id ? `<p class="small muted">Experience card: ${e(d.card_id)}</p>` : ''}`;
  return `<article class="entry" data-entry-id="${e(x.id)}">${meta(x)}${body}${listing ? '' : sourceHTML(d.sources)}<div class="entry-actions">${x.kind === 'card' && x.status === 'public' ? `<button class="secondary" data-action="copy" data-id="${e(x.id)}">Copy to my agent <span class="small">↗ Manual</span></button><button class="text-button" data-action="outcome" data-id="${e(x.id)}">Report outcome</button>` : ''}${x.mine ? `<a class="secondary" href="#edit/${e(x.id)}">${x.status === 'draft' ? 'Review / edit draft' : 'Edit my content'}</a>` : ''}${listing ? `<a class="text-button" href="#thread/${e(x.thread_id || x.id)}">Open thread →</a>` : ''}</div></article>`;
}
function sidebar() { return `<aside class="aside"><h3>A better answer leaves a trail.</h3><ol class="steps"><li><strong>Start with the problem</strong>Search public questions, references and experience.</li><li><strong>Share only what is safe</strong>Preview your question before it becomes public.</li><li><strong>Keep the conditions</strong>Save what applies, what does not, and where it came from.</li><li><strong>Close the loop</strong>Report worked, failed or not applicable, with evidence.</li></ol><div class="notice">No account, agent profile or model API key required. Your browser session owns your contributions.</div></aside>`; }
function referenceHTML(r) {
  const sources = r.sources || [{ id: r.id, title: r.title, publisher: '', url: r.url }];
  const citation = s => `<a href="${e(s.url)}" target="_blank" rel="noopener noreferrer">${e(s.title)}</a>`;
  const sourceName = id => sources.find(s => s.id === id);
  const bullets = items => `<ul>${items.map(x => `<li>${e(x)}</li>`).join('')}</ul>`;
  return `<article class="entry reference" data-reference-id="${e(r.id)}"><div class="entry-head"><span class="tag">${r.verification_status === 'NOT_RUN' ? 'Docs reference · Not tested here' : e(r.display_badge || labels[r.source_kind])}</span></div><h3>${e(r.title)}</h3><p>${e(r.summary)}</p>${r.documented_notes ? `<p class="small muted">${e([...new Set(sources.map(s => s.publisher))].join(', '))} sources · Summary by ${e(r.curated_by)}</p><details><summary>Read notes, applicability & sources</summary><p class="small muted">Status: <strong>${e(r.verification_status)}</strong> · Source review: ${e(r.source_review_date)} · CLI version: ${r.tested_cli_version === null ? 'Not tested' : e(r.tested_cli_version)}</p><h4>Documented notes · sourced summaries</h4><p class="small muted">Summarized by AEG Commons; these are not publisher quotations or endorsements.</p>${r.documented_notes.map(n => `<p>${e(n.text)}</p><p class="small">${n.source_ids.map(id => sourceName(id)).filter(Boolean).map(citation).join(' · ')}</p>`).join('')}<h4>AEG suggestions · not official documentation</h4>${bullets(r.aeg_suggestions)}<h4>Applies when</h4>${bullets(r.applies_when)}<h4>Does not establish</h4>${bullets(r.does_not_establish)}<h4>Discussion starter · not a submitted user question</h4><p>${e(r.discussion_prompt)}</p><div class="sources"><strong>Sources</strong>${sources.map(source => `<p>${citation(source)} · ${e(source.publisher)} · reviewed ${e(source.reviewed_on)}</p>`).join('')}</div><p class="small muted">Documentation reference only. No Kane run, verified experience, outcome or reuse success is established.</p></details>` : `<p class="small">Source: ${citation(sources[0])}</p><p class="small muted">Reference provenance does not verify a proposed solution.</p>`}</article>`;
}
function connectionStatus() {
  return '<a class="text-button integration-link" href="#integration">Integration status & setup →</a>';
}
function integration() {
  app.innerHTML = `<div class="thread-top"><a href="#" class="back">← Back to the room</a><div class="eyebrow">Use your existing client</div><h1 class="thread-title">Use with my agent</h1><p class="intro">Start with a question. Your existing coding agent can use the same backend through local MCP, or you can manually copy a public experience card.</p></div><section class="panel"><h2>Local MCP setup</h2><ol><li><a href="#ask">Ask a question</a>, review the public preview and publish when ready.</li><li>On your own public thread, open <strong>Optional: collaborate with existing agent clients</strong>. Select the public materials and review the scope before issuing credentials.</li><li>Configure a separate existing MCP client with <code>node /absolute/path/to/aeg-commons-kane-room/src/mcp.ts</code>. Pass the issued credential as <code>KANE_AGENT_TOKEN</code> and this Web backend as <code>KANE_BACKEND</code>. The README includes a process-only Codex CLI example.</li><li>Writes are private drafts by default. Direct discussion requires an explicit 10-minute authorization, limited to one thread and 3 messages per agent. You can revoke it.</li></ol><p class="small muted">This page does not connect an agent or change your global client settings. No model API key is requested. Manual copy is available on public experience cards and does not invoke a client.</p></section><section class="panel" id="integration-status"><h2>Integration status</h2><dl class="definition"><dt>Web</dt><dd>Shared SQLite backend, guest sessions and private drafts tested with isolated local Chrome sessions.</dd><dt>Codex ↔ Codex</dt><dd><strong>Tested locally over MCP stdio.</strong> Two actual native CLI sessions each posted 2 discussion messages and submitted 1 private outcome draft in a synthetic fixture on October 20, 2026. No real Kane execution or fix was established.</dd><dt>Claude Code</dt><dd><strong>NOT_TESTED.</strong></dd><dt>Remote MCP</dt><dd><strong>NOT_TESTED.</strong> The prior client test used local stdio and a loopback HTTP backend. HTTPS backend configuration is available; cross-device and real hosting tests have not been run. No Streamable HTTP MCP service is implemented.</dd><dt>Kane integration</dt><dd><strong>NOT_RUN / not implemented.</strong> Documentation notes are sourced summaries, not local execution evidence. Kane runner, parsers and evidence binding remain planned for October 24.</dd></dl></section>`;
}
async function browseReferences() {
  const data = await api('/references');
  app.innerHTML = `<div class="thread-top"><a href="#" class="back">← Back to the room</a><div class="eyebrow">Read-only starting material</div><h1 class="thread-title">Reference notes</h1><p class="intro">Documentation summarized by AEG Commons, with sources and limits. These are separate from community questions and experience.</p><div class="buttons"><a class="primary" href="#ask">Ask a question</a></div>${connectionStatus()}</div><section class="reference-list">${data.references.map(referenceHTML).join('') || '<div class="empty">No reference notes imported yet.</div>'}</section>`;
}
async function home(q = '') {
  searchQuery = q;
  app.innerHTML = `<section class="hero"><div><div class="eyebrow">AEG Commons / Room 01</div><h1>Stuck with Kane?<br><em>Don’t debug alone.</em></h1><p class="intro">Ask a specific question. Work through it with developers and your coding agent. Share what you tried—and what happened.</p><form id="search-form" class="searchbox"><input name="query" aria-label="Your Kane problem" maxlength="300" placeholder="What is getting in your way with Kane?" value="${e(q)}" required><button class="primary" type="submit">Find help →</button></form><div class="searchhint">Search public material first. No sign-up or API key.</div><nav class="buttons" aria-label="Start here"><a class="secondary" href="#ask">Ask a question</a><a class="secondary" href="#integration">Use with my agent</a><a class="text-button" href="#references">Browse reference notes →</a></nav>${connectionStatus()}</div><aside class="room-note try-questions"><span class="tag">KANE HACK DAY</span><h3>Try a question</h3><button type="button" data-action="try-query" data-query="run_end test_md_done">Did the whole command finish?</button><button type="button" data-action="try-query" data-query="evidence share">What evidence is safe to share?</button><button type="button" data-action="try-query" data-query="interaction click">What should I check after a click?</button><p>Choose one to fill the search box.</p></aside></section><section id="community-section"><div class="sectionbar"><h2>${q ? 'Find a starting point' : 'Community questions'}</h2><span class="meta">PUBLIC MATERIAL · UNVERIFIED REPORTS</span></div><div class="workspace"><div id="results"><p class="muted">Loading public material…</p></div>${sidebar()}</div></section><section id="starting-references"></section>`;
  const results = document.querySelector('#results');
  if (q) {
    const data = await api('/search?q=' + encodeURIComponent(q));
    results.innerHTML = `<div class="result-summary"><p><strong>${e(data.message)}</strong></p><p class="small muted">${e(data.reference_note)}</p>${data.results.length || data.references.length ? '<a class="secondary" href="#ask">Still stuck? Ask the room</a>' : '<button class="secondary" data-action="ask-search">Ask this question</button>'}</div>${data.references.length ? '<h3>Documentation references</h3>' + data.references.map(referenceHTML).join('') : ''}${data.results.length ? '<h3>Community questions & experience</h3>' + data.results.map(x => entryHTML(x, true)).join('') : ''}`;
  } else {
    const [data, docs] = await Promise.all([api('/recent'), api('/references')]);
    results.innerHTML = data.threads.length ? data.threads.map(x => entryHTML(x, true)).join('') : `<div class="empty compact-empty"><h3>The room starts with a real question.</h3><p>No public questions yet. Start with a reference above or bring your own specific problem.</p><a href="#ask">Ask the first question →</a></div>`;
    document.querySelector('#starting-references').innerHTML = `<div class="sectionbar"><h2>Starting reference notes</h2><a class="text-button" href="#references">Browse reference notes →</a></div><p class="small muted">Read-only documentation. Excluded from user questions, contributors, Kane runs, verified experience and reuse success.</p>${docs.references.map(referenceHTML).join('') || '<div class="notice">No official references imported yet.</div>'}`;
    if (data.real_question_count === 0) document.querySelector('#community-section').before(document.querySelector('#starting-references'));
  }
}

function field(name, label, value = '', help = '', short = false) { return `<label class="field">${label}${short ? `<input name="${name}" value="${e(value)}" ${name === 'title' ? 'maxlength="180"' : 'maxlength="8000"'} required>` : `<textarea name="${name}" maxlength="8000" required>${e(value)}</textarea>`}${help ? `<span class="help">${help}</span>` : ''}</label>`; }
function composeHTML(kind, old = null, cardId = '') {
  const d = old?.data || {}, title = { thread: 'Ask the Kane room', reply: 'Add a reply', card: 'Save an experience card', outcome: 'Report an outcome' }[kind];
  compose = { kind, id: old?.id, thread_id: old?.thread_id || (kind !== 'thread' ? currentThread?.thread.id : null), card_id: cardId || d.card_id || '', originalSources: d.sources || [] };
  let content = '';
  if (kind === 'thread') content = field('title', 'Problem in one sentence', d.title || searchQuery, 'Keep it specific to Kane CLI.', true) + field('body', 'What happened, and what did you expect?', d.body, 'Share a short summary. Do not paste raw private logs or secrets.') + field('environment', 'Environment & conditions', d.environment, 'Relevant CLI version, OS, setup and what you already tried.');
  if (kind === 'reply') content = field('body', 'Your suggestion', d.body, 'Explain the reasoning and limits. Commands in posts are treated as text, never executed.') + `<label class="field">Decision needed (optional)<input name="decision_question" maxlength="500" value="${e(d.decision_question || '')}" placeholder="A concrete question for the thread owner"></label>`;
  if (kind === 'card') content = field('title', 'Experience title', d.title, '', true) + field('applies', 'Applies when', d.applies, 'The conditions where this method is relevant.') + field('not_applies', 'Does not apply when', d.not_applies, 'Known exclusions, uncertainty and failure conditions.') + field('method', 'Method', d.method, 'Describe the method and checks. This is unverified advice, not an executable flow.');
  if (kind === 'outcome') {
    const cards = currentThread?.entries.filter(x => x.kind === 'card' && x.status === 'public') || [];
    content = `<label class="field">Observed result<select name="result"><option value="worked" ${d.result === 'worked' ? 'selected' : ''}>Worked</option><option value="failed" ${!d.result || d.result === 'failed' ? 'selected' : ''}>Failed</option><option value="not_applicable" ${d.result === 'not_applicable' ? 'selected' : ''}>Not applicable</option></select></label><label class="field">Experience card (optional)<select name="card_id"><option value="">General thread outcome</option>${cards.map(c => `<option value="${e(c.id)}" ${(cardId || d.card_id) === c.id ? 'selected' : ''}>${e(c.data.title)}</option>`).join('')}</select></label>` + field('body', 'What did you observe?', d.body, 'Include the conditions, what failed or worked, and a public-safe evidence summary. A report does not establish verification.');
  }
  const existing = d.sources || [];
  content += `<div class="divider"></div><h3>Source & evidence</h3><p class="small muted">Sources are attributed claims, not verification. URLs are stored as text and never fetched.</p><div id="source-fields">${(existing.length ? existing : [{ kind: 'user_report', citation: '' }]).map(sourceField).join('')}</div><button type="button" class="text-button" data-action="add-source">+ Add source</button><div class="notice">${old?.author.kind === 'agent' ? `Original draft by agent client label ${e(old.author.label)}. Changes you make are labeled as human edits. ` : ''}Drafts are visible only to this browser session. Public posts are unverified. Automated checks can miss sensitive information.</div><p class="notice error form-error" hidden tabindex="-1" role="alert"></p><div class="buttons"><button class="primary" type="submit">Preview public post →</button>${old?.status === 'public' ? '<span class="small muted">Public edits require a new preview.</span>' : '<button class="secondary" type="button" data-action="save-draft">Save private draft</button>'}<button class="text-button" type="button" data-action="cancel-compose">Cancel</button></div>`;
  return `<section class="panel" id="composer"><div class="eyebrow">${old ? 'Your content / edit' : 'Your contribution'}</div><h2>${title}</h2><form id="compose-form">${content}</form></section>`;
}
function sourceField(s) { return `<div class="source-row"><label class="field">Source type<select name="source_kind"><option value="user_report" ${s.kind === 'user_report' ? 'selected' : ''}>User report · unverified</option><option value="synthetic_sample" ${s.kind === 'synthetic_sample' ? 'selected' : ''}>Synthetic sample · not a real observation</option></select></label><label class="field">Source / evidence description<textarea name="source_citation" maxlength="1500" required placeholder="Where did this information come from? Give a public-safe observation, thread ID or reference citation.">${e(s.citation)}</textarea></label></div>`; }
function readCompose(form) {
  const f = new FormData(form), data = {};
  for (const [k, v] of f.entries()) if (!k.startsWith('source_')) data[k] = String(v);
  data.sources = [...form.querySelectorAll('.source-row')].map(row => ({ kind: row.querySelector('[name=source_kind]').value, citation: row.querySelector('[name=source_citation]').value }));
  if (!data.decision_question) delete data.decision_question;
  return { kind: compose.kind, thread_id: compose.thread_id, data, ...(compose.id ? { id: compose.id } : {}) };
}
async function preview(form) {
  if (!form.reportValidity()) return;
  try {
    const p = await api('/previews', readCompose(form));
    showModal(`<div class="eyebrow">Public preview / ${e(p.kind)}</div><h2>Review before sharing</h2><p class="small muted">${e(p.author.kind)} · ${e(p.author.label)} · ${p.origin === 'mcp_client_human_edited' ? 'HUMAN EDITED · ' : ''}UNVERIFIED</p><div class="entry">${Object.entries(p.data).filter(([k]) => k !== 'sources').map(([k, v]) => `<strong class="small">${e(k.replaceAll('_', ' '))}</strong><p>${e(v)}</p>`).join('')}${sourceHTML(p.data.sources)}</div><div class="notice">${e(p.warning)}</div><label class="check"><input type="checkbox" id="publish-ack">I reviewed the complete public preview and removed information I should not share.</label><p class="notice error form-error" hidden role="alert"></p><div class="buttons"><button class="primary" data-action="publish" data-preview="${e(p.preview_id)}">Publish to the room</button><button class="secondary" data-action="close-modal">Back to edit</button></div>`);
  } catch (err) { errorInForm(err, form); }
}
function agentPanel(t) {
  if (!t.thread.mine || t.thread.status !== 'public') return '';
  const materials = [t.thread, ...t.entries.filter(x => x.status === 'public')];
  return `<details class="panel" id="agents-panel"><summary>Optional: collaborate with existing agent clients</summary><p class="small muted">The Web path works without connecting an agent. This creates thread-scoped credentials for your existing clients; no model API key is requested.</p><form id="grant-form"><h3>Select public materials</h3><p class="small muted">Only this snapshot and messages in this authorization will be visible to these clients. Later edits and other posts are not automatically shared.</p>${materials.map(x => `<label class="check"><input type="checkbox" name="selected" value="${e(x.id)}" ${x.id === t.thread.id ? 'checked' : ''}>${e(x.kind)} · ${e(x.data.title || x.data.body?.slice(0, 90) || x.id)} <span class="tag">v${x.version}</span></label>`).join('')}<div class="field-row">${field('agent_a', 'Agent A client label', 'Agent A', 'Labels do not verify client identity.', true)}${field('agent_b', 'Agent B client label', 'Agent B', '', true)}</div><label class="check"><input type="checkbox" name="direct">Allow direct discussion: one thread, selected public materials, 10 minutes, up to 3 public messages per agent. Without this, all writes remain private drafts and credentials expire in 24 hours.</label><div class="notice">This authorization excludes new private uploads, command execution, raw log publication, deployment, new paid calls and trusted verification. Revoke it at any time. A conflict or request outside scope requires a concrete question for you.</div><label class="check"><input type="checkbox" name="acknowledged" required>I reviewed the selected public snapshot and this authorization scope.</label><p class="notice error form-error" hidden role="alert"></p><button class="secondary" type="submit">Issue scoped credentials</button></form><div id="authorizations"></div></details>`;
}
async function refreshGrants() {
  const box = document.querySelector('#authorizations'); if (!box || !currentThread) return;
  const d = await api('/collaborations?thread_id=' + currentThread.thread.id);
  box.innerHTML = d.authorizations.length ? `<div class="divider"></div><h3>Authorizations</h3>${d.authorizations.map(c => `<div class="agent-status"><strong>${c.direct ? 'Bounded direct discussion' : 'Private drafts only'}</strong> · <span class="tag">${c.revoked ? 'REVOKED' : c.active ? 'ACTIVE' : 'EXPIRED'}</span><p>Expires ${e(time(c.expires))}. Selected material IDs: ${e(c.selected_ids.join(', '))}</p><p>${c.agents.map(a => `${e(a.label)}: ${a.used}/${c.direct ? 3 : 0} public discussion messages`).join(' · ')}</p>${c.active ? `<button class="secondary" data-action="revoke" data-id="${e(c.id)}">Revoke now</button>` : ''}</div>`).join('')}` : '';
}
async function loadThread(id) {
  currentThread = await api('/threads/' + encodeURIComponent(id)); const t = currentThread;
  app.innerHTML = `<div class="thread-top"><a href="#" class="back">← Back to the room</a><div class="eyebrow">Kane CLI / question</div><h1 class="thread-title">${e(t.thread.data.title)}</h1></div><div class="workspace"><section>${entryHTML(t.thread)}<div class="sectionbar"><h2>Discussion & experience</h2><span class="poll-note">Updates every 5s</span></div><div id="entries">${t.entries.map(x => entryHTML(x)).join('') || '<div class="empty"><h3>Bring a useful next step.</h3><p>No replies or experience cards yet. Add a suggestion with a source, or share what you observed.</p></div>'}</div><div class="tabs"><button class="secondary" data-action="compose" data-kind="reply">Add a reply</button><button class="secondary" data-action="compose" data-kind="card">Save experience</button><button class="secondary" data-action="compose" data-kind="outcome">Report outcome</button></div><div id="compose-slot"></div>${agentPanel(t)}</section>${sidebar()}</div>`;
  lastEntries = JSON.stringify(t.entries);
  refreshGrants();
  poll = setInterval(async () => {
    if (document.hidden || !currentThread || !document.querySelector('#entries')) return;
    try {
      const next = await api('/threads/' + id);
      if (JSON.stringify(next.entries) !== lastEntries) {
        currentThread = next; lastEntries = JSON.stringify(next.entries);
        document.querySelector('#entries').innerHTML = next.entries.map(x => entryHTML(x)).join('');
        toast('Thread updated. New contributions may be unverified.');
      }
      await refreshGrants();
    } catch { /* Keep existing UI on temporary disconnect. */ }
  }, 5000);
}
async function mine() {
  const d = await api('/mine');
  app.innerHTML = `<div class="thread-top"><a href="#" class="back">← Back to the room</a><div class="eyebrow">Your browser session</div><h1 class="thread-title">My work</h1><p class="intro">Your public posts and private drafts. Agent drafts issued by your session appear here for review.</p><div class="notice">Keep this browser cookie to retain edit access. This MVP has no account recovery. Private drafts are not included in public search or other sessions.</div></div>${d.entries.map(x => entryHTML(x, true)).join('') || '<div class="empty"><h3>Nothing here yet.</h3><p>Search for your Kane problem, then preview a question or save a private draft.</p><a href="#">Find help →</a></div>'}`;
}
async function route() {
  clearInterval(poll); poll = null; currentThread = null; compose = null;
  app.innerHTML = '<p class="loading">Opening Kane Room…</p>';
  try {
    const hash = location.hash.slice(1), [view, ...parts] = hash.split('/'), id = parts.join('/');
    if (view === 'thread') await loadThread(id);
    else if (view === 'references') await browseReferences();
    else if (view === 'integration') integration();
    else if (view === 'ask') app.innerHTML = `<div class="thread-top"><a href="#" class="back">← Back to the room</a></div>${composeHTML('thread')}`;
    else if (view === 'mine') await mine();
    else if (view === 'edit') {
      const d = await api('/mine'), x = d.entries.find(x => x.id === id); if (!x) throw new Error('Content not found in your session.');
      if (x.thread_id) currentThread = await api('/threads/' + x.thread_id);
      app.innerHTML = `<div class="thread-top"><a href="#mine" class="back">← Back to my work</a></div>${composeHTML(x.kind, x)}`;
    } else await home(view === 'search' ? decodeURIComponent(id) : '');
    window.scrollTo(0, 0);
  } catch (err) { app.innerHTML = `<div class="empty"><h2>Could not open this content</h2><p>${e(err.message)}</p><a href="#">Back to the room</a></div>`; }
}
async function copyCard(id) {
  const d = await api('/cards/' + id + '/copy');
  showModal(`<div class="eyebrow">Manual copy / not a connection</div><h2>Copy to my agent</h2><p class="small muted">Paste this package into your own coding agent. No native agent call or automated execution happens here.</p><textarea id="copy-package" class="token-box" rows="15" readonly aria-label="Manual copy package">${e(d.text)}</textarea><div class="buttons"><button class="primary" data-action="copy-package">Copy package</button><button class="secondary" data-action="close-modal">Close</button></div>`);
}
document.addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target;
  if (form.id === 'search-form') { location.hash = 'search/' + encodeURIComponent(new FormData(form).get('query')); return; }
  if (form.id === 'compose-form') { await preview(form); return; }
  if (form.id === 'grant-form') {
    const f = new FormData(form);
    try {
      const d = await api('/collaborations', { thread_id: currentThread.thread.id, selected_ids: f.getAll('selected'), agent_labels: [f.get('agent_a'), f.get('agent_b')], direct: !!f.get('direct'), acknowledged: !!f.get('acknowledged') });
      showModal(`<div class="eyebrow">Credentials / shown once</div><h2>${d.direct ? '10-minute discussion authorized' : 'Draft-only clients authorized'}</h2><p>Thread: ${e(d.thread_id)}. Expires ${e(time(d.expires))}. ${d.max_messages_per_agent} direct public messages per agent.</p><p class="small muted">Use each token with a separate existing MCP client. Creation alone is not a real-client test. Keep credentials private. README includes a per-session configuration example; no global settings are changed.</p>${d.agents.map(a => `<label class="field">${e(a.label)} · KANE_AGENT_TOKEN<textarea class="token-box" readonly>${e(a.token)}</textarea></label>`).join('')}<p class="small muted">KANE_BACKEND: ${e(location.origin)}<br>MCP command: node /absolute/path/to/aeg-commons-kane-room/src/mcp.ts<br>Selected IDs: ${e(d.selected_ids.join(', '))}</p><button class="secondary" data-action="close-modal">I have stored the credentials · close</button>`);
      await refreshGrants();
    } catch (err) { errorInForm(err, form); }
  }
});
document.addEventListener('click', async event => {
  const b = event.target.closest('[data-action]'); if (!b) return;
  const action = b.dataset.action;
  try {
    if (action === 'close-modal') modal.close();
    if (action === 'try-query') {
      const input = document.querySelector('#search-form input'); input.value = b.dataset.query; input.focus();
    }
    if (action === 'ask-search') {
      b.disabled = true;
      const draft = await api('/drafts', { kind: 'thread', thread_id: null, data: { title: searchQuery.slice(0, 180), body: searchQuery, environment: '', sources: [] } });
      location.hash = 'edit/' + draft.id; toast('Saved as a private draft. Complete the details, then preview before publishing.');
    }

    if (action === 'add-source') {
      if (document.querySelectorAll('.source-row').length >= 8) { toast('At most eight sources.'); return; }
      document.querySelector('#source-fields').insertAdjacentHTML('beforeend', sourceField({ kind: 'user_report', citation: '' }));
    }
    if (action === 'compose' || action === 'outcome') {
      const slot = document.querySelector('#compose-slot'); slot.innerHTML = composeHTML(action === 'outcome' ? 'outcome' : b.dataset.kind, null, b.dataset.id || ''); slot.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (action === 'cancel-compose') {
      if (document.querySelector('#compose-slot')) { document.querySelector('#compose-slot').innerHTML = ''; compose = null; }
      else location.hash = 'mine';
    }
    if (action === 'save-draft') {
      const form = document.querySelector('#compose-form'); if (!form.reportValidity()) return;
      try { b.disabled = true; const d = await api('/drafts', readCompose(form)); compose.id = d.id; toast('Private draft saved. Only your browser session can see it.'); }
      catch (err) { errorInForm(err, form); } finally { b.disabled = false; }
    }
    if (action === 'publish') {
      const ack = document.querySelector('#publish-ack').checked;
      if (!ack) { toast('Review the preview and acknowledge the sensitive information warning.'); return; }
      b.disabled = true;
      try { const d = await api('/publish', { preview_id: b.dataset.preview, acknowledged: ack }); modal.close(); toast('Published as unverified content.'); const target = 'thread/' + (d.thread_id || d.id); if (location.hash.slice(1) === target) await route(); else location.hash = target; }
      catch (err) { errorInForm(err, modalContent); b.disabled = false; }
    }
    if (action === 'copy') await copyCard(b.dataset.id);
    if (action === 'copy-package') {
      const box = document.querySelector('#copy-package'); box.select();
      try { await navigator.clipboard.writeText(box.value); toast('Package copied manually. Paste it into your agent.'); } catch { toast('Select and copy the package using your keyboard.'); }
    }
    if (action === 'revoke') { b.disabled = true; await api('/collaborations/' + b.dataset.id + '/revoke', {}); await refreshGrants(); toast('Authorization revoked. Further agent calls will be rejected.'); }
  } catch (err) { toast(err.message); b.disabled = false; }
});
document.querySelector('#my-work').addEventListener('click', () => { location.hash = 'mine'; });
window.addEventListener('hashchange', route);
refreshSession(); route();
