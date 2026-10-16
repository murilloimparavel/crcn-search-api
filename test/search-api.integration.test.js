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
  { id: 1086, condominio: 91, nomeCond: 'Golden Dolphin Supreme', unidade: 'B0802', titulo: 'Apartamento B0802', maxOcupantes: 5, linkParceiro: 'https://reservascrcn.com.br/parceiro/1/1086?01-11-2026,03-11-2026?s1,,' },
  { id: 1002, condominio: 44, nomeCond: 'Everest Flat Service', unidade: '00604', titulo: 'Apartamento 00604', maxOcupantes: 4, valorTotal: 442, linkParceiro: 'https://reservascrcn.com.br/parceiro/1/1002?01-11-2026,03-11-2026?s1,,' },
  { id: 1184, condominio: 89, nomeCond: 'Golden Dolphin G Hotel', unidade: 'B0901', titulo: 'Apartamento B0901', maxOcupantes: 11, linkParceiro: 'https://reservascrcn.com.br/parceiro/1/1184?01-11-2026,03-11-2026?s1,,' }
];
const piazzaImobRecord = {
  id: 2084,
  condominio: 84,
  nomeCond: 'Piazza diRoma',
  unidade: 'A0601',
  titulo: 'Apartamento Piazza A0601',
  maxOcupantes: 6,
  valorTotal: 900,
  linkParceiro: 'https://reservascrcn.com.br/parceiro/1/2084?24-12-2026,27-12-2026?s1,,'
};

global.fetch = async (input, options = {}) => {
  const url = new URL(input);
  upstreamCalls.push({ url, options });
  if (url.hostname === 'stays.test' && url.pathname.endsWith('/booking/searchfilter')) {
    return Response.json({
      amenities: [], inventory: [], properties: [
        { _id: 'STAY-P1', _mstitle: { pt_BR: 'Hotel Stays' } },
        { _id: '6a3499da086cdffd520549e8', id: 'LH23J', _mstitle: { pt_BR: 'CRCN - Piazza diRoma' } }
      ], cities: [], regions: [], rooms: [], guests: []
    });
  }
  if (url.hostname === 'stays.test' && url.pathname.endsWith('/booking/search-listings')) {
    const body = JSON.parse(options.body || '{}');
    if ((body.properties || []).includes('6a3499da086cdffd520549e8')) return Response.json([]);
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
    if (body.entrada === '2026-11-01' && body.saida === '2026-11-02' && String(body.condominio) !== '84') {
      return Response.json({ erro: 'Min de 2 Noites' });
    }
    if (String(body.condominio) === '84') {
      return Response.json(process.env.TEST_PIAZZA_IMOB_EMPTY === '1' ? [] : [piazzaImobRecord]);
    }
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
  process.env.STAYS_CLIENT_ID = 'test-client-id';
  process.env.STAYS_CLIENT_SECRET = 'test-client-secret';
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
    'filtros_aplicados', 'mais_opcoes_disponiveis', 'opcoes', 'opcoes_retornadas', 'provedores_consultados',
    'periodo', 'proxima_pagina', 'relogio_oficial', 'sucesso', 'tempo_resposta_ms', 'total_encontrados', 'total_exato'
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
  const goldenProperty = propPayload.propriedades.find((property) => property.imob_id === 91);
  assert.ok(goldenProperty);
  assert.equal(goldenProperty.nome, 'GOLDEN DOLPHIN SUPREME');
  assert.equal(goldenProperty.provedor, 'imob');
  assert.ok(goldenProperty.descricao.length > 0);

  // Teste 4: Busca de disponibilidade filtrada por condomínio do Imob (sem quebrar na Stays)
  upstreamCalls.length = 0;
  const imobFilteredResponse = await nativeFetch(`${baseUrl}/api/v1/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: '2026-11-01', to: '2026-11-03', persons: 4, property: 'crcn:golden-dolphin-supreme', max_results: 3 })
  });
  const imobFilteredPayload = await imobFilteredResponse.json();
  assert.equal(imobFilteredResponse.status, 200);
  assert.equal(imobFilteredPayload.sucesso, true);
  assert.ok(imobFilteredPayload.opcoes.length >= 1);
  assert.equal(imobFilteredPayload.opcoes[0].condominio, 'GOLDEN DOLPHIN SUPREME');

  // Teste 4b: a identidade interna filtra os dois provedores pelos IDs correspondentes.
  upstreamCalls.length = 0;
  const piazzaSearchResponse = await nativeFetch(`${baseUrl}/api/v1/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: '2026-12-24', to: '2026-12-27', persons: 6, property: 'crcn:piazza-diroma', max_results: 3 })
  });
  const piazzaSearchPayload = await piazzaSearchResponse.json();
  const piazzaImobCall = upstreamCalls.find((call) => call.url.hostname === 'imob.test');
  const piazzaStaysCall = upstreamCalls.find((call) => call.url.hostname === 'stays.test' && call.url.pathname.endsWith('/booking/search-listings'));
  assert.equal(piazzaSearchResponse.status, 200);
  assert.equal(piazzaSearchPayload.sucesso, true);
  assert.equal(piazzaSearchPayload.opcoes[0].condominio, 'PIAZZA DIROMA');
  assert.ok(piazzaImobCall);
  assert.equal(String(JSON.parse(piazzaImobCall.options.body).condominio), '84');
  assert.ok(piazzaStaysCall);
  assert.deepEqual(JSON.parse(piazzaStaysCall.options.body).properties, ['6a3499da086cdffd520549e8']);
  assert.equal(piazzaSearchPayload.provedores_consultados.stays.property_filter, '6a3499da086cdffd520549e8');
  assert.equal(piazzaSearchPayload.provedores_consultados.imob.condominium_filter, '84');
  assert.equal(piazzaSearchPayload.provedores_consultados.imob.status, 'available');

  // A resposta vazia do Imob para a propriedade deve permanecer explícita; não há fallback global.
  process.env.TEST_PIAZZA_IMOB_EMPTY = '1';
  upstreamCalls.length = 0;
  const piazzaNoAvailabilityResponse = await nativeFetch(`${baseUrl}/api/v1/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: '2026-12-24', to: '2026-12-27', persons: 6, property: 'crcn:piazza-diroma', max_results: 3 })
  });
  delete process.env.TEST_PIAZZA_IMOB_EMPTY;
  const piazzaNoAvailabilityPayload = await piazzaNoAvailabilityResponse.json();
  assert.equal(piazzaNoAvailabilityResponse.status, 200);
  assert.equal(piazzaNoAvailabilityPayload.opcoes.length, 0);
  assert.equal(piazzaNoAvailabilityPayload.provedores_consultados.stays.status, 'no_availability');
  assert.equal(piazzaNoAvailabilityPayload.provedores_consultados.imob.status, 'no_availability');
  assert.match(piazzaNoAvailabilityPayload.instrucao_para_o_agente.o_que_fazer, /provedores requeridos foram consultados/);

  // Propriedade desconhecida nunca deve remover silenciosamente o filtro nem pesquisar o inventário geral.
  upstreamCalls.length = 0;
  const unresolvedPropertyResponse = await nativeFetch(`${baseUrl}/api/v1/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: '2026-12-24', to: '2026-12-27', persons: 6, property: 'crcn:not-in-catalog' })
  });
  const unresolvedPropertyPayload = await unresolvedPropertyResponse.json();
  assert.equal(unresolvedPropertyResponse.status, 422);
  assert.equal(unresolvedPropertyPayload.codigo, 'PROPERTY_NOT_RESOLVED');
  assert.equal(upstreamCalls.some((call) => call.url.pathname.endsWith('/booking/search-listings') || call.url.pathname.endsWith('/listOrcamento')), false);

  const rawNameResponse = await nativeFetch(`${baseUrl}/api/v1/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: '2026-12-24', to: '2026-12-27', persons: 6, property: 'Piazza diRoma' })
  });
  const rawNamePayload = await rawNameResponse.json();
  assert.equal(rawNameResponse.status, 422);
  assert.equal(rawNamePayload.codigo, 'PROPERTY_KEY_REQUIRED');

  // Teste 5: Paginação sequencial disjunta (page 1 vs page 2)
  const page1Res = await nativeFetch(`${baseUrl}/api/v1/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: '2026-11-01', to: '2026-11-03', persons: 4, max_results: 1, page: 1 })
  });
  const page1Data = await page1Res.json();
  assert.equal(page1Data.opcoes.length, 1);
  assert.equal(page1Data.mais_opcoes_disponiveis, true);
  assert.equal(page1Data.proxima_pagina, 2);

  const page2Res = await nativeFetch(`${baseUrl}/api/v1/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: '2026-11-01', to: '2026-11-03', persons: 4, max_results: 1, page: 2 })
  });
  const page2Data = await page2Res.json();
  assert.equal(page2Data.opcoes.length, 1);
  assert.notEqual(page1Data.opcoes[0].id, page2Data.opcoes[0].id);

  // Teste 6: resposta de estadia mínima inclui automaticamente opções para duas noites
  const minimumStayRes = await nativeFetch(`${baseUrl}/api/v1/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: '2026-11-01', to: '2026-11-02', persons: 2, max_results: 3 })
  });
  const minimumStayData = await minimumStayRes.json();
  assert.equal(minimumStayRes.status, 200);
  assert.equal(minimumStayData.periodo.noites, 1);
  assert.equal(minimumStayData.alternativa_estadia_minima.minimo_noites, 2);
  assert.equal(minimumStayData.alternativa_estadia_minima.periodo.check_in, '2026-11-01');
  assert.equal(minimumStayData.alternativa_estadia_minima.periodo.check_out, '2026-11-03');
  assert.equal(minimumStayData.alternativa_estadia_minima.opcoes.length, 1);
  assert.equal(minimumStayData.instrucao_para_o_agente.o_que_fazer.includes('consultou automaticamente'), true);

  // Teste 7: amplia a capacidade somente quando a faixa preferida não tem opções
  const capacityFallbackRes = await nativeFetch(`${baseUrl}/api/v1/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: '2026-11-01', to: '2026-11-03', persons: 8, max_results: 3 })
  });
  const capacityFallbackData = await capacityFallbackRes.json();
  assert.equal(capacityFallbackRes.status, 200);
  assert.ok(capacityFallbackData.avisos.some((warning) => warning.codigo === 'IMOB_CAPACITY_FILTER_WIDENED'));
  assert.ok(capacityFallbackData.opcoes.some((option) => option.capacidade === 11));
  assert.match(capacityFallbackData.instrucao_para_o_agente.o_que_fazer, /capacidade de cada opção/);

  // Teste 8: Consulta de acomodação por ID numérico do Imob
  const listingImobRes = await nativeFetch(`${baseUrl}/api/v1/listings/91`);
  const listingImobData = await listingImobRes.json();
  assert.equal(listingImobRes.status, 200);
  assert.equal(listingImobData.sucesso, true);
  assert.equal(listingImobData.acomodacao.nome, 'GOLDEN DOLPHIN SUPREME');

  console.log('search-api integration: local endpoint preserves response option shape and supplements only when needed');
  console.log('search-api integration: property lookup, imob resolution, pagination and numeric listings verified successfully');
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
