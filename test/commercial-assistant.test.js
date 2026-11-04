const assert = require('node:assert/strict');
const express = require('express');
// Keep October's past-date rejection and November's availability fixtures
// deterministic without changing application behavior or mocking timers.
const dateCalculator = require('../src/date-calculator');
dateCalculator.todayInSaoPaulo = () => '2026-10-20';
const { createCommercialAssistantRouter } = require('../src/commercial-assistant');

async function main() {
  const staysCalls = [];
  const filterCalls = [];
  const imobCalls = [];
  let failAvailabilityWith404 = false;
  const staysClient = {
    configured: true,
    async getReservation(id) {
      staysCalls.push(['reservation', id]);
      if (id === 'missing') { const error = new Error('404'); error.status = 404; throw error; }
      return { partnerCode: id, _idlisting: 'listing-7', status: 'confirmed', checkInDate: '2026-11-01', checkOutDate: '2026-11-03', guests: 3, guestName: 'Sensitive name', internalNote: 'private' };
    },
    async getReservationPayments(id) {
      if (id === 'no-payment-data') throw new Error('temporary upstream error');
      if (id === 'malformed-payment-data') return [{ status: 'completed', type: 'credit' }];
      return [{ status: 'completed', type: 'credit', _f_val: 500 }, { status: 'completed', type: 'debit', _f_val: 50 }, { status: 'pending', type: 'credit', _f_val: 1000 }];
    },
    async resolveSearchFilters(filters) { filterCalls.push(filters); return {}; },
    async search() {
      if (failAvailabilityWith404) { const error = new Error('404'); error.status = 404; throw error; }
      return [{ id: 'listing-new', bookingPrice: { _mctotal: { BRL: 800 } } }];
    },
    async enrichListings(rows) { return rows.map((listing) => ({ listing, details: { id: listing.id }, property: null, amenityCatalog: [] })); }
  };
  const app = express();
  app.use(express.json());
  app.use('/api/v1/commercial-assistant', createCommercialAssistantRouter({
    express, staysClient, imobClient: {
      configured: true,
      async search(criteria) {
        imobCalls.push(criteria);
        return [
          { id: 445, nomeCond: 'Condomínio', titulo: 'Apartamento teste', valorTotal: 800, linkParceiro: 'https://reservascrcn.com.br/parceiro/1/445?01-11-2026,03-11-2026?s2,,' },
          { unidade: 'B0802', nomeCond: 'Outro condomínio', titulo: 'Apartamento sem link', fotos: [{ data: { url: 'https://images.example.test/flat.jpg' } }] }
        ];
      }
    }, authServiceUrl: 'http://auth.test',
    fetchImpl: async (_url, options) => {
      if (options.headers.Authorization === 'Bearer rejected') return Response.json({ success: false }, { status: 401 });
      return Response.json({ success: true, data: { user: { id: 'crm-user-1' } } });
    }
  }));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/v1/commercial-assistant`;
  const request = (path, body, token = 'accepted') => fetch(`${base}/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body)
  });
  try {
    assert.equal((await request('reservation', { reservationCode: 'X' }, null)).status, 401);
    assert.equal((await request('reservation', { reservationCode: 'X' }, 'rejected')).status, 401);
    assert.equal((await request('availability', { from: 'bad', to: '2026-11-02', adults: 2 })).status, 400);
    assert.equal((await request('availability', { from: '2024-02-31', to: '2024-03-02', adults: 2 })).status, 400);
    assert.equal((await request('availability', { from: '2026-10-08', to: '2026-10-10', adults: 2 })).status, 400);

    const reservationResponse = await request('reservation', { reservationCode: 'PT-123' });
    assert.equal(reservationResponse.status, 200);
    assert.equal(reservationResponse.headers.get('cache-control'), 'no-store');
    const reservation = (await reservationResponse.json()).data.reservation;
    assert.equal(reservation.totalPaid, 450);
    assert.equal(reservation.reservationCode, 'PT-123');
    assert.equal('guestName' in reservation, false);
    assert.equal('internalNote' in reservation, false);
    const paymentUnavailable = await request('reservation', { reservationCode: 'no-payment-data' });
    assert.equal((await paymentUnavailable.json()).data.reservation.totalPaid, null);
    const malformedPayment = await request('reservation', { reservationCode: 'malformed-payment-data' });
    assert.equal((await malformedPayment.json()).data.reservation.totalPaid, null);
    const missingReservation = await request('reservation', { reservationCode: 'missing' });
    assert.equal(missingReservation.status, 404);
    assert.equal((await missingReservation.json()).error.code, 'RESERVATION_NOT_FOUND');

    const alternativesResponse = await request('alternative', { reservationCode: 'PT-123', amenity: 'Piscina' });
    assert.equal(alternativesResponse.status, 200);
    assert.equal((await alternativesResponse.json()).data.alternatives.length, 1);
    assert.deepEqual(filterCalls.at(-1), { amenities: ['Piscina'] });
    failAvailabilityWith404 = true;
    const provider404 = await request('alternative', { reservationCode: 'PT-123' });
    assert.equal(provider404.status, 404);
    assert.equal((await provider404.json()).error.code, 'PROVIDER_RESOURCE_NOT_FOUND');
    failAvailabilityWith404 = false;

    const availabilityResponse = await request('availability', { from: '2026-11-01', to: '2026-11-03', adults: 2, children: 1, source: 'stays' });
    assert.equal(availabilityResponse.status, 200);
    assert.equal((await availabilityResponse.json()).data.period.guests, 3);
    assert.ok(staysCalls.some(([type]) => type === 'reservation'));

    const imobResponse = await request('availability', {
      from: '2026-11-01', to: '2026-11-03', adults: 2, children: 1,
      source: 'imobsys', filters: { condominio: '77', umCada: true }
    });
    assert.equal(imobResponse.status, 200);
    const imobAlternatives = (await imobResponse.json()).data.alternatives;
    assert.equal(imobAlternatives.length, 2);
    assert.equal(imobAlternatives[1].link_reserva, null);
    assert.deepEqual(imobAlternatives[1].images, ['https://images.example.test/flat.jpg']);
    assert.deepEqual(imobCalls.at(-1), { from: '2026-11-01', to: '2026-11-03', persons: 3, condominiumId: '77', onePerCondominium: true });
    assert.equal((await request('availability', {
      from: '2026-11-01', to: '2026-11-03', adults: 2, source: 'imobsys', filters: { piscina24h: true }
    })).status, 400);
    assert.equal((await request('availability', {
      from: '2026-11-01', to: '2026-11-03', adults: 2, source: 'imobsys', filters: { condominio: { id: '77' } }
    })).status, 400);
    assert.equal((await request('availability', {
      from: '2026-11-01', to: '2026-11-03', adults: 2, source: 'stays', inventory: ['unbounded']
    })).status, 400);
    assert.equal((await request('alternative', { reservationCode: 'PT-123', amenity: ['Piscina'] })).status, 400);

    let limitedResponse;
    for (let index = 0; index < 28; index += 1) limitedResponse = await request('reservation', { reservationCode: 'PT-123' });
    assert.equal(limitedResponse.status, 429);
    assert.ok(limitedResponse.headers.get('retry-after'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log('commercial-assistant.test.js: auth, validation, reservation privacy/payments, alternatives and availability passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
