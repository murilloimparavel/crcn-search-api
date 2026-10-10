const assert = require('node:assert/strict');
const { ImobClient, ImobError, formatImobDate, normalizePropertyName, extractPixPrice } = require('../src/imob-client');

async function testRequestContractAndAuthentication() {
  let call;
  const client = new ImobClient({
    baseUrl: 'https://imob.test/crcn',
    authorization: 'Basic test-secret',
    fetchImpl: async (url, options) => {
      call = { url: new URL(url), options };
      return Response.json([{ id: 19, condominio: 135, nomeCond: 'Lagoa Quente Flat Service' }]);
    }
  });
  const records = await client.search({ from: '2026-10-16', to: '2026-10-19', persons: 8, onePerCondominium: true });
  assert.equal(call.url.pathname, '/crcn/listOrcamento');
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.headers.Authorization, 'Basic test-secret');
  assert.deepEqual(JSON.parse(call.options.body), {
    rede: true,
    entrada: '2026-10-16',
    saida: '2026-10-19',
    condominio: null,
    qtdeqrts: 'all',
    maxOcupantes: '8',
    maxPax: false,
    addCrianca: false,
    umCada: true,
    entradaAntecipada: 'all',
    saidaProrrogada: 'all',
    piscina24h: false,
    bebidas: false
  });
  assert.equal(records[0].nomeCond, 'Lagoa Quente Flat Service');
  assert.equal(formatImobDate('2026-10-16'), '2026-10-16');
  assert.equal(normalizePropertyName('Lagoa Quente Flat Service'), 'lagoa quente flat service');
}

async function testPropertyNameResolvesProviderIdThenSearchesScoped() {
  const calls = [];
  const client = new ImobClient({
    baseUrl: 'https://imob.test/crcn', authorization: 'Basic test',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body.condominio);
      if (body.condominio === null) {
        return Response.json({ opcoes: [
          { id: 1, condominio: 135, nomeCond: 'Lagoa Quente Flat Service' },
          { id: 2, condominio: 200, nomeCond: 'Everest Flat Service' }
        ] });
      }
      return Response.json([{ id: 3, condominio: body.condominio, nomeCond: 'Lagoa Quente Flat Service' }]);
    }
  });
  const records = await client.searchForProperty({
    from: '2026-10-16', to: '2026-10-18', persons: 4,
    propertyName: 'LAGOA QUENTE'
  });
  assert.deepEqual(calls, [null, '135']);
  assert.equal(records.length, 1);
  assert.equal(records[0].id, 3);
}

async function testNumericCondominiumIdIsPassedDirectly() {
  let body;
  const client = new ImobClient({
    authorization: 'Basic test',
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return Response.json([]);
    }
  });
  await client.searchForProperty({
    from: '2026-10-16', to: '2026-10-18', persons: 4,
    propertyName: '135'
  });
  assert.equal(body.condominio, '135');
}

async function testMissingConfigurationAndNoAvailability() {
  const notConfigured = new ImobClient({ authorization: '', fetchImpl: async () => { throw new Error('should not call'); } });
  assert.deepEqual(await notConfigured.search({ from: '2026-10-16', to: '2026-10-18', persons: 2 }), []);
  const noAvailability = new ImobClient({
    authorization: 'Basic test',
    fetchImpl: async () => Response.json({ erro: 'Nenhum imóvel próprio disponível.' })
  });
  assert.deepEqual(await noAvailability.search({ from: '2026-10-16', to: '2026-10-18', persons: 2 }), []);
  const unrecognized = new ImobClient({ authorization: 'Basic test', fetchImpl: async () => Response.json({ status: 'ok', message: 'consulta processada' }) });
  await assert.rejects(
    () => unrecognized.search({ from: '2026-10-16', to: '2026-10-18', persons: 2 }),
    (error) => error instanceof ImobError && error.code === 'IMOB_INVALID_RESPONSE'
  );
  const recognizedEmpty = new ImobClient({ authorization: 'Basic test', fetchImpl: async () => Response.json({ opcoes: [] }) });
  assert.deepEqual(await recognizedEmpty.search({ from: '2026-10-16', to: '2026-10-18', persons: 2 }), []);
}

async function testReadOnlyQuoteRequestParsesPixPrice() {
  let call;
  const client = new ImobClient({
    authorization: 'Basic test',
    publicBaseUrl: 'https://public.test',
    fetchImpl: async (url, options) => {
      call = { url: new URL(url), options };
      return new Response('<script>var data = {"formReserva-totalDinheiro": "1130","formReserva-totalCartao":"1449"};</script>');
    }
  });
  const amount = await client.getPixPrice({ listingId: 1086, from: '2026-10-16', to: '2026-10-19', persons: 8 });
  assert.equal(call.url.href, 'https://public.test/');
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.headers['Content-Type'], 'application/x-www-form-urlencoded; charset=UTF-8');
  const form = new URLSearchParams(call.options.body);
  assert.equal(form.get('Controller'), 'parceiro');
  assert.equal(form.get('periodo'), '2026-10-16,2026-10-19');
  assert.equal(form.get('ImovRef'), '1086');
  assert.equal(form.get('s1'), '8');
  assert.equal(call.options.headers.Authorization, undefined);
  assert.equal(amount, 1130);
  assert.equal(extractPixPrice('<p>sem preço</p>'), null);
}

async function main() {
  await testRequestContractAndAuthentication();
  await testPropertyNameResolvesProviderIdThenSearchesScoped();
  await testNumericCondominiumIdIsPassedDirectly();
  await testMissingConfigurationAndNoAvailability();
  await testReadOnlyQuoteRequestParsesPixPrice();
  console.log('imob-client: all tests passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
