// Shared helpers: data loading, Romanian number formatting, source links, coverage block.
const cache = new Map();
export function load(name) {
  if (!cache.has(name)) {
    cache.set(name, fetch('data/' + name).then((r) => {
      if (!r.ok) throw new Error(name + ': HTTP ' + r.status);
      return r.json();
    }));
  }
  return cache.get(name);
}
const nf = (d) => new Intl.NumberFormat('ro-RO', { minimumFractionDigits: d, maximumFractionDigits: d });
const nfs = [nf(0), nf(1), nf(2)];
export const int = (n) => (n == null ? '–' : nfs[0].format(n));
export const dec = (n, d = 1) => (n == null ? '–' : nfs[d].format(n));
const sg = (d) => new Intl.NumberFormat('ro-RO', { signDisplay: 'exceptZero', minimumFractionDigits: d, maximumFractionDigits: d });
const sgs = [sg(0), sg(1), sg(2)];
export const sint = (n) => (n == null ? '–' : sgs[0].format(n));
export const sdec = (n, d = 1) => (n == null ? '–' : sgs[d].format(n));
export const dayRO = (iso) => new Intl.DateTimeFormat('ro-RO', { dateStyle: 'long', timeZone: 'Europe/Bucharest' }).format(new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso));
// Fill <span data-v="name"> placeholders with values computed from the data (no numbers are typed in the HTML).
export function fill(values) {
  for (const [k, v] of Object.entries(values)) document.querySelectorAll('[data-v="' + k + '"]').forEach((n) => { n.textContent = String(v); });
}
// Threshold of the CANOPY_YOY rule, read from meta.flag_rules text ("... > 10 %").
export function yoyThreshold(meta) {
  const m = />\s*(\d+(?:[.,]\d+)?)\s*%/.exec((meta.flag_rules && meta.flag_rules.CANOPY_YOY) || '');
  return m ? m[1].replace('.', ',') : null;
}
export const dateRO = (iso) => new Intl.DateTimeFormat('ro-RO', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Bucharest' }).format(new Date(iso));

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v; else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}
export function link(href, text) {
  return el('a', { href, rel: 'noopener' }, text);
}
// Turn plain URLs inside a text into links (the text is data, never HTML).
export function linkify(text) {
  const frag = document.createDocumentFragment();
  const re = /\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s,;)]+)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    const url = m[1] || m[2];
    const start = m.index + (m[1] ? 1 : 0);
    frag.append(text.slice(last, start));
    frag.append(link(url, url));
    last = start + url.length;
  }
  frag.append(text.slice(last));
  return frag;
}
// "Surse:" line with links to the provenance records (R2). Uses the public `url`, never `download_url`.
// Long lists (more than 3 links) are collapsed behind <details> so phones do not get a wall of links.
export function sourceLine(meta, ids, label = 'Surse') {
  const uniq = [...new Set(ids)].filter((i) => meta.sources[i]);
  const p = el('p', { class: 'src' });
  const items = uniq.map((id) => {
    const s = meta.sources[id];
    return el('span', { class: 'srcitem' }, link(s.url, s.title), ' (descărcat ' + s.retrieved_at.slice(0, 10) + ')');
  });
  if (uniq.length <= 3) {
    p.append(label + ': ');
    items.forEach((it, i) => { if (i) p.append(' · '); p.append(it); });
    return p;
  }
  const ul = el('ul', { class: 'srclist' }, items.map((it) => el('li', {}, it)));
  return el('details', { class: 'src-details' }, el('summary', {}, label + ' (' + uniq.length + ' fișiere; arată lista)'), ul);
}
export function fillCoverage(metas) {
  const ul = document.getElementById('coverage-notes');
  if (!ul) return;
  const seen = new Set();
  for (const m of metas) for (const c of m.coverage || []) if (!seen.has(c) && !/23[,.]21/.test(c)) { seen.add(c); ul.append(el('li', {}, c)); }
}
export function fillAttribution(metas, target = document.getElementById('attributions')) {
  if (!target) return;
  const seen = new Set();
  for (const m of metas) for (const a of m.attribution || []) if (!seen.has(a)) { seen.add(a); target.append(el('li', {}, linkify(a))); }
}
export function showError(err) {
  console.error(err);
  const box = document.getElementById('load-error');
  if (box) {
    box.hidden = false;
    box.textContent = 'Datele nu s-au putut încărca. Reîncarcă pagina sau descarcă fișierele de pe pagina „Cum am calculat”, secțiunea „Date deschise”.';
  }
}
export function announce(msg) {
  const r = document.getElementById('live');
  if (r) r.textContent = msg;
}

// Attribution text of one input dataset (verbatim from meta.input_licences), e.g. creditOf(meta, 'ancpi_uat').
export function creditOf(meta, source) {
  const il = (meta.input_licences || []).find((i) => i.source === source);
  return il ? il.attribution : null;
}
// Credit block for OSM-derived figures: OSM text + ANCPI text (boundaries), verbatim from the data (contract v0.3).
export function osmCredit(meta, cls = 'src') {
  const p = el('p', { class: cls });
  const parts = ['osm_geofabrik', 'ancpi_uat'].map((id) => creditOf(meta, id)).filter(Boolean);
  parts.forEach((t, i) => { if (i) p.append(' '); p.append(linkify(t)); });
  return p;
}
// Reference field line for the INS population (contract v0.4): label_ro, source_label_ro, link to the INS document, locator.
export function insSource(meta, cls = 'src') {
  const rf = meta.reference_fields && meta.reference_fields.population_2021_ins;
  const s = rf && meta.sources[rf.source_id];
  if (!s) return null;
  return el('p', { class: cls }, rf.source_label_ro + ' (', link(s.url, s.title), s.locator ? ', ' + s.locator : '', '; descărcat ' + s.retrieved_at.slice(0, 10) + '). Licența de reutilizare: ', link(s.licence_url, 'Licența pentru Guvernare Deschisă v1.0'), s.licence_text_url ? [' (', link(s.licence_text_url, 'textul licenței'), ')'] : '', '.');
}
// First coverage note of a meta that contains all the given fragments (notes stay verbatim, only selected).
export function noteWith(meta, ...frags) {
  return (meta.coverage || []).find((c) => frags.every((f) => c.includes(f))) || null;
}
