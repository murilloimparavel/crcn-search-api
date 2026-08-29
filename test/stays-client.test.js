const assert = require('assert/strict');
const { StaysClient, parsePublicUid } = require('../src/stays-client');
const { processAndRankResults } = require('../src/normalizer');

const html = "<script>window._user:{_id:'public-uid'}</script>";
const apartments = [
  { _id: 'apt-expensive', _t_mstitle: { pt_BR: 'Residencial Azul - 301' }, _i_maxPers: 4, _i_rooms: 2, _f_bathrooms: 1, _adr: { city: 'Caldas Novas' } },
  { _id: 'apt-cheap', _t_mstitle: { pt_BR: 'Residencial Verde - 101' }, _i_maxPers: 2, _i_rooms: 1, _f_bathrooms: 1, _adr: { city: 'Caldas Novas' }, _mssummary: { pt_BR: '<p>Piscina e sauna.</p>' } }
];

async function testSearchAndOfficialPrices() {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    calls.push({ url: parsed.toString(), options });
    if (parsed.pathname === '/pt/search' && parsed.searchParams.get('formaps') !== '1') {
      return new Response(html, { headers: { 'set-cookie': 'hdbid_sn_crcn=test-session; Path=/; HttpOnly' } });
    }
    if (parsed.pathname === '/pt/search') return Response.json({ apartments });
    if (parsed.pathname === '/jsonrpc') {
      const payload = JSON.parse(options.body);
      assert.equal(payload.uid, 'public-uid');
      assert.equal(payload.method, 'helpers._correctApartPrice');
      assert.equal(payload.params[4].persons, 2);
      const id = payload.params[1]._id;
      const price = id === 'apt-cheap' ? { diaria: 210, total: 420 } : { diaria: 350, total: 700 };
      return Response.json({ result: [{ _id: id, _mcprice: { BRL: price.diaria }, _t_mctotal: { BRL: price.total } }] });
    }
    throw new Error(`URL inesperada: ${parsed}`);
  };

  const client = new StaysClient({ fetchImpl, baseUrl: 'https://stays.test', priceConcurrency: 1 });
  const results = await client.search({ from: '2026-09-10', to: '2026-09-12', persons: 2, limit: 2 });
  assert.equal(results.length, 2);
  assert.deepEqual(results[1].price, { valor_diaria: 210, valor_total: 420 });
  assert.equal(calls.filter((call) => new URL(call.url).pathname === '/jsonrpc').length, 2);

  const options = processAndRankResults(results, { from: '2026-09-10', to: '2026-09-12', persons: 2 });
  assert.equal(options[0].id, 'apt-cheap');
  assert.equal(options[0].valor_total, 420);
  assert.equal(options[0].diferenciais, 'Piscina e sauna.');
  assert.match(options[0].link_reserva, /from=2026-09-10/);
}

async function testSessionRetry() {
  let sessions = 0;
  let searchAttempts = 0;
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/pt/search' && parsed.searchParams.get('formaps') !== '1') {
      sessions += 1;
      return new Response(html, { headers: { 'set-cookie': `hdbid=session-${sessions}; Path=/` } });
    }
    if (parsed.pathname === '/pt/search') {
      searchAttempts += 1;
      if (searchAttempts === 1) return new Response('', { status: 401 });
      return Response.json({ apartments: [] });
    }
    throw new Error(`URL inesperada: ${parsed} ${options.method || 'GET'}`);
  };
  const client = new StaysClient({ fetchImpl, baseUrl: 'https://stays.test' });
  const results = await client.search({ from: '2026-09-10', to: '2026-09-12', persons: 2, limit: 2 });
  assert.deepEqual(results, []);
  assert.equal(sessions, 2);
  assert.equal(searchAttempts, 2);
}

assert.equal(parsePublicUid(html), 'public-uid');
testSearchAndOfficialPrices()
  .then(testSessionRetry)
  .then(() => console.log('stays-client: all tests passed'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
