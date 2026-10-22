const assert = require('node:assert/strict');
const net = require('node:net');
const { StaysClient } = require('../src/stays-client');

const originalResolveSearchFilters = StaysClient.prototype.resolveSearchFilters;
StaysClient.prototype.resolveSearchFilters = async function resolveSearchFiltersWithTestRetry(input) {
  if (process.env.TEST_HYBRID_PROPERTY_THEN_AMENITY_ERROR === '1') {
    this.__testFilterResolutionCount = (this.__testFilterResolutionCount || 0) + 1;
    const error = new Error('Test catalog filter is missing.');
    Object.assign(error, this.__testFilterResolutionCount === 1
      ? { code: 'STAYS_FILTER_NOT_FOUND', filterGroup: 'properties', unknownValue: 'piazza' }
      : {
          code: 'STAYS_FILTER_NOT_FOUND', filterGroup: 'amenities', unknownValue: 'pet',
          availableOptions: [{ id: 'pool-open', nome: 'Piscina ao ar livre (Compartilhada)' }],
          availableOptionCount: 1,
          optionsTruncated: false
        });
    throw error;
  }
  return originalResolveSearchFilters.call(this, input);
};

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
      amenities: [{ _id: 'pool-open', _mstitle: { pt_BR: 'Piscina ao ar livre (Compartilhada)' } }], inventory: [], properties: [
        { _id: 'STAY-P1', _mstitle: { pt_BR: 'Hotel Stays' } },
        { _id: '6a3499da086cdffd520549e8', id: 'LH23J', _mstitle: { pt_BR: 'CRCN - Piazza diRoma' } },
        { _id: '6a32c14c834bbbf9de8b2ba9', id: 'LG06J', _mstitle: { pt_BR: 'CRCN - Casa com Piscina' } }
      ], cities: [], regions: [], rooms: [], guests: []
    });
  }
  if (url.hostname === 'stays.test' && url.pathname.endsWith('/booking/search-listings')) {
    const body = JSON.parse(options.body || '{}');
    if ((body.properties || []).includes('6a3499da086cdffd520549e8')) {
      if (process.env.TEST_PIAZZA_STAYS_ALT_ERROR === '1' && body.from !== '2026-12-24') {
        return Response.json({ erro: 'temporary failure' }, { status: 503 });
      }
      if (process.env.TEST_PIAZZA_STAYS_ALT_AVAILABLE === '1' && body.from === '2026-12-25') {
        return Response.json([staysListing('STAY-ALT-1', 'STAY-P1', 750)]);
      }
      return Response.json([]);
    }
    if ((body.properties || []).includes('6a32c14c834bbbf9de8b2ba9')) {
      if (process.env.TEST_STAYS_ONLY_ALT_AVAILABLE === '1' && body.from === '2026-12-25') {
        return Response.json([staysListing('STAY-ONLY-ALT-1', 'P-1', 650)]);
      }
      return Response.json([]);
    }
    if (process.env.TEST_GENERAL_STAYS_EMPTY === '1' && body.from === '2026-12-24') return Response.json([]);
    const count = body.guests === 5 ? 3 : 1;
    return Response.json(Array.from({ length: count }, (_, i) => staysListing(`STAY-${body.guests}-${i}`, `P-${i}`, 500 + i * 100)));
  }
  if (url.hostname === 'stays.test' && url.pathname.includes('/booking/reservations/')) {
    const reservationId = decodeURIComponent(url.pathname.split('/').pop());
    if (url.pathname.endsWith('/payments')) return Response.json([]);
    if (reservationId === '5237057474') {
      return Response.json({
        _id: 'internal-reservation-1',
        id: 'QC02J',
        partnerCode: '5237057474',
        _idlisting: 'RESERVATION-LISTING',
        type: 'canceled',
        partner: { name: 'API booking.com' },
        checkInDate: '2026-10-21',
        checkOutDate: '2026-10-24',
        guests: 6,
        guestsDetails: { adults: 5, children: 1 },
        price: { currency: 'BRL', _f_total: 1200 },
        stats: { _f_totalPaid: 0 }
      });
    }
    return Response.json({ message: 'Not found' }, { status: 404 });
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
  if (url.hostname === 'stays.test' && url.pathname.includes('/content/properties/')) {
    const id = decodeURIComponent(url.pathname.split('/').pop());
    if (id === '6a32a879024c3c27b14a7c05') {
      return Response.json({ _mstitle: { pt_BR: 'Aquarius Residence' }, _msdesc: { pt_BR: 'Condomínio com piscina e bar molhado.' } });
    }
    if (id === '6a35437cdb55e2219851aae2') {
      return Response.json({ _mstitle: { pt_BR: 'Sol das Caldas' }, _msdesc: { pt_BR: 'Não tem bar molhado.' } });
    }
    return Response.json({ _mstitle: { pt_BR: 'Condomínio Teste' } });
  }
  if (url.hostname === 'imob.test' && url.pathname.endsWith('/listOrcamento')) {
    const body = JSON.parse(options.body || '{}');
    if (!body.condominio && process.env.TEST_GENERAL_IMOB_ERROR === '1') {
      return Response.json({ erro: 'temporary failure' }, { status: 503 });
    }
    if (String(body.condominio) === '84' && process.env.TEST_PIAZZA_IMOB_ERROR === '1') {
      return Response.json({ erro: 'temporary failure' }, { status: 503 });
    }
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
  process.env.RESERVATION_LOOKUP_TOKEN = 'test-reservation-token';
  process.env.IMOB_BASE_URL = 'https://imob.test/crcn';
  process.env.IMOB_PUBLIC_BASE_URL = 'https://reservascrcn.test';
  process.env.IMOB_AUTHORIZATION = 'Basic test-token';
  process.env.SEARCH_ALTERNATIVE_DATE_WINDOW_DAYS = '2';
  require('../src/index');

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(`${baseUrl}/health`);

  const unauthenticatedLookup = await nativeFetch(`${baseUrl}/api/v1/reservations/5237057474`);
  assert.equal(unauthenticatedLookup.status, 401);
  const invalidTokenLookup = await nativeFetch(`${baseUrl}/api/v1/reservations/5237057474`, {
    headers: { 'x-reservation-lookup-token': 'invalid-token' }
  });
  assert.equal(invalidTokenLookup.status, 401);
  upstreamCalls.length = 0;
  const reservationLookup = await nativeFetch(`${baseUrl}/api/v1/reservations/5237057474`, {
    headers: { 'x-reservation-lookup-token': 'test-reservation-token' }
  });
  const reservationPayload = await reservationLookup.json();
  assert.equal(reservationLookup.status, 200);
  assert.equal(reservationPayload.sucesso, true);
  assert.equal(reservationPayload.encontrada, true);
  assert.equal(reservationPayload.reserva.canal, 'API booking.com');
  assert.equal(reservationPayload.reserva.status.codigo, 'canceled');
  assert.equal(reservationPayload.reserva.hospedes.total, 6);
  assert.equal(upstreamCalls.some((call) => call.url.pathname.endsWith('/booking/reservations/5237057474')), true);
  assert.equal(upstreamCalls.some((call) => call.url.pathname.includes('/booking/reservations-export')), false);
  const missingLookup = await nativeFetch(`${baseUrl}/api/v1/reservations/DOES-NOT-EXIST`, {
    headers: { 'x-reservation-lookup-token': 'test-reservation-token' }
  });
  const missingPayload = await missingLookup.json();
  assert.equal(missingLookup.status, 404);
  assert.equal(missingPayload.sucesso, true);
  assert.equal(missingPayload.encontrada, false);

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

  const featureResponse = await nativeFetch(`${baseUrl}/api/v1/properties?q=bar%20molhado`);
  const featurePayload = await featureResponse.json();
  assert.equal(featureResponse.status, 200);
  assert.equal(featurePayload.modo, 'caracteristica');
  assert.ok(featurePayload.propriedades.some((property) => property.property_key === 'crcn:aquarius-residence'));
  assert.ok(!featurePayload.propriedades.some((property) => property.property_key === 'crcn:sol-das-caldas'));
  assert.ok(featurePayload.propriedades.every((property) => property.evidencia && property.property_key));

  const unsupportedFeatureResponse = await nativeFetch(`${baseUrl}/api/v1/properties?feature=bar%20gourmet`);
  assert.equal(unsupportedFeatureResponse.status, 422);

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
  assert.equal(piazzaNoAvailabilityPayload.alternativa_datas.estado, 'nao_encontradas_no_limite');
  assert.equal(piazzaNoAvailabilityPayload.alternativa_datas.datas_consultadas.length, 4);
  assert.match(piazzaNoAvailabilityPayload.instrucao_para_o_agente.o_que_fazer, /dentro da janela de 2 dias/);

  // Datas próximas só são consultadas depois de ambos os provedores confirmarem indisponibilidade.
  process.env.TEST_PIAZZA_STAYS_ALT_AVAILABLE = '1';
  process.env.TEST_PIAZZA_IMOB_EMPTY = '1';
  upstreamCalls.length = 0;
  const nearestDatesResponse = await nativeFetch(`${baseUrl}/api/v1/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: '2026-12-24', to: '2026-12-27', persons: 6, property: 'crcn:piazza-diroma', max_results: 3 })
  });
  const nearestDatesPayload = await nearestDatesResponse.json();
  const alternateStaysCalls = upstreamCalls.filter((call) => call.url.hostname === 'stays.test' && call.url.pathname.endsWith('/booking/search-listings'));
  const alternateBodies = alternateStaysCalls.map((call) => JSON.parse(call.options.body));
  assert.equal(nearestDatesResponse.status, 200);
  assert.equal(nearestDatesPayload.opcoes.length, 0, 'alternative dates stay separate from the originally requested dates');
  assert.equal(nearestDatesPayload.alternativa_datas.estado, 'encontradas');
  assert.deepEqual(nearestDatesPayload.alternativa_datas.periodos[0].periodo, {
    check_in: '2026-12-25', check_out: '2026-12-28', noites: 3, hospedes: 6
  });
  assert.equal(nearestDatesPayload.alternativa_datas.periodos[0].opcoes[0].id, 'STAY-ALT-1');
  assert.equal(alternateBodies.length, 3, 'one original Stays search plus two nearest-date probes');
  assert.ok(alternateBodies.slice(1).every((body) => body.guests === 6 && body.properties?.[0] === '6a3499da086cdffd520549e8'));
  assert.equal(upstreamCalls.filter((call) => call.url.hostname === 'imob.test' && call.url.pathname.endsWith('/listOrcamento')).length, 1,
    'Imob is consulted for the original period only');
  assert.match(nearestDatesPayload.instrucao_para_o_agente.sugestao_de_fala, /25\/12\/2026 a 28\/12\/2026/);
  delete process.env.TEST_PIAZZA_STAYS_ALT_AVAILABLE;
  delete process.env.TEST_PIAZZA_IMOB_EMPTY;

  // Stays-only properties use the applicable Stays result and never call Imob.
  process.env.TEST_STAYS_ONLY_ALT_AVAILABLE = '1';
  upstreamCalls.length = 0;
  const staysOnlyResponse = await nativeFetch(`${baseUrl}/api/v1/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: '2026-12-24', to: '2026-12-27', persons: 2,
      property: 'crcn:casa-com-piscina', amenities: 'Piscina ao ar livre (Compartilhada)'
    })
  });
  const staysOnly = await staysOnlyResponse.json();
  const staysOnlyCalls = upstreamCalls
    .filter((call) => call.url.hostname === 'stays.test' && call.url.pathname.endsWith('/booking/search-listings'))
    .map((call) => JSON.parse(call.options.body));
  assert.equal(staysOnlyResponse.status, 200);
  assert.equal(staysOnly.provedores_consultados.stays.status, 'no_availability');
  assert.equal(staysOnly.provedores_consultados.imob.status, 'not_required');
  assert.equal(staysOnly.alternativa_datas.estado, 'encontradas');
  assert.equal(staysOnly.alternativa_datas.periodos[0].opcoes[0].id, 'STAY-ONLY-ALT-1');
  assert.equal(staysOnlyCalls.length, 3, 'one original-period and two nearest-date Stays probes');
  assert.ok(staysOnlyCalls.every((body) => body.amenities?.[0] === 'pool-open' && body.properties?.[0] === '6a32c14c834bbbf9de8b2ba9'),
    'nearby Stays probes preserve the applicable amenity and property filters');
  assert.equal(upstreamCalls.some((call) => call.url.hostname === 'imob.test' && call.url.pathname.endsWith('/listOrcamento')), false);
  delete process.env.TEST_STAYS_ONLY_ALT_AVAILABLE;

  // A general search needs explicit no_availability from both providers when Imob is configured.
  process.env.TEST_GENERAL_STAYS_EMPTY = '1';
  process.env.TEST_GENERAL_IMOB_ERROR = '1';
  upstreamCalls.length = 0;
  const generalSearchErrorResponse = await nativeFetch(`${baseUrl}/api/v1/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: '2026-12-24', to: '2026-12-27', persons: 2 })
  });
  const generalSearchError = await generalSearchErrorResponse.json();
  assert.equal(generalSearchError.provedores_consultados.stays.status, 'no_availability');
  assert.equal(generalSearchError.provedores_consultados.imob.status, 'error');
  assert.equal(generalSearchError.alternativa_datas, undefined);
  assert.equal(upstreamCalls.filter((call) => call.url.hostname === 'stays.test' && call.url.pathname.endsWith('/booking/search-listings')).length, 1);
  delete process.env.TEST_GENERAL_STAYS_EMPTY;
  delete process.env.TEST_GENERAL_IMOB_ERROR;

  // Imob-only properties never search alternate dates in Stays.
  upstreamCalls.length = 0;
  const imobOnlyNoAvailabilityResponse = await nativeFetch(`${baseUrl}/api/v1/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: '2026-12-24', to: '2026-12-27', persons: 2, property: 'crcn:lagoa-quente-flat-service' })
  });
  const imobOnlyNoAvailability = await imobOnlyNoAvailabilityResponse.json();
  assert.equal(imobOnlyNoAvailability.provedores_consultados.stays.status, 'not_required');
  assert.equal(imobOnlyNoAvailability.provedores_consultados.imob.status, 'no_availability');
  assert.equal(imobOnlyNoAvailability.alternativa_datas, undefined);
  assert.equal(upstreamCalls.some((call) => call.url.hostname === 'stays.test' && call.url.pathname.endsWith('/booking/search-listings')), false);

  // An error at the nearest distance makes the alternative search incomplete; do not probe farther dates.
  process.env.TEST_PIAZZA_STAYS_ALT_ERROR = '1';
  process.env.TEST_PIAZZA_IMOB_EMPTY = '1';
  upstreamCalls.length = 0;
  const nearbyFailureResponse = await nativeFetch(`${baseUrl}/api/v1/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: '2026-12-24', to: '2026-12-27', persons: 6, property: 'crcn:piazza-diroma', max_results: 3 })
  });
  const nearbyFailure = await nearbyFailureResponse.json();
  const failedProbeDates = nearbyFailure.alternativa_datas.datas_consultadas;
  const staysCallsAfterNearbyFailure = upstreamCalls
    .filter((call) => call.url.hostname === 'stays.test' && call.url.pathname.endsWith('/booking/search-listings'));
  assert.equal(nearbyFailureResponse.status, 200);
  assert.equal(nearbyFailure.alternativa_datas.estado, 'busca_incompleta');
  assert.equal(failedProbeDates.length, 2, 'only the nearest distance is queried after a Stays error');
  assert.ok(failedProbeDates.every((period) => period.status === 'error'));
  assert.equal(staysCallsAfterNearbyFailure.length, 3, 'one original-period call plus two nearest-date probes');
  assert.doesNotMatch(nearbyFailure.instrucao_para_o_agente.o_que_fazer, /não há disponibilidade/i);
  assert.match(nearbyFailure.instrucao_para_o_agente.o_que_fazer, /busca de datas próximas na Stays ficou incompleta/);
  delete process.env.TEST_PIAZZA_STAYS_ALT_ERROR;
  delete process.env.TEST_PIAZZA_IMOB_EMPTY;

  // Erro do Imob é inconclusivo e nunca dispara busca de datas próximas.
  process.env.TEST_PIAZZA_IMOB_ERROR = '1';
  upstreamCalls.length = 0;
  const incompleteCoverageResponse = await nativeFetch(`${baseUrl}/api/v1/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: '2026-12-24', to: '2026-12-27', persons: 6, property: 'crcn:piazza-diroma', max_results: 3 })
  });
  const incompleteCoverage = await incompleteCoverageResponse.json();
  assert.equal(incompleteCoverage.provedores_consultados.imob.status, 'error');
  assert.equal(incompleteCoverage.alternativa_datas, undefined);
  assert.match(incompleteCoverage.instrucao_para_o_agente.o_que_fazer, /Não foi confirmada indisponibilidade nos dois provedores/);
  assert.doesNotMatch(incompleteCoverage.instrucao_para_o_agente.o_que_fazer, /não retornaram disponibilidade/);
  assert.equal(upstreamCalls.filter((call) => call.url.hostname === 'stays.test' && call.url.pathname.endsWith('/booking/search-listings')).length, 1);
  delete process.env.TEST_PIAZZA_IMOB_ERROR;

  // The date window excludes any candidate check-in before the current BRT date.
  const clockResponse = await nativeFetch(`${baseUrl}/api/v1/date/now`);
  const todayIso = (await clockResponse.json()).data_hoje;
  const shiftIso = (iso, days) => {
    const value = new Date(`${iso}T00:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  };
  process.env.TEST_PIAZZA_IMOB_EMPTY = '1';
  upstreamCalls.length = 0;
  const boundaryResponse = await nativeFetch(`${baseUrl}/api/v1/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: shiftIso(todayIso, 1), to: shiftIso(todayIso, 4), persons: 6, property: 'crcn:piazza-diroma', max_results: 3 })
  });
  const boundaryPayload = await boundaryResponse.json();
  const boundaryStaysDates = upstreamCalls
    .filter((call) => call.url.hostname === 'stays.test' && call.url.pathname.endsWith('/booking/search-listings'))
    .map((call) => JSON.parse(call.options.body).from);
  assert.equal(boundaryResponse.status, 200);
  assert.ok(boundaryStaysDates.every((date) => date >= todayIso), 'never query Stays for a check-in before today in BRT');
  assert.ok(boundaryPayload.alternativa_datas.datas_consultadas.every((period) => period.check_in >= todayIso));
  assert.ok(boundaryPayload.alternativa_datas.datas_consultadas.length < 4, 'the past-side probe is skipped at the date boundary');
  delete process.env.TEST_PIAZZA_IMOB_EMPTY;

  // Comodidades são verificadas na Stays; nunca completar opções pelo Imob sem aplicar o mesmo filtro.
  upstreamCalls.length = 0;
  const amenitySearchResponse = await nativeFetch(`${baseUrl}/api/v1/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: '2026-12-04', to: '2026-12-06', persons: 2, amenities: 'Piscina ao ar livre (Compartilhada)' })
  });
  const amenitySearch = await amenitySearchResponse.json();
  assert.equal(amenitySearchResponse.status, 200);
  assert.deepEqual(amenitySearch.filtros_aplicados.amenities, ['pool-open']);
  assert.equal(amenitySearch.provedores_consultados.imob.status, 'not_queried');
  assert.equal(amenitySearch.provedores_consultados.imob.code, 'AMENITY_FILTER_UNSUPPORTED');
  assert.deepEqual(amenitySearch.cobertura_filtros.amenities.provedores_com_filtro_aplicado, ['stays']);
  assert.deepEqual(amenitySearch.cobertura_filtros.amenities.provedores_sem_filtro_aplicado, ['imob']);
  assert.equal(upstreamCalls.some((call) => call.url.pathname.endsWith('/listOrcamento')), false);

  // Unknown amenity labels return exact catalogue options and never broaden the search.
  for (const unknownAmenity of ['pet', 'Pet friendly']) {
    upstreamCalls.length = 0;
    const unknownAmenityResponse = await nativeFetch(`${baseUrl}/api/v1/search`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: '2026-12-04', to: '2026-12-06', persons: 2,
        property: 'crcn:piazza-diroma', amenities: unknownAmenity
      })
    });
    const unknownAmenityPayload = await unknownAmenityResponse.json();
    assert.equal(unknownAmenityResponse.status, 422);
    assert.equal(unknownAmenityPayload.codigo, 'STAYS_FILTER_NOT_FOUND');
    assert.equal(unknownAmenityPayload.filtro.categoria, 'amenities');
    assert.equal(unknownAmenityPayload.filtro.valor_recebido, unknownAmenity);
    assert.deepEqual(unknownAmenityPayload.filtro.opcoes_validas, [
      { id: 'pool-open', nome: 'Piscina ao ar livre (Compartilhada)' }
    ]);
    assert.equal(unknownAmenityPayload.filtro.valor_exato_reconhecido, false);
    assert.equal(unknownAmenityPayload.filtro.equivalencia_semantica_confirmada, false);
    assert.equal(unknownAmenityPayload.filtro.catalogo_completo_endpoint, '/api/v1/searchfilters');
    assert.match(unknownAmenityPayload.instrucao_para_o_agente.o_que_fazer, /não remova esse filtro/);
    assert.match(unknownAmenityPayload.instrucao_para_o_agente.proibido, /correspondência aproximada silenciosa/);
    assert.equal(upstreamCalls.some((call) => call.url.pathname.endsWith('/booking/search-listings') || call.url.pathname.endsWith('/listOrcamento')), false,
      'an unknown amenity must not become an unfiltered search');
  }

  // A hybrid property's missing Stays property filter may trigger a retry; if that retry
  // then finds an invalid amenity, it must return the same structured filter guidance.
  process.env.TEST_HYBRID_PROPERTY_THEN_AMENITY_ERROR = '1';
  upstreamCalls.length = 0;
  const hybridRetryFilterErrorResponse = await nativeFetch(`${baseUrl}/api/v1/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: '2026-12-04', to: '2026-12-06', persons: 2,
      property: 'crcn:piazza-diroma', amenities: 'pet'
    })
  });
  const hybridRetryFilterError = await hybridRetryFilterErrorResponse.json();
  assert.equal(hybridRetryFilterErrorResponse.status, 422);
  assert.equal(hybridRetryFilterError.codigo, 'STAYS_FILTER_NOT_FOUND');
  assert.equal(hybridRetryFilterError.filtro.categoria, 'amenities');
  assert.equal(hybridRetryFilterError.filtro.valor_recebido, 'pet');
  assert.deepEqual(hybridRetryFilterError.filtro.opcoes_validas, [
    { id: 'pool-open', nome: 'Piscina ao ar livre (Compartilhada)' }
  ]);
  assert.equal(hybridRetryFilterError.filtro.valor_exato_reconhecido, false);
  assert.match(hybridRetryFilterError.instrucao_para_o_agente.o_que_fazer, /não há uma equivalência semântica confirmada/);
  assert.equal(upstreamCalls.some((call) => call.url.pathname.endsWith('/booking/search-listings') || call.url.pathname.endsWith('/listOrcamento')), false);
  delete process.env.TEST_HYBRID_PROPERTY_THEN_AMENITY_ERROR;

  // Propriedade exclusiva do Imob não pode aparentar que a comodidade foi conferida.
  upstreamCalls.length = 0;
  const imobOnlyAmenityResponse = await nativeFetch(`${baseUrl}/api/v1/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: '2026-12-04', to: '2026-12-06', persons: 2,
      property: 'crcn:lagoa-quente-flat-service', amenities: 'Piscina ao ar livre (Compartilhada)'
    })
  });
  const imobOnlyAmenity = await imobOnlyAmenityResponse.json();
  assert.equal(imobOnlyAmenityResponse.status, 422);
  assert.equal(imobOnlyAmenity.codigo, 'AMENITY_FILTER_UNSUPPORTED_BY_PROVIDER');
  assert.equal(upstreamCalls.some((call) => call.url.pathname.endsWith('/booking/search-listings') || call.url.pathname.endsWith('/listOrcamento')), false);

  // Sem resultado na Stays e sem filtro de comodidade no Imob, pedir outras datas preservando todos os filtros.
  upstreamCalls.length = 0;
  const partialAmenityResponse = await nativeFetch(`${baseUrl}/api/v1/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: '2026-12-24', to: '2026-12-27', persons: 2,
      property: 'crcn:piazza-diroma', amenities: 'Piscina ao ar livre (Compartilhada)'
    })
  });
  const partialAmenity = await partialAmenityResponse.json();
  const amenityStaysCall = upstreamCalls.find((call) => call.url.hostname === 'stays.test' && call.url.pathname.endsWith('/booking/search-listings'));
  assert.equal(partialAmenityResponse.status, 200);
  assert.equal(partialAmenity.opcoes.length, 0);
  assert.equal(partialAmenity.provedores_consultados.stays.status, 'no_availability');
  assert.equal(partialAmenity.provedores_consultados.imob.status, 'not_queried');
  assert.equal(partialAmenity.provedores_consultados.imob.code, 'AMENITY_FILTER_UNSUPPORTED');
  assert.equal(partialAmenity.alternativa_datas, undefined);
  assert.match(partialAmenity.instrucao_para_o_agente.o_que_fazer, /NÃO afirme indisponibilidade geral/);
  assert.match(partialAmenity.instrucao_para_o_agente.o_que_fazer, /outras datas/);
  assert.match(partialAmenity.instrucao_para_o_agente.o_que_fazer, /mesmo condomínio, a mesma comodidade e os demais filtros/);
  assert.ok(amenityStaysCall);
  assert.equal(upstreamCalls.filter((call) => call.url.hostname === 'stays.test' && call.url.pathname.endsWith('/booking/search-listings')).length, 1,
    'unsupported Imob amenity coverage does not trigger automatic nearby-date probes');
  assert.deepEqual(JSON.parse(amenityStaysCall.options.body).properties, ['6a3499da086cdffd520549e8']);
  assert.deepEqual(JSON.parse(amenityStaysCall.options.body).amenities, ['pool-open']);
  assert.equal(upstreamCalls.some((call) => call.url.pathname.endsWith('/listOrcamento')), false);

  // After an explicit client-approved date change, the next search must keep the amenity filter.
  upstreamCalls.length = 0;
  const approvedAmenityRetryResponse = await nativeFetch(`${baseUrl}/api/v1/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: '2026-12-25', to: '2026-12-28', persons: 2,
      property: 'crcn:piazza-diroma', amenities: 'Piscina ao ar livre (Compartilhada)'
    })
  });
  const approvedAmenityRetry = await approvedAmenityRetryResponse.json();
  const approvedAmenityStaysCall = upstreamCalls.find((call) => call.url.hostname === 'stays.test' && call.url.pathname.endsWith('/booking/search-listings'));
  assert.equal(approvedAmenityRetryResponse.status, 200);
  assert.ok(approvedAmenityStaysCall);
  assert.deepEqual(JSON.parse(approvedAmenityStaysCall.options.body).amenities, ['pool-open']);
  assert.deepEqual(JSON.parse(approvedAmenityStaysCall.options.body).properties, ['6a3499da086cdffd520549e8']);
  assert.equal(approvedAmenityRetry.alternativa_datas, undefined,
    'amenity-limited coverage still cannot trigger unconfirmed automatic alternatives');

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
