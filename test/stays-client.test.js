const assert = require('node:assert/strict');
const { StaysClient, StaysError } = require('../src/stays-client');

async function testOfficialSearchUsesBasicAuthAndJson() {
  const calls = [];
  const client = new StaysClient({
    baseUrl: 'https://stays.test/external/v1',
    clientId: 'api-client-id',
    clientSecret: 'secret-value',
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), options });
      return Response.json([{ id: 'LI03J', bookingPrice: { _mctotal: { BRL: 900 } } }]);
    }
  });
  const result = await client.searchListings({ from: '2026-10-06', to: '2026-10-09', persons: 2, limit: 50 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, '/external/v1/booking/search-listings');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, `Basic ${Buffer.from('api-client-id:secret-value').toString('base64')}`);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    from: '2026-10-06', to: '2026-10-09', guests: 2, skip: 0, limit: 20
  });
  assert.equal(result[0].id, 'LI03J');
}

async function testFilterCatalogAndResolution() {
  const calls = [];
  const client = new StaysClient({
    baseUrl: 'https://stays.test/external/v1', clientId: 'id', clientSecret: 'secret',
    fetchImpl: async (url) => {
      calls.push(new URL(url).pathname);
      return Response.json({ amenities: [{ _id: 'pool', _mstitle: { pt_BR: 'Piscina' } }] });
    }
  });
  assert.deepEqual(await client.resolveSearchFilters({ amenities: ['Piscina'] }), { amenities: ['pool'] });
  await client.getSearchFilters();
  assert.equal(calls.filter((path) => path.endsWith('/booking/searchfilter')).length, 1);
}

async function testUnknownFilterReturnsCappedCatalogOptionsWithoutFuzzyMatch() {
  const amenities = Array.from({ length: 30 }, (_, index) => ({
    _id: `amenity-${index + 1}`,
    _mstitle: { pt_BR: `Comodidade ${index + 1}` }
  }));
  const client = new StaysClient({
    baseUrl: 'https://stays.test/external/v1', clientId: 'id', clientSecret: 'secret',
    fetchImpl: async () => Response.json({ amenities })
  });
  await assert.rejects(client.resolveSearchFilters({ amenities: ['pet'] }), (error) => {
    assert.ok(error instanceof StaysError);
    assert.equal(error.code, 'STAYS_FILTER_NOT_FOUND');
    assert.equal(error.filterGroup, 'amenities');
    assert.equal(error.unknownValue, 'pet');
    assert.equal(error.availableOptionCount, 30);
    assert.equal(error.availableOptions.length, 25);
    assert.equal(error.availableOptions[0].nome, 'Comodidade 1');
    assert.equal(error.optionsTruncated, true);
    return true;
  });
}

async function testUnauthorizedErrorDoesNotLeakCredentials() {
  const client = new StaysClient({
    baseUrl: 'https://stays.test/external/v1', clientId: 'private-id', clientSecret: 'private-secret',
    fetchImpl: async () => new Response('', { status: 401 })
  });
  await assert.rejects(client.getSearchFilters(), (error) => {
    assert.ok(error instanceof StaysError);
    assert.equal(error.code, 'STAYS_UNAUTHORIZED');
    assert.doesNotMatch(error.message, /private-id|private-secret/);
    return true;
  });
}

async function testReadOnlyReservationEndpoints() {
  const calls = [];
  const client = new StaysClient({
    baseUrl: 'https://stays.test/external/v1', clientId: 'id', clientSecret: 'secret',
    fetchImpl: async (url, options) => {
      calls.push({ path: new URL(url).pathname, method: options.method });
      return Response.json([]);
    }
  });
  await client.getReservation('partner/code');
  await client.getReservationPayments('partner/code');
  assert.deepEqual(calls, [
    { path: '/external/v1/booking/reservations/partner%2Fcode', method: 'GET' },
    { path: '/external/v1/booking/reservations/partner%2Fcode/payments', method: 'GET' }
  ]);
}

async function testPropertyDetailTimeoutOverride() {
  const client = new StaysClient({
    baseUrl: 'https://stays.test/external/v1', clientId: 'id', clientSecret: 'secret', timeoutMs: 1000,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    })
  });
  await assert.rejects(client.getProperty('property-1', { timeoutMs: 20 }), (error) => error.code === 'STAYS_TIMEOUT');
}

async function main() {
  await testOfficialSearchUsesBasicAuthAndJson();
  await testFilterCatalogAndResolution();
  await testUnknownFilterReturnsCappedCatalogOptionsWithoutFuzzyMatch();
  await testUnauthorizedErrorDoesNotLeakCredentials();
  await testReadOnlyReservationEndpoints();
  await testPropertyDetailTimeoutOverride();
  console.log('stays-client: all tests passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
