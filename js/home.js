import { load, dec, dayRO, fill, dateRO, el, link, sourceLine, fillCoverage, fillAttribution, showError, osmCredit } from './common.js';

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('script ' + src));
    document.head.append(s);
  });
}
// Plot labels inner <g> groups with aria-label; the wrapper already has role=img, so strip them.
const clean = (svg) => { svg.querySelectorAll('g[aria-label]').forEach((g) => g.removeAttribute('aria-label')); svg.removeAttribute('aria-label'); svg.setAttribute('aria-hidden', 'true'); return svg; };
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

async function main() {
  const [sec, city, osm, cityOsm] = await Promise.all([
    load('sectors_canopy.geojson'), load('city_canopy.json'), load('sectors_public_green_osm.json'), load('city_public_green_osm.json'),
  ]);
  const co = cityOsm.data;
  const feats = sec.data.features.map((f) => f.properties).sort((a, b) => a.sector_no - b.sector_no);
  const years = city.data.map((r) => r.year);
  const last = city.data[city.data.length - 1];
  const first = city.data[0];

  const yFrom = feats[0].canopy_change.year_from, yTo = feats[0].canopy_change.year_to;
  fill({ canopy_range: years[0] + '–' + years[years.length - 1], pop_year: sec.meta.data_as_of.population,
    bounds: sec.meta.data_as_of.boundaries, osm_date: dayRO(osm.meta.data_as_of.osm_snapshot), y_from: yFrom, y_to: yTo });

  // data-as-of block
  const asof = document.getElementById('asof');
  asof.replaceChildren(
    ...[
      ['Coronament arbori', years[0] + '–' + years[years.length - 1] + ' (Copernicus VLCC)'],
      ['Populație', 'recensământul 2021 (grila Eurostat)'],
      ['Verde public cartografiat', 'OpenStreetMap, instantaneu ' + osm.meta.data_as_of.osm_snapshot],
      ['Limitele sectoarelor', 'ANCPI, ' + sec.meta.data_as_of.boundaries],
      ['Date generate la', dateRO(sec.meta.generated_at)],
    ].flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]),
  );

  // three measures
  const cards = document.getElementById('cards');
  cards.append(
    el('article', { class: 'card' },
      el('h3', {}, 'Coronament arbori'),
      el('p', { class: 'tag' }, 'Copernicus VLCC, ' + last.year),
      el('p', { class: 'big' }, dec(last.canopy_m2 / 1e6, 1) + ' milioane m²'),
      el('p', {}, dec(last.canopy_share_pct, 2) + ' % din suprafața orașului; ' + dec(last.canopy_m2_per_person, 1) + ' m² pe locuitor (populația 2021).'),
      el('p', {}, 'Include grădini și curți private. Din satelit se văd puțini dintre arborii de pe străzi și din curți.'),
      el('p', { class: 'src' }, 'Sursă: ', link(sec.meta.sources[last.sources[0]].url, 'Copernicus CLMS HRL VLCC ' + last.year), ' și altele, vezi ', link('#src-short', 'sursele de mai jos'), '.')),
    el('article', { class: 'card' },
      el('h3', {}, 'Verde public cartografiat'),
      el('p', { class: 'tag' }, 'OpenStreetMap, ' + osm.meta.data_as_of.osm_snapshot),
      el('p', { class: 'big' }, dec(co.public_green_osm_m2_per_person, 2) + ' m² pe locuitor'),
      el('p', {}, dec(co.public_green_osm_m2 / 1e6, 2) + ' km² cartografiați, adică ' + dec(co.public_green_osm_share_pct, 1) + ' % din suprafața ' + co.name + 'ului. Populația este din ' + cityOsm.meta.data_as_of.population + ', harta din ' + dayRO(cityOsm.meta.data_as_of.osm_snapshot) + '.'),
      el('p', {}, 'Parcuri, grădini publice, locuri de joacă. Fără păduri (de exemplu Băneasa), fără locurile marcate cu acces privat și fără grădinile marcate ca de bloc sau private; grădinile de bloc fără această etichetă pot fi incluse. Incomplet: depinde de ce au cartografiat voluntarii.'),
      el('p', { class: 'src' }, 'Sursă: ', link(cityOsm.meta.sources.osm_geofabrik.url, cityOsm.meta.sources.osm_geofabrik.title), '; populație: ', link(cityOsm.meta.sources.census_grid_2021.url, cityOsm.meta.sources.census_grid_2021.title), '; limitele sectoarelor: ', link(cityOsm.meta.sources.ancpi_uat.url, cityOsm.meta.sources.ancpi_uat.title), '. Licență: ', link(cityOsm.meta.licence_url, cityOsm.meta.licence), '.'),
      osmCredit(cityOsm.meta)),
    el('article', { class: 'card na' },
      el('h3', {}, 'Toată vegetația'),
      el('p', { class: 'tag' }, 'încă indisponibilă'),
      el('p', { class: 'big' }, '–'),
      el('p', {}, 'Această măsură (tot ce e verde în imaginile de vară, inclusiv iarbă și culturi) nu este încă calculată. O vom adăuga într-o versiune viitoare.')),
  );

  // short summary
  const lastYear = last.year;
  const short = document.getElementById('short');
  short.append(
    el('li', {}, 'Coronamentul arborilor acoperă ', el('strong', {}, dec(last.canopy_share_pct, 1) + ' % din suprafața orașului'), ' în ' + lastYear + ', adică ', el('strong', {}, dec(last.canopy_m2_per_person, 1) + ' m² pe locuitor'), ' (populația 2021). Include grădini și curți private.'),
    el('li', {}, 'Spațiile verzi publice cartografiate în OpenStreetMap sunt ', el('strong', {}, dec(co.public_green_osm_m2_per_person, 1) + ' m² pe locuitor'), ' (instantaneu din ' + dayRO(cityOsm.meta.data_as_of.osm_snapshot) + '). Harta este incompletă și nu include păduri.'));
  document.getElementById('change-text').append(
    'Între ' + first.year + ' și ' + last.year + ', coronamentul modelat al orașului a trecut de la ' + dec(first.canopy_m2 / 1e6, 1) + ' la ' + dec(last.canopy_m2 / 1e6, 1) + ' milioane m² (' + dec(first.canopy_share_pct, 1) + ' % și ' + dec(last.canopy_share_pct, 1) + ' % din suprafața orașului). Valorile sunt modelate din satelit; o diferență mică poate fi zgomot al modelului, iar cifrele nu arată de ce s-a schimbat coronamentul.');
  document.getElementById('src-short').append(
    sourceLine(city.meta, [first, last].flatMap((r) => r.sources), 'Surse coronament ' + first.year + ' și ' + last.year),
    sourceLine(cityOsm.meta, ['osm_geofabrik', 'census_grid_2021', 'ancpi_uat'], 'Surse verde public cartografiat și populație'),
    osmCredit(cityOsm.meta));

  // one simple sector chart + text alternative
  const vals = feats.map((p) => ({ name: p.name, v: p.canopy.find((c) => c.year === lastYear).canopy_share_pct }));
  document.getElementById('chart-sectors-cap').append('Coronamentul arborilor în ' + lastYear + ', ca procent din suprafața fiecărui sector (Copernicus CLMS, VLCC). Include grădini și curți private.');
  document.getElementById('chart-sectors-alt').append('Valorile din grafic: ' + vals.map((d) => d.name + ' ' + dec(d.v, 1) + ' %').join('; ') + '. ',
    sourceLine(sec.meta, feats.flatMap((p) => p.canopy.find((c) => c.year === lastYear).sources).concat(['ancpi_uat']), 'Surse'));

  fillCoverage([sec.meta, city.meta, osm.meta, cityOsm.meta]);
  fillAttribution([sec.meta, city.meta, osm.meta, cityOsm.meta]);

  try {
    await loadScript('vendor/d3.min.js');
    await loadScript('vendor/plot.umd.min.js');
    const Plot = window.Plot;
    const max = Math.max(...vals.map((d) => d.v));
    document.getElementById('chart-sectors').replaceChildren(clean(Plot.plot({
      width: 640, height: 260, marginLeft: 90, marginRight: 50, marginBottom: 50,
      style: { background: 'transparent', color: css('--text'), fontFamily: css('--font-body'), fontSize: '14px' },
      x: { label: '% din suprafața sectorului, ' + lastYear + ' →', domain: [0, max * 1.15], grid: true },
      y: { label: null },
      marks: [Plot.barX(vals, { y: 'name', x: 'v', fill: css('--c1') }), Plot.text(vals, { y: 'name', x: 'v', text: (d) => dec(d.v, 1), dx: 4, textAnchor: 'start', fill: css('--text') }), Plot.ruleX([0])],
    })));
  } catch (e) {
    console.error(e);
    document.getElementById('chart-sectors').textContent = 'Graficul nu s-a putut încărca; valorile sunt scrise sub el.';
  }
}
main().catch(showError);
