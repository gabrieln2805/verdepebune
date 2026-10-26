// "Cel mai apropiat spațiu verde": nearest mapped green spaces to a chosen point.
// Privacy (compliance F2): the position, the street query and the clicked point exist only in memory in this
// module. No storage APIs, no URL changes, no network request carries them, nothing is logged to the console.
import { load, el, link, linkify, dayRO, int, fill } from './common.js';
import { indexStreets, searchStreets, pointInGeometry, nearestGreen, roundDistance } from './geo.js';

const $ = (id) => document.getElementById(id);
const ATTRIBUTION = '<a href="https://www.openstreetmap.org/copyright">© Contribuitorii OpenStreetMap</a> (hartă de bază și spații verzi)';
// OSM names sometimes use the cedilla forms (ş ţ); show the correct comma-below letters (display only).
const ro = (s) => s.replace(/ş/g, 'ș').replace(/Ş/g, 'Ș').replace(/ţ/g, 'ț').replace(/Ţ/g, 'Ț');
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const GROUPS = { main: ['park', 'garden'], play: ['playground', 'dog_park'], forest: ['forest'] };
const COLORS = {
  light: { park: '#2e8a43', garden: '#7a9a12', playground: '#8a4fb0', dog_park: '#b0457a', forest: '#0f5d2c', mark: '#b4530a', markText: '#ffffff', point: '#0a5a78', halo: '#ffffff', text: '#2e2319', sector: '#2e2319' },
  dark: { park: '#6fd9a5', garden: '#c6e66a', playground: '#c9a0ff', dog_park: '#ff9ac7', forest: '#2fa56a', mark: '#ffb35c', markText: '#1a140e', point: '#6cc4e0', halo: '#1a140e', text: '#f6e9dc', sector: '#f6e9dc' },
};
const palette = () => (darkQuery.matches ? COLORS.dark : COLORS.light);

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('script ' + src));
    document.head.append(s);
  });
}

async function main() {
  const [dest, sectors, manifest] = await Promise.all([load('green_destinations_osm.geojson'), load('sectors_canopy.geojson'), load('manifest.json')]);
  const feats = dest.data.features;
  const labels = dest.meta.labels_ro;
  const snapshot = dayRO(dest.meta.data_as_of.osm_snapshot);
  const baseRow = manifest.data.find((r) => r.file.startsWith('basemap-bucuresti-'));
  const baseDate = baseRow ? dayRO(baseRow.data_as_of.basemap_osm) : null;
  const sectorNo = new Map(sectors.data.features.map((f) => [f.properties.siruta, f.properties.sector_no]));
  const sectorFeats = sectors.data.features;

  fill({ street_date: 'instantaneu din ' + snapshot });

  // ---- coverage (R6) and attributions, from the data ----
  const cov = $('tool-cov');
  cov.append(el('li', {}, dest.meta.coverage[0]));
  if (dest.meta.coverage[2]) cov.append(el('li', {}, dest.meta.coverage[2]));
  cov.append(el('li', {}, 'Harta de bază (străzi, clădiri, ape): OpenStreetMap' + (baseDate ? ', instantaneu din ' + baseDate : '') + '. Străzile căutate: același instantaneu ca spațiile verzi.'));
  cov.append(el('li', {}, 'Limitele sectoarelor sunt din 2020 (ANCPI), generalizate; în afara lor nu dăm rezultate.'));
  const credit = el('p', { class: 'src' });
  dest.meta.attribution.forEach((a, i) => { if (i) credit.append(' '); credit.append(linkify(a)); });
  credit.append(' Licența datelor: ', link(dest.meta.licence_url, dest.meta.licence), '. Fișierele sunt pe pagina ', link('metoda.html#date', 'Cum am calculat'), '.');
  cov.parentElement.append(credit);

  // ---- state (memory only) ----
  const state = { point: null, how: null, label: null, results: [] };
  const activeTypes = () => [...($('t-main').checked ? GROUPS.main : []), ...($('t-play').checked ? GROUPS.play : []), ...($('t-forest').checked ? GROUPS.forest : [])];
  const status = (msg) => { $('nstatus').textContent = msg; };

  // ---- map ----
  let map = null, mapReady = false;
  const mapErr = (msg) => { const b = $('tool-error'); b.hidden = false; b.textContent = msg; };

  function legend() {
    const c = palette(), act = new Set(activeTypes());
    const ul = $('nlegend');
    ul.replaceChildren(...Object.keys(labels.types).filter((t) => act.has(t)).map((t) =>
      el('li', {}, el('span', { class: 'sw' + (t === 'forest' ? ' dash' : ''), style: 'background:' + c[t] + '66;border-color:' + c[t], 'aria-hidden': 'true' }, ''), labels.types[t][0].toUpperCase() + labels.types[t].slice(1))),
    el('li', {}, el('span', { class: 'sw dot', style: 'background:' + c.point, 'aria-hidden': 'true' }), 'punctul ales'),
    el('li', {}, el('span', { class: 'sw dot num', style: 'background:' + c.mark + ';color:' + c.markText, 'aria-hidden': 'true' }, '1'), 'cel mai apropiat punct de margine, numerotat ca în listă'));
  }

  const typeFilter = () => ['in', ['get', 'type'], ['literal', activeTypes()]];
  const empty = () => ({ type: 'FeatureCollection', features: [] });
  let overlayData = { poly: empty(), pts: empty(), links: empty(), point: empty() };

  function addOverlay() {
    const c = palette(), before = 'water_label_line';
    const typeColor = ['match', ['get', 'type'], 'park', c.park, 'garden', c.garden, 'playground', c.playground, 'dog_park', c.dog_park, c.forest];
    map.addSource('sectors', { type: 'geojson', data: sectors.data });
    map.addSource('dest', { type: 'geojson', data: dest.data });
    map.addSource('res-poly', { type: 'geojson', data: overlayData.poly });
    map.addSource('res-links', { type: 'geojson', data: overlayData.links });
    map.addSource('res-pts', { type: 'geojson', data: overlayData.pts });
    map.addSource('chosen', { type: 'geojson', data: overlayData.point });
    map.addLayer({ id: 'sectors-line', type: 'line', source: 'sectors', paint: { 'line-color': c.sector, 'line-width': 1.2, 'line-opacity': 0.45, 'line-dasharray': [3, 3] } }, before);
    map.addLayer({ id: 'dest-fill', type: 'fill', source: 'dest', filter: typeFilter(), paint: { 'fill-color': typeColor, 'fill-opacity': 0.4 } }, before);
    map.addLayer({ id: 'dest-line', type: 'line', source: 'dest', filter: ['all', typeFilter(), ['!=', ['get', 'type'], 'forest']], paint: { 'line-color': typeColor, 'line-width': 1.5 } }, before);
    map.addLayer({ id: 'dest-line-forest', type: 'line', source: 'dest', filter: ['all', typeFilter(), ['==', ['get', 'type'], 'forest']], paint: { 'line-color': typeColor, 'line-width': 2, 'line-dasharray': [2, 2] } }, before);
    map.addLayer({ id: 'dest-label', type: 'symbol', source: 'dest', minzoom: 13.5, filter: ['all', typeFilter(), ['has', 'name'], ['!=', ['get', 'name'], null]], layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-max-width': 8 }, paint: { 'text-color': c.text, 'text-halo-color': c.halo, 'text-halo-width': 1.5 } });
    map.addLayer({ id: 'res-casing', type: 'line', source: 'res-poly', paint: { 'line-color': c.halo, 'line-width': 8 } });
    map.addLayer({ id: 'res-outline', type: 'line', source: 'res-poly', paint: { 'line-color': c.mark, 'line-width': 4 } });
    map.addLayer({ id: 'res-links', type: 'line', source: 'res-links', paint: { 'line-color': c.mark, 'line-width': 2.5, 'line-dasharray': [2, 2] } });
    map.addLayer({ id: 'res-pts', type: 'circle', source: 'res-pts', paint: { 'circle-radius': 11, 'circle-color': c.mark, 'circle-stroke-color': c.halo, 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'res-nums', type: 'symbol', source: 'res-pts', layout: { 'text-field': ['get', 'rank'], 'text-font': ['Noto Sans Medium'], 'text-size': 13, 'text-allow-overlap': true }, paint: { 'text-color': c.markText } });
    map.addLayer({ id: 'chosen-pt', type: 'circle', source: 'chosen', paint: { 'circle-radius': 9, 'circle-color': c.point, 'circle-stroke-color': c.halo, 'circle-stroke-width': 3 } });
  }
  function setOverlay() {
    if (!mapReady || !map.getSource('res-poly')) return;
    map.getSource('res-poly').setData(overlayData.poly);
    map.getSource('res-links').setData(overlayData.links);
    map.getSource('res-pts').setData(overlayData.pts);
    map.getSource('chosen').setData(overlayData.point);
  }
  function setFilters() {
    if (!mapReady || !map.getLayer('dest-fill')) return;
    map.setFilter('dest-fill', typeFilter());
    map.setFilter('dest-line', ['all', typeFilter(), ['!=', ['get', 'type'], 'forest']]);
    map.setFilter('dest-line-forest', ['all', typeFilter(), ['==', ['get', 'type'], 'forest']]);
    map.setFilter('dest-label', ['all', typeFilter(), ['has', 'name'], ['!=', ['get', 'name'], null]]);
  }

  const styleCache = {};
  async function styleFor(dark) {
    const key = dark ? 'map/style-dark.json' : 'map/style.json';
    if (!styleCache[key]) {
      const st = await (await fetch(key)).json();
      // Web workers cannot resolve page-relative URLs: make them absolute by string concatenation (contract v0.7).
      const base = location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
      st.glyphs = base + st.glyphs;
      for (const s of Object.values(st.sources)) {
        if (s.url && s.url.startsWith('pmtiles://')) s.url = 'pmtiles://' + base + s.url.slice('pmtiles://'.length);
        if (s.attribution) s.attribution = ATTRIBUTION;
      }
      styleCache[key] = st;
    }
    return structuredClone(styleCache[key]);
  }

  async function initMap() {
    await loadScript('vendor/maplibre-gl.js');
    await loadScript('vendor/pmtiles.js');
    const ml = window.maplibregl;
    const protocol = new window.pmtiles.Protocol();
    ml.addProtocol('pmtiles', async (params, abort) => {
      const r = await protocol.tile(params, abort);
      if (params.type === 'json' && r && r.data) r.data.attribution = ATTRIBUTION; // F1: same Romanian string everywhere
      return r;
    });
    map = new ml.Map({
      container: 'nmap', style: await styleFor(darkQuery.matches), bounds: [[25.97, 44.33], [26.23, 44.55]], fitBoundsOptions: { padding: 5 },
      minZoom: 9, maxZoom: 18, maxBounds: [[25.8, 44.2], [26.4, 44.7]], hash: false, attributionControl: false, cooperativeGestures: true, dragRotate: false, touchPitchEnabled: false,
      locale: {
        'NavigationControl.ZoomIn': 'Mărește harta', 'NavigationControl.ZoomOut': 'Micșorează harta', 'AttributionControl.ToggleAttribution': 'Arată sau ascunde atribuirile',
        'CooperativeGesturesHandler.WindowsHelpText': 'Folosește Ctrl + derulare pentru a mări harta', 'CooperativeGesturesHandler.MacHelpText': 'Folosește ⌘ + derulare pentru a mări harta', 'CooperativeGesturesHandler.MobileHelpText': 'Folosește două degete pentru a muta harta',
      },
    });
    map.touchZoomRotate.disableRotation();
    map.getCanvas().setAttribute('aria-label', 'Hartă interactivă: dă clic pe un loc ca să îl alegi; săgețile mută harta, plus și minus o măresc');
    map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new ml.AttributionControl({ compact: false }));
    map.on('style.load', () => { addOverlay(); mapReady = true; });
    let warned = false;
    map.on('error', () => { if (!warned) { warned = true; mapErr('Harta de bază nu s-a încărcat complet. Căutarea și lista de rezultate funcționează și fără ea.'); } });
    map.on('click', (e) => choose(e.lngLat.lng, e.lngLat.lat, 'map', null));
    map.getCanvas().style.cursor = 'crosshair';
    darkQuery.addEventListener('change', async () => { mapReady = false; map.setStyle(await styleFor(darkQuery.matches)); legend(); });
    window.__nmap = map; // handle for automated checks only (no data)
  }

  // ---- choose a point and compute (R4: deterministic, in the browser) ----
  const fmtDistance = (r) => {
    if (r.inside) return 'Punctul ales este în interiorul acestui spațiu verde (după hartă).';
    if (r.distance < 5) return 'Distanță: la mai puțin de 10 m în linie dreaptă, până la marginea spațiului verde.';
    return 'Distanță: la ~' + int(roundDistance(r.distance)) + ' m în linie dreaptă, până la marginea spațiului verde.';
  };
  const typeText = (t) => 'tip pe hartă: ' + (t === 'forest' ? labels.forest_note : labels.types[t]);

  function choose(lon, lat, how, label) {
    state.point = [lon, lat]; state.how = how; state.label = label;
    render(true);
  }

  function render(fit) {
    if (!state.point) return;
    const [lon, lat] = state.point;
    const box = $('nresults'), list = $('res-list');
    overlayData = { poly: empty(), pts: empty(), links: empty(), point: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon, lat] } }] } };
    const done = () => { setOverlay(); };
    if (!sectorFeats.some((f) => pointInGeometry(lon, lat, f.geometry))) {
      box.hidden = true; list.replaceChildren();
      status('Avem date doar pentru Municipiul București.');
      done();
      return;
    }
    const types = activeTypes();
    if (!types.length) {
      box.hidden = true; list.replaceChildren();
      status('Bifează cel puțin un tip de loc, ca să vedem ce este aproape.');
      done();
      return;
    }
    const res = nearestGreen(lon, lat, feats, types, 3);
    state.results = res;
    $('res-for').replaceChildren(...({
      geo: ['Rezultate pentru locația ta (folosită doar în acest browser).'],
      map: ['Rezultate pentru punctul ales pe hartă.'],
      street: ['Rezultate pentru ', el('strong', {}, state.label), ': poziția aproximativă a străzii (nu o adresă).'],
    }[state.how]));
    list.replaceChildren(...res.map((r) => {
      const p = r.feature.properties;
      return el('li', { class: 'result' },
        el('h4', {}, p.name ? ro(p.name) : labels.unnamed),
        el('p', { class: 'meta' }, typeText(p.type)),
        el('p', { class: 'dist' }, fmtDistance(r)),
        el('p', { class: 'src' }, osmLink(p), ' · date OpenStreetMap din ' + snapshot));
    }));
    box.hidden = false;
    const first = res[0];
    const fp = first.feature.properties;
    status('Am găsit ' + res.length + ' spații verzi. Cel mai apropiat: ' + (fp.name ? ro(fp.name) : labels.unnamed.toLowerCase()) + ', ' + (first.inside ? 'punctul ales este în interiorul lui (după hartă).' : (first.distance < 5 ? 'la mai puțin de 10 m' : 'la ~' + int(roundDistance(first.distance)) + ' m') + ' în linie dreaptă.'));
    overlayData.poly = { type: 'FeatureCollection', features: res.map((r) => ({ type: 'Feature', properties: {}, geometry: r.feature.geometry })) };
    overlayData.pts = { type: 'FeatureCollection', features: res.map((r, i) => ({ type: 'Feature', properties: { rank: String(i + 1) }, geometry: { type: 'Point', coordinates: r.nearest } })) };
    overlayData.links = { type: 'FeatureCollection', features: res.filter((r) => !r.inside).map((r) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[lon, lat], r.nearest] } })) };
    done();
    if (fit && mapReady) {
      let w = lon, e = lon, s = lat, n = lat;
      for (const r of res) { w = Math.min(w, r.nearest[0]); e = Math.max(e, r.nearest[0]); s = Math.min(s, r.nearest[1]); n = Math.max(n, r.nearest[1]); }
      map.fitBounds([[w, s], [e, n]], { padding: 70, maxZoom: 16, animate: !reduced() });
    }
  }
  const osmLink = (p) => el('a', { href: 'https://www.openstreetmap.org/' + p.osm_type + '/' + p.osm_id, rel: 'noopener noreferrer' }, 'Vezi în OpenStreetMap');

  // ---- type toggles ----
  for (const id of ['t-main', 't-play', 't-forest']) {
    $(id).disabled = false;
    $(id).addEventListener('change', () => { setFilters(); legend(); render(false); });
  }

  // ---- geolocation: only after the click, one getCurrentPosition, no watch (F2 a, b) ----
  const geoBtn = $('btn-geo');
  if (!('geolocation' in navigator)) {
    geoBtn.hidden = true;
    $('geo-explain').textContent = 'Acest browser nu poate afla locația. Scrie numele unei străzi sau dă clic pe hartă.';
  } else {
    geoBtn.disabled = false;
    geoBtn.addEventListener('click', () => {
      geoBtn.disabled = true;
      status('Se caută locația ta…');
      navigator.geolocation.getCurrentPosition(
        (pos) => { geoBtn.disabled = false; choose(pos.coords.longitude, pos.coords.latitude, 'geo', null); },
        (err) => {
          geoBtn.disabled = false;
          status(err && err.code === 1
            ? 'Nu am primit permisiunea de a folosi locația. Nu e nicio problemă: scrie numele unei străzi sau dă clic pe hartă.'
            : 'Nu am putut afla locația ta. Scrie numele unei străzi sau dă clic pe hartă.');
        },
        { enableHighAccuracy: false, timeout: 20000, maximumAge: 0 },
      );
    });
  }

  // ---- street search: ARIA combobox, index loaded once on first focus, searched in the browser ----
  const input = $('street-q'), listbox = $('street-list'), sst = $('street-status');
  let rows = null, loadingRows = null, items = [], active = -1;
  input.disabled = false;
  const display = (r) => ro(r.name) + ', Sector ' + (sectorNo.get(r.sector_siruta) ?? '?');
  function ensureRows() {
    if (!loadingRows) {
      sst.textContent = 'Se încarcă lista de străzi…';
      loadingRows = load('streets_osm.json').then((j) => {
        rows = indexStreets(j.data, j.meta.fields);
        fill({ street_date: 'instantaneu din ' + dayRO(j.meta.data_as_of.osm_snapshot) });
        sst.textContent = '';
      }).catch(() => { sst.textContent = 'Lista de străzi nu s-a putut încărca. Folosește locația sau harta.'; });
    }
    return loadingRows;
  }
  function closeList() {
    listbox.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1;
  }
  function setActive(i) {
    active = i;
    [...listbox.children].forEach((li, k) => li.setAttribute('aria-selected', k === i ? 'true' : 'false'));
    if (i >= 0) { input.setAttribute('aria-activedescendant', 'so-' + i); listbox.children[i].scrollIntoView({ block: 'nearest' }); } else input.removeAttribute('aria-activedescendant');
  }
  function pick(i) {
    const r = items[i];
    if (!r) return;
    input.value = display(r);
    closeList();
    sst.textContent = '';
    choose(r.lon, r.lat, 'street', display(r));
  }
  async function update() {
    await ensureRows();
    if (!rows) return;
    items = searchStreets(rows, input.value, 8);
    listbox.replaceChildren(...items.map((r, i) => {
      const li = el('li', { role: 'option', id: 'so-' + i, 'aria-selected': 'false' }, el('span', { class: 'o-name' }, display(r)), el('span', { class: 'o-note' }, 'poziția aproximativă a străzii (nu o adresă)'));
      li.addEventListener('mousedown', (e) => e.preventDefault());
      li.addEventListener('click', () => pick(i));
      return li;
    }));
    active = -1; input.removeAttribute('aria-activedescendant');
    const q = input.value.trim();
    if (q.length < 2) { closeList(); sst.textContent = ''; return; }
    if (!items.length) { closeList(); sst.textContent = 'Nu am găsit nicio stradă cu acest nume. Încearcă un nume mai scurt, cu sau fără diacritice, sau dă clic pe hartă.'; return; }
    listbox.hidden = false; input.setAttribute('aria-expanded', 'true');
    sst.textContent = items.length + (items.length === 1 ? ' stradă găsită' : ' străzi găsite') + '. Folosește săgețile sus și jos și Enter.';
  }
  input.addEventListener('focus', () => { ensureRows(); });
  input.addEventListener('input', update);
  input.addEventListener('blur', () => closeList());
  input.addEventListener('keydown', (e) => {
    const open = !listbox.hidden;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open && items.length && input.value.trim().length >= 2) { listbox.hidden = false; input.setAttribute('aria-expanded', 'true'); } if (items.length) setActive((active + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (open && items.length) setActive(active <= 0 ? items.length - 1 : active - 1); }
    else if (e.key === 'Enter') { if (open && items.length) { e.preventDefault(); pick(active >= 0 ? active : 0); } }
    else if (e.key === 'Escape') { if (open) { e.preventDefault(); closeList(); } else if (input.value) { input.value = ''; sst.textContent = ''; } }
  });

  legend();
  initMap().catch(() => mapErr('Harta nu a putut fi afișată pe acest dispozitiv. Căutarea unei străzi, locația și lista de rezultate funcționează și fără ea.'));
}
main().catch(() => {
  const b = $('tool-error');
  b.hidden = false;
  b.textContent = 'Datele pentru acest instrument nu s-au putut încărca. Reîncarcă pagina sau descarcă fișierele de pe pagina „Cum am calculat”, secțiunea „Date deschise”.';
});
