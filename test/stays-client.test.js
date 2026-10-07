const assert = require('node:assert/strict');
const { StaysClient, StaysError } = require('../src/stays-client');

async function testOfficialSearchUsesBasicAuthAndJson() {
  const calls = [];
  const client = new StaysClient({
    baseUrl: 'https://stays.test/external/v1',
    login: 'api-user',
    password: 'secret-value',
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), options });
      return Response.json([{ id: 'LI03J', bookingPrice: { _mctotal: { BRL: 900 } } }]);
    }
  });
  const result = await client.searchListings({ from: '2026-10-06', to: '2026-10-09', persons: 2, limit: 50 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, '/external/v1/booking/search-listings');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, `Basic ${Buffer.from('api-user:secret-value').toString('base64')}`);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    from: '2026-10-06', to: '2026-10-09', guests: 2, skip: 0, limit: 20
  });
  assert.equal(result[0].id, 'LI03J');
}

async function testFilterCatalogAndResolution() {
  const calls = [];
  const client = new StaysClient({
    baseUrl: 'https://stays.test/external/v1', login: 'user', password: 'password',
    fetchImpl: async (url) => {
      calls.push(new URL(url).pathname);
      return Response.json({ amenities: [{ _id: 'pool', _mstitle: { pt_BR: 'Piscina' } }] });
    }
  });
  assert.deepEqual(await client.resolveSearchFilters({ amenities: ['Piscina'] }), { amenities: ['pool'] });
  await client.getSearchFilters();
  assert.equal(calls.filter((path) => path.endsWith('/booking/searchfilter')).length, 1);
}

async function testUnauthorizedErrorDoesNotLeakCredentials() {
  const client = new StaysClient({
    baseUrl: 'https://stays.test/external/v1', login: 'private-user', password: 'private-pass',
    fetchImpl: async () => new Response('', { status: 401 })
  });
  await assert.rejects(client.getSearchFilters(), (error) => {
    assert.ok(error instanceof StaysError);
    assert.equal(error.code, 'STAYS_UNAUTHORIZED');
    assert.doesNotMatch(error.message, /private-user|private-pass/);
    return true;
  });
}

async function main() {
  await testOfficialSearchUsesBasicAuthAndJson();
  await testFilterCatalogAndResolution();
  await testUnauthorizedErrorDoesNotLeakCredentials();
  console.log('stays-client: all tests passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
