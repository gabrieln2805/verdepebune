// Pure functions for "Cel mai apropiat spațiu verde": street search keys, point-in-polygon, distance to
// polygon edge and deterministic ranking. No DOM, no network, no storage: usable in the browser and in Node tests.
// Contract: docs/contracts/verde-pe-bune.md (v0.7), sections "Distance and ranking" and "Normalisation street_key".

// Exactly as in the contract (Python: geo/verde_pe_bune/streets.py).
export const streetKey = (s) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Query expansions from the contract (frontend only, not part of the key).
const EXPAND = { str: 'strada', bd: 'bulevardul', bdul: 'bulevardul', blvd: 'bulevardul', sos: 'soseaua', cal: 'calea', al: 'aleea', int: 'intrarea', spl: 'splaiul', pta: 'piata' };

// rows: array of {name, key, sector_siruta, lon, lat, bbox, osm_way_id, tokens}. Returns up to `limit` matches.
export function indexStreets(data, fields) {
  const ix = Object.fromEntries(fields.map((f, i) => [f, i]));
  return data.map((r) => ({
    name: r[ix.name], key: r[ix.key], sector_siruta: r[ix.sector_siruta], lon: r[ix.lon], lat: r[ix.lat],
    bbox: r[ix.bbox], osm_way_id: r[ix.osm_way_id], tokens: r[ix.key].split(' '),
  }));
}
export function searchStreets(rows, query, limit = 8) {
  const q = streetKey(query);
  if (q.length < 2) return [];
  const qt = q.split(' ');
  const hits = [];
  for (const r of rows) {
    const ok = qt.every((t) => r.tokens.some((k) => k.startsWith(t)) || (EXPAND[t] && r.tokens.some((k) => k.startsWith(EXPAND[t]))));
    if (!ok) continue;
    const rank = r.key === q ? 0 : r.key.startsWith(q) ? 1 : 2;
    hits.push({ r, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || a.r.key.length - b.r.key.length || a.r.name.localeCompare(b.r.name, 'ro') || a.r.sector_siruta - b.r.sector_siruta);
  return hits.slice(0, limit).map((h) => h.r);
}

// ---- geometry (local equirectangular projection around the chosen point, metres) ----
const R = 6371008.8;
const RAD = Math.PI / 180;

function projector(lon0, lat0) {
  const kx = R * RAD * Math.cos(lat0 * RAD), ky = R * RAD;
  return { kx, ky, x: (lon) => (lon - lon0) * kx, y: (lat) => (lat - lat0) * ky };
}

function ringInside(ring, px, py, P) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = P.x(ring[i][0]), yi = P.y(ring[i][1]), xj = P.x(ring[j][0]), yj = P.y(ring[j][1]);
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Polygons of a GeoJSON geometry as an array of polygons (each: array of rings, first = outer).
const polygonsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

// Is the point inside the geometry (outer ring yes, holes no)? Plain lon/lat test, used for sectors and for distance 0.
export function pointInGeometry(lon, lat, geometry) {
  const P = projector(lon, lat);
  return polygonsOf(geometry).some((poly) => ringInside(poly[0], 0, 0, P) && !poly.slice(1).some((h) => ringInside(h, 0, 0, P)));
}

// Distance in metres from (lon, lat) to the nearest edge of the geometry, 0 if the point is inside.
// Returns {distance, inside, nearest: [lon, lat]} where nearest is the closest point on an edge.
export function distanceToGeometry(lon, lat, geometry) {
  const P = projector(lon, lat);
  let best = Infinity, bx = 0, by = 0;
  const polys = polygonsOf(geometry);
  let inside = false;
  for (const poly of polys) {
    if (ringInside(poly[0], 0, 0, P) && !poly.slice(1).some((h) => ringInside(h, 0, 0, P))) inside = true;
    for (const ring of poly) {
      for (let i = 0, n = ring.length - 1; i < n; i++) {
        const ax = P.x(ring[i][0]), ay = P.y(ring[i][1]), cx = P.x(ring[i + 1][0]), cy = P.y(ring[i + 1][1]);
        const dx = cx - ax, dy = cy - ay, l2 = dx * dx + dy * dy;
        let t = l2 === 0 ? 0 : -(ax * dx + ay * dy) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + t * dx, qy = ay + t * dy, d2 = qx * qx + qy * qy;
        if (d2 < best) { best = d2; bx = qx; by = qy; }
      }
    }
  }
  const nearest = [lon + bx / P.kx, lat + by / P.ky];
  return inside ? { distance: 0, inside: true, nearest: [lon, lat] } : { distance: Math.sqrt(best), inside: false, nearest };
}

// Rank features (GeoJSON features with properties.type, osm_type, osm_id) by distance; ties by osm_type, osm_id.
// `types` is the set (array) of enabled types. Returns the first `n` as {feature, distance, inside, nearest}.
export function nearestGreen(lon, lat, features, types, n = 3) {
  const on = new Set(types);
  const out = [];
  for (const f of features) {
    if (!on.has(f.properties.type)) continue;
    out.push({ feature: f, ...distanceToGeometry(lon, lat, f.geometry) });
  }
  out.sort((a, b) => a.distance - b.distance
    || (a.feature.properties.osm_type < b.feature.properties.osm_type ? -1 : a.feature.properties.osm_type > b.feature.properties.osm_type ? 1 : 0)
    || a.feature.properties.osm_id - b.feature.properties.osm_id);
  return out.slice(0, n);
}

// Round to 10 m (50 m above 1 km), as in the contract.
export function roundDistance(m) {
  return m > 1000 ? Math.round(m / 50) * 50 : Math.round(m / 10) * 10;
}
