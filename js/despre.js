import { load, dayRO, fill, fillCoverage, showError } from './common.js';

// The contact address is assembled here from parts, so it never appears as a plain string in the page source.
const user = ['gabriel', 'nastase', '2805'].join('');
const host = ['gmail', 'com'].join('.');
const mail = document.getElementById('mail');
if (mail) mail.href = 'mailto:' + user + String.fromCharCode(64) + host;

async function main() {
  const [city, osm] = await Promise.all([load('city_canopy.json'), load('sectors_public_green_osm.json')]);
  const y = city.data.map((r) => r.year);
  fill({ canopy_range: y[0] + '–' + y[y.length - 1], pop_year: city.meta.data_as_of.population, osm_date: dayRO(osm.meta.data_as_of.osm_snapshot) });
  fillCoverage([city.meta, osm.meta]);
}
main().catch(showError);
