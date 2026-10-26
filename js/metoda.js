import { load, int, dec, dayRO, dateRO, fill, yoyThreshold, el, link, linkify, sourceLine, fillCoverage, fillAttribution, showError, osmCredit, insSource } from './common.js';

const STATUS = {
  'built': 'disponibilă',
  'not built': 'încă indisponibilă',
  'built (cross-check only)': 'doar verificare',
  'not built (reference only)': 'doar referință, nu e folosită',
};
const MAIN = ['public_green_mapped', 'tree_canopy', 'all_vegetation'];

function defItem(d) {
  return [
    el('dt', {}, el('strong', {}, d.label_ro), ' (' + (STATUS[d.status] || d.status) + ')'),
    el('dd', {}, d.definition_ro,
      el('br'), el('span', { class: 'src' }, 'Ani: ' + d.year_ro + ' · Unități: ' + d.unit_ro + ' · Licența datelor de intrare: ' + d.input_licence_ro + ' · Include terenuri private: ' + (d.includes_private ? 'da' : 'nu')),
      el('details', {}, el('summary', {}, 'Regula tehnică (în engleză)'), el('p', { class: 'src' }, d.rules))),
  ];
}

async function main() {
  const [defs, sec, city, osm, cityOsm, cross, manifest] = await Promise.all([
    load('manifest.json'),
    load('definitions.json'), load('sectors_canopy.geojson'), load('city_canopy.json'),
    load('sectors_public_green_osm.json'), load('city_public_green_osm.json'), load('sectors_stl_vlcc_crosscheck.json'),
  ]).then((r) => [...r.slice(1), r[0]]);
  const a = sec.meta.data_as_of;
  const years = city.data.map((r) => r.year);
  const range = years[0] + '–' + years[years.length - 1];
  const feats = sec.data.features.map((f) => f.properties).sort((x, y) => x.sector_no - y.sector_no);

  document.getElementById('defs-main').append(el('dl', {}, MAIN.map((id) => defs.data.find((d) => d.measure_id === id)).filter(Boolean).flatMap(defItem)));
  document.getElementById('defs-other').append(el('dl', {}, defs.data.filter((d) => !MAIN.includes(d.measure_id)).flatMap(defItem)));

  // cross-check: short paragraph, no table
  const cy = cross.meta.data_as_of.stl_year;
  document.getElementById('src-cross').append(sourceLine(cross.meta, cross.data.flatMap((r) => r.sources), 'Surse'),
    el('p', { class: 'src' }, 'Valorile pe sector (anul ' + cy + '): ', link('data/sectors_stl_vlcc_crosscheck.json', 'sectors_stl_vlcc_crosscheck.json'), ' · licența noastră: ', link(cross.meta.licence_url, cross.meta.licence), '.'));
  const th = (t, c) => el('th', { scope: 'col', class: c }, t);
  const sorted = [...cross.data].sort((x, y) => x.ratio_stl_to_vlcc - y.ratio_stl_to_vlcc);
  const low = sorted[0];
  const stlText = 'raportul Street Tree Layer ÷ coronament VLCC, pe sector, este între ' + dec(low.ratio_stl_to_vlcc, 2) + ' și ' + dec(sorted[sorted.length - 1].ratio_stl_to_vlcc, 2) + '; cifrele diferă între cele două produse.';
  const maxYoy = Math.max(...city.data.filter((r) => r.yoy_change_pct != null).map((r) => Math.abs(r.yoy_change_pct)));
  const flagged = city.data.filter((r) => r.flag_yoy_implausible).map((r) => r.year);
  const yoyText = 'Aplicăm o regulă de control (CANOPY_YOY): semnalăm orice schimbare anuală a orașului de peste ' + yoyThreshold(city.meta) + ' %. ' +
    (flagged.length ? 'Ani semnalați: ' + flagged.join(', ') + '.' : 'În ' + range + ' nu s-a semnalat nimic') + '; cea mai mare schimbare a fost de ' + dec(maxYoy, 1) + ' %.';

  // sector 1 text
  const last = years[years.length - 1];
  const val = (p) => p.canopy.find((c) => c.year === last).canopy_m2_per_person;
  const s1 = feats.find((p) => p.sector_no === 1), others = feats.filter((p) => p.sector_no !== 1).map(val);
  document.getElementById('s1-text').textContent = 'În ' + last + ', ' + s1.name + ' are ' + dec(val(s1), 1) + ' m² de coronament pe locuitor, iar celelalte sectoare între ' + dec(Math.min(...others), 1) + ' și ' + dec(Math.max(...others), 1) + ' m².';

  fill({ canopy_range: range, pop_year: a.population, bounds: a.boundaries, osm_date: dayRO(osm.meta.data_as_of.osm_snapshot),
    stl_year: cy, stl_text: stlText, yoy_text: yoyText, lic_attr: sec.meta.licence_attribution });

  // sources table from input_licences; source_ids (contract v0.3) link each input licence to its meta.sources entry
  const seen = new Map();
  for (const m of [sec.meta, city.meta, osm.meta, cityOsm.meta, cross.meta]) {
    for (const il of m.input_licences) if (!seen.has(il.source)) seen.set(il.source, { il, meta: m });
  }
  const USE = {
    clms_hrl_vlcc: 'Coronament arbori', clms_ua2021_stl: 'Verificarea cu Street Tree Layer', census_grid_2021: 'Populație, grilă de 1 km (folosită la calcule)',
    ancpi_uat: 'Limitele sectoarelor', osm_geofabrik: 'Verde public cartografiat', ins_census2021: 'Populație pe sector, doar ca referință (nu intră în calcule)',
  };
  const srows = [...seen.values()].map(({ il, meta }) => {
    const s = meta.sources[il.source_ids[0]];
    return el('tr', {}, el('th', { scope: 'row', class: 'l' }, s ? link(s.landing_page, il.source) : il.source),
      el('td', { class: 'l' }, USE[il.source] || ''), el('td', { class: 'l' }, link(il.licence_url, il.licence), il.licence_text_url ? [' (', link(il.licence_text_url, 'textul licenței'), ')'] : ''));
  });
  document.getElementById('table-sources').append(el('div', { class: 'scroll', role: 'region', tabindex: '0', 'aria-label': 'Surse și licențe, derulează' },
    el('table', {}, el('caption', {}, 'Sursele datelor (linkul duce la pagina publică a setului de date)'),
      el('thead', {}, el('tr', {}, th('Sursă (cod)', 'l'), th('Folosită pentru', 'l'), th('Licența datelor de intrare', 'l'))), el('tbody', {}, srows))));

  // downloads table from manifest.json (no typed licences)
  const kb = (b) => (b >= 1048576 ? dec(b / 1048576, 1) + ' MB' : dec(b / 1024, 1) + ' KB');
  const drows = manifest.data.map((r) => el('tr', {},
    el('th', { scope: 'row', class: 'l' }, el('a', { href: 'data/' + r.file, download: true }, r.file)),
    el('td', { class: 'l' }, r.description_ro),
    el('td', { class: 'l' }, link(r.licence_url, r.licence)),
    el('td', {}, kb(r.size_bytes)),
    el('td', { class: 'l' }, dateRO(r.generated_at))));
  document.getElementById('table-downloads').append(el('div', { class: 'scroll', role: 'region', tabindex: '0', 'aria-label': 'Fișiere de date și licențe, derulează' },
    el('table', {}, el('caption', {}, 'Fișiere de date, licența noastră pentru fiecare, mărimea și data generării'),
      el('thead', {}, el('tr', {}, th('Fișier', 'l'), th('Conținut', 'l'), th('Licența noastră', 'l'), th('Mărime'), th('Generat la', 'l'))), el('tbody', {}, drows))));


  // "Cel mai apropiat spațiu verde": ODbL notice and method of the three map files (ODbL §4.3, §4.6)
  const codeText = (t) => t.split('`').map((x, i) => (i % 2 ? el('code', {}, x) : x));
  const nrows = manifest.data.filter((r) => r.method && (r.file.startsWith('basemap-bucuresti-') || r.file === 'green_destinations_osm.geojson' || r.file === 'streets_osm.json'));
  const bm = (r) => {
    const m = r.method, dl = el('dl', { class: 'meth' });
    const row = (k, ...v) => dl.append(el('dt', {}, k), el('dd', {}, ...v));
    row('Licență', link(r.licence_url, r.licence), ' (', link('https://www.openstreetmap.org/copyright', '© Contribuitorii OpenStreetMap'), ')');
    if (r.licence_notice_ro) row('Mențiune', linkify(r.licence_notice_ro));
    row('Sursa datelor', link(m.source_url, m.source_url), m.snapshot_date ? ' (instantaneu din ' + dayRO(m.snapshot_date) + ')' : '', '; sha256 al fișierului sursă: ', el('code', {}, m.source_sha256));
    if (m.build_date) row('Construit', 'ziua ' + dayRO(m.build_date) + ' (date OpenStreetMap până la ' + dateRO(m.osm_replication_time) + '); descărcat la ' + dateRO(m.source_retrieved_at) + '; schema ' + m.tile_schema);
    if (m.bbox) row('Zonă și detaliu', 'longitudine ' + m.bbox[0] + ' – ' + m.bbox[2] + ', latitudine ' + m.bbox[1] + ' – ' + m.bbox[3] + '; niveluri de zoom ' + m.minzoom + ' – ' + m.maxzoom);
    if (m.filter_step_ro) row('Ce am scos', ...codeText(m.filter_step_ro));
    row('Cod', el('code', {}, m.filter_code || m.code), m.rules ? ' (regulile sunt în blocul „meta” al fișierului)' : '');
    row('sha256 al fișierului publicat', el('code', {}, r.sha256));
    return el('section', { class: 'meth-item' }, el('h4', {}, r.file), dl);
  };
  const nm = document.getElementById('nearest-methods');
  if (nm) nm.append(...nrows.map(bm));

  document.getElementById('ins-ref').append(insSource(sec.meta));
  fillCoverage([sec.meta, city.meta, osm.meta, cityOsm.meta, defs.meta]);
  fillAttribution([sec.meta, city.meta, osm.meta, cityOsm.meta, cross.meta]);
}
main().catch(showError);
