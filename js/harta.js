import { load, int, dec, dayRO, fill, el, link, sourceLine, fillCoverage, fillAttribution, showError, announce, osmCredit } from './common.js';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const BREAKS = [0, 2, 5, 10, 15, 20]; // % of the (in-city) cell area
const RAMPS = {
  canopy: ['#f1f7ee', '#cfe6c4', '#9ccf8c', '#5fae5a', '#2e8a43', '#0f5d2c'],
  osm: ['#eff6fa', '#cde4ef', '#9acbe0', '#5ba8c9', '#2a7fa8', '#0d5278'],
};
const BREAK_LABELS = ['0 – 2 %', '2 – 5 %', '5 – 10 %', '10 – 15 %', '15 – 20 %', '20 % sau mai mult'];
// first class is "< 2" including zero
const cellLabel = (id) => {
  const m = /N(\d+)E(\d+)$/.exec(id);
  return m ? 'N ' + m[1].slice(0, -3) + ' / E ' + m[2].slice(0, -3) + ' km' : id;
};

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('script ' + src));
    document.head.append(s);
  });
}

async function main() {
  const [cells, secs, osmCells] = await Promise.all([
    load('cells_canopy.geojson'), load('sectors_canopy.geojson'), load('cells_public_green_osm.json'),
  ]);
  const osmBy = new Map(osmCells.data.map((r) => [r.grd_id, r]));
  const secNo = new Map(secs.data.features.map((f) => [f.properties.siruta, f.properties.sector_no]));
  const years = secs.data.features[0].properties.canopy.map((c) => c.year);
  const lastYear = years[years.length - 1];

  const yearSel = document.getElementById('year');
  for (const y of [...years].reverse()) yearSel.append(el('option', { value: y }, String(y)));
  yearSel.value = String(lastYear);
  const layerOf = () => document.querySelector('input[name=layer]:checked').value;

  // flatten values to simple properties for styling
  for (const f of cells.data.features) {
    const p = f.properties, o = osmBy.get(p.grd_id);
    for (const y of years) p['c' + y] = p.canopy_share_pct[String(y)];
    p.osm = o ? o.public_green_osm_share_pct : null;
  }

  const sectorsOf = (p) => p.sector_sirutas.map((s) => secNo.get(s)).sort().join(', ');
  const srcBox = document.getElementById('src-map');
  function renderSources() {
    const y = Number(yearSel.value);
    const ids = secs.data.features.flatMap((f) => f.properties.canopy.filter((c) => c.year === y).flatMap((c) => c.sources));
    srcBox.replaceChildren(sourceLine(secs.meta, ids.concat(['census_grid_2021', 'ancpi_uat']), 'Surse coronament ' + y + ', populație și limite'),
      sourceLine(osmCells.meta, ['osm_geofabrik', 'census_grid_2021', 'ancpi_uat'], 'Surse verde public cartografiat'));
  }
  renderSources();
  yearSel.addEventListener('change', renderSources);

  const ca = cells.meta.data_as_of;
  fill({ n_cells: int(cells.data.features.length), canopy_range: ca.canopy_years[0] + '–' + ca.canopy_years[1], pop_year: ca.population,
    osm_date: dayRO(osmCells.meta.data_as_of.osm_snapshot), asof_generated: dayRO(cells.meta.generated_at) });
  fillCoverage([cells.meta, osmCells.meta]);
  fillAttribution([cells.meta, osmCells.meta]);
  document.getElementById('map-attrib-text').append('Atribuiri pentru straturile din hartă: ',
    link('https://www.openstreetmap.org/copyright', '© Contribuitorii OpenStreetMap'), ' (ODbL) și ANCPI (limitele sectoarelor) pentru stratul „Verde public cartografiat”; Copernicus CLMS, Eurostat și ANCPI pentru coronament, populație și limite, cu textele complete în josul paginii. ',
    link('#atribuiri-harta', 'Vezi atribuirile complete'), '.');

  // legend
  function renderLegend() {
    const l = layerOf();
    const ul = el('ul', { class: 'legend', 'aria-label': 'Legenda hărții' });
    RAMPS[l].forEach((c, i) => ul.append(el('li', {}, el('span', { class: 'sw', style: 'background:' + c, 'aria-hidden': 'true' }), BREAK_LABELS[i])));
    ul.append(el('li', {}, el('span', { class: 'sw', style: 'background:transparent;border:3px solid var(--map-line)', 'aria-hidden': 'true' }), 'limita sectorului'));
    const title = l === 'canopy' ? 'Coronament arbori, ' + yearSel.value + ': ' + cells.meta.units.canopy_share_pct : 'Verde public cartografiat (OSM): ' + osmCells.meta.units.public_green_osm_share_pct;
    document.getElementById('legend').replaceChildren(el('p', {}, el('strong', {}, title)), ul, ...(l === 'osm' ? [osmCredit(osmCells.meta)] : []));
  }
  renderLegend();

  // map (lazy: library is loaded only when this page runs)
  const mapEl = document.getElementById('map');
  try {
    await loadScript('vendor/maplibre-gl.js');
    const ml = window.maplibregl;
    const map = new ml.Map({
      container: mapEl,
      style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': css('--map-bg') } }] },
      bounds: [[25.97, 44.33], [26.23, 44.55]],
      fitBoundsOptions: { padding: 10 }, attributionControl: false, maxZoom: 14, minZoom: 8, cooperativeGestures: false,
      locale: { 'NavigationControl.ZoomIn': 'Mărește harta', 'NavigationControl.ZoomOut': 'Micșorează harta', 'NavigationControl.ResetBearing': 'Orientează spre nord', 'AttributionControl.ToggleAttribution': 'Arată sau ascunde atribuirile', 'AttributionControl.MapFeedback': 'Feedback hartă' },
    });
    map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new ml.AttributionControl({
      compact: false,
      customAttribution: [
        '<a href="https://www.openstreetmap.org/copyright">© Contribuitorii OpenStreetMap</a> (verde public)',
        'Copernicus CLMS (coronament)', 'Eurostat (populație)', 'ANCPI (limite)',
        '<a href="#atribuiri-harta">atribuiri complete</a>',
      ],
    }));
    const fillExpr = (prop) => {
      const e = ['step', ['coalesce', ['to-number', ['get', prop]], 0], RAMPS[layerOf()][0]];
      for (let i = 1; i < BREAKS.length; i++) e.push(BREAKS[i], RAMPS[layerOf()][i]);
      return e;
    };
    const prop = () => (layerOf() === 'canopy' ? 'c' + yearSel.value : 'osm');
    await new Promise((r) => map.on('load', r));
    map.addSource('cells', { type: 'geojson', data: cells.data, promoteId: 'grd_id' });
    map.addSource('sectors', { type: 'geojson', data: secs.data });
    map.addLayer({ id: 'cells-fill', type: 'fill', source: 'cells', paint: { 'fill-color': fillExpr(prop()), 'fill-opacity': 0.9 } });
    map.addLayer({ id: 'cells-line', type: 'line', source: 'cells', paint: { 'line-color': css('--map-cell'), 'line-width': 0.5 } });
    map.addLayer({ id: 'cell-selected', type: 'line', source: 'cells', paint: { 'line-color': css('--focus'), 'line-width': 3 }, filter: ['==', ['get', 'grd_id'], ''] });
    map.addLayer({ id: 'sectors-line', type: 'line', source: 'sectors', paint: { 'line-color': css('--map-line'), 'line-width': 2.5 } });

    function update() {
      map.setPaintProperty('cells-fill', 'fill-color', fillExpr(prop()));
      renderLegend();
      announce('Harta arată ' + (layerOf() === 'canopy' ? 'coronamentul arborilor, ' + yearSel.value : 'verdele public cartografiat') + '.');
    }
    document.querySelectorAll('input[name=layer]').forEach((r) => r.addEventListener('change', update));
    yearSel.addEventListener('change', update);

    map.on('click', 'cells-fill', (e) => {
      const p = e.features[0].properties;
      const full = cells.data.features.find((f) => f.properties.grd_id === p.grd_id).properties;
      const o = osmBy.get(p.grd_id), y = yearSel.value;
      map.setFilter('cell-selected', ['==', ['get', 'grd_id'], p.grd_id]);
      document.getElementById('cellinfo').replaceChildren(
        el('strong', {}, 'Celula ' + cellLabel(p.grd_id) + ' (sector ' + sectorsOf(full) + ')'),
        el('br'),
        'Suprafață în oraș: ' + int(full.area_in_city_m2) + ' m²; locuitori 2021: ' + int(full.population_2021_in_city) + '.',
        el('br'),
        'Coronament ' + y + ': ' + int(full.canopy_m2[y]) + ' m² (' + dec(full.canopy_share_pct[y], 1) + ' ' + cells.meta.units.canopy_share_pct + '; ' + dec(full.canopy_m2_per_person[y], 1) + ' m²/locuitor). Include grădini și curți private.',
        el('br'),
        'Verde public cartografiat (OSM, incomplet): ' + int(o.public_green_osm_m2) + ' m² (' + dec(o.public_green_osm_share_pct, 1) + ' ' + osmCells.meta.units.public_green_osm_share_pct + '; ' + dec(o.public_green_osm_m2_per_person, 1) + ' m²/locuitor). Limite sectoare: ANCPI, 2020.');
    });
    map.on('mouseenter', 'cells-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'cells-fill', () => { map.getCanvas().style.cursor = ''; });
  } catch (e) {
    console.error(e);
    mapEl.replaceChildren(el('p', { class: 'note' }, 'Harta nu a putut fi afișată pe acest dispozitiv. Folosește tabelul de mai jos.'));
    mapEl.removeAttribute('role');
    mapEl.style.height = 'auto';
  }
}
main().catch(showError);
