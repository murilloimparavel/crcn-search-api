const assert = require('node:assert/strict');
const net = require('node:net');

const nativeFetch = global.fetch;
const upstreamCalls = [];

function staysListing(id, propertyId, price) {
  return {
    id,
    _idproperty: propertyId,
    bookingPrice: { _mctotal: { BRL: price }, mainCurrency: 'BRL' },
    _i_maxGuests: 4,
    _i_rooms: 1,
    _i_beds: 2
  };
}

const imobRecords = [
  { id: 1086, condominio: 135, nomeCond: 'Golden Dolphin Supreme', unidade: 'B0802', titulo: 'Apartamento B0802', maxOcupantes: 8, linkParceiro: 'https://reservascrcn.com.br/parceiro/1/1086?01-11-2026,03-11-2026?s1,,' },
  { id: 1002, condominio: 136, nomeCond: 'Everest Flat Service', unidade: '00604', titulo: 'Apartamento 00604', maxOcupantes: 4, valorTotal: 442, linkParceiro: 'https://reservascrcn.com.br/parceiro/1/1002?01-11-2026,03-11-2026?s1,,' }
];

global.fetch = async (input, options = {}) => {
  const url = new URL(input);
  upstreamCalls.push({ url, options });
  if (url.hostname === 'stays.test' && url.pathname.endsWith('/booking/searchfilter')) {
    return Response.json({
      amenities: [], inventory: [], properties: [
        { _id: 'STAY-P1', _mstitle: { pt_BR: 'Hotel Stays' } }
      ], cities: [], regions: [], rooms: [], guests: []
    });
  }
  if (url.hostname === 'stays.test' && url.pathname.endsWith('/booking/search-listings')) {
    const body = JSON.parse(options.body || '{}');
    const count = body.guests === 5 ? 3 : 1;
    return Response.json(Array.from({ length: count }, (_, i) => staysListing(`STAY-${body.guests}-${i}`, `P-${i}`, 500 + i * 100)));
  }
  if (url.hostname === 'stays.test' && url.pathname.includes('/content/listings/')) {
    const id = decodeURIComponent(url.pathname.split('/').pop());
    const index = Number(id.slice(-1)) || 0;
    return Response.json({
      id,
      _mstitle: { pt_BR: `Apartamento Stays ${id}` },
      _idproperty: `P-${index}`,
      _i_maxGuests: 4,
      _i_rooms: 1,
      _i_beds: 2,
      _f_bathrooms: 1,
      address: { city: 'Caldas Novas' }
    });
  }
  if (url.hostname === 'imob.test' && url.pathname.endsWith('/listOrcamento')) {
    const body = JSON.parse(options.body || '{}');
    if (body.condominio) return Response.json(imobRecords.filter((item) => String(item.condominio) === String(body.condominio)));
    return Response.json({ opcoes: imobRecords });
  }
  if (url.hostname === 'reservascrcn.test' && url.pathname === '/') {
    return new Response('<script>var quote = {"formReserva-totalDinheiro": "1130"};</script>');
  }
  throw new Error(`Unexpected upstream request: ${url.hostname}${url.pathname}`);
};

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitForHealth(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await nativeFetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Local Search API did not start.');
}

async function main() {
  const port = await freePort();
  process.env.PORT = String(port);
  process.env.NODE_ENV = 'test';
  process.env.STAYS_BASE_URL = 'https://stays.test/external/v1';
  process.env.STAYS_LOGIN = 'test-user';
  process.env.STAYS_PASSWORD = 'test-password';
  process.env.IMOB_BASE_URL = 'https://imob.test/crcn';
  process.env.IMOB_PUBLIC_BASE_URL = 'https://reservascrcn.test';
  process.env.IMOB_AUTHORIZATION = 'Basic test-token';
  require('../src/index');

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(`${baseUrl}/health`);

  const response = await nativeFetch(`${baseUrl}/api/v1/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: '2026-11-01', to: '2026-11-03', persons: 4, max_results: 3 })
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.sucesso, true);
  assert.deepEqual(Object.keys(payload).sort(), [
    'filtros_aplicados', 'mais_opcoes_disponiveis', 'opcoes', 'opcoes_retornadas',
    'periodo', 'relogio_oficial', 'sucesso', 'tempo_resposta_ms', 'total_encontrados', 'total_exato'
  ].sort());
  assert.equal(payload.opcoes.length, 3);
  assert.match(payload.opcoes[0].id, /^STAY-/);
  assert.equal(payload.opcoes[1].id, '1002');
  assert.equal(payload.opcoes[1].valor_total, 442);
  assert.equal(payload.opcoes[2].id, '1086');
  assert.equal(payload.opcoes[2].valor_total, 1130);
  assert.deepEqual(Object.keys(payload.opcoes[1]), Object.keys(payload.opcoes[0]));
  assert.equal(upstreamCalls.some((call) => call.url.hostname === 'imob.test'), true);
  assert.equal(upstreamCalls.some((call) => call.url.hostname === 'reservascrcn.test'), true);

  upstreamCalls.length = 0;
  const fullStaysResponse = await nativeFetch(`${baseUrl}/api/v1/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: '2026-11-01', to: '2026-11-03', persons: 5, max_results: 3 })
  });
  const fullStays = await fullStaysResponse.json();
  assert.equal(fullStays.opcoes.length, 3);
  assert.ok(fullStays.opcoes.every((option) => String(option.id).startsWith('STAY-')));
  assert.equal(upstreamCalls.some((call) => call.url.hostname === 'imob.test'), false);

  // Teste 3: Consulta de condomínio na rota /api/v1/properties (híbrida Stays + Imob)
  const propResponse = await nativeFetch(`${baseUrl}/api/v1/properties?q=Golden`);
  const propPayload = await propResponse.json();
  assert.equal(propResponse.status, 200);
  assert.equal(propPayload.sucesso, true);
  assert.ok(propPayload.propriedades.length >= 1);
  assert.equal(propPayload.propriedades[0].nome, 'Golden Dolphin Supreme');
  assert.equal(propPayload.propriedades[0].provedor, 'imob');
  assert.ok(propPayload.propriedades[0].descricao.length > 0);

  // Teste 4: Busca de disponibilidade filtrada por condomínio do Imob (sem quebrar na Stays)
  upstreamCalls.length = 0;
  const imobFilteredResponse = await nativeFetch(`${baseUrl}/api/v1/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: '2026-11-01', to: '2026-11-03', persons: 4, property: 'Golden Dolphin Supreme', max_results: 3 })
  });
  const imobFilteredPayload = await imobFilteredResponse.json();
  assert.equal(imobFilteredResponse.status, 200);
  assert.equal(imobFilteredPayload.sucesso, true);
  assert.ok(imobFilteredPayload.opcoes.length >= 1);
  assert.equal(imobFilteredPayload.opcoes[0].condominio, 'Golden Dolphin Supreme');

  console.log('search-api integration: local endpoint preserves response option shape and supplements only when needed');
  console.log('search-api integration: property lookup and imob-only resolution verified successfully');
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
