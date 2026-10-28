const assert = require('node:assert/strict');
const { normalizePayment, normalizeReservation } = require('../src/reservation-normalizer');
const reservation = (channel, type = 'booked') => ({
  type, partner: { name: channel }, price: { currency: 'BRL', _f_total: 1000 },
  stats: { _f_totalPaid: 1000 }, checkInDate: '2026-11-06', checkOutDate: '2026-11-08', guests: 3
});
const listing = { _mstitle: { pt_BR: 'Apartamento QA' }, _msdesc: { pt_BR: 'Descrição QA' } };
const property = { _mstitle: { pt_BR: 'Condomínio QA' } };
for (const channel of ['API airbnb', 'Decolar', 'EXPEDIA']) {
  const payments = [{ type: 'credit', status: 'pending', _f_val: 0.01 }];
  const result = normalizeReservation({ reservation: reservation(channel), payments, listing, property });
  assert.equal(result.pagamento.status, 'pago');
  assert.equal(result.pagamento.regra_aplicada, 'a_confirmar_por_canal');
  assert.equal(result.pagamento.valor_pago_confirmado, 0); // Never fabricate completed funds.
  assert.equal(result.pagamento.valor_a_confirmar, 0.01);
  assert.equal(result.status.pode_seguir_para_voucher, true);
  for (const type of ['canceled', 'reserved']) {
    assert.equal(normalizeReservation({ reservation: reservation(channel, type), payments, listing, property }).status.pode_seguir_para_voucher, false);
  }
  assert.equal(normalizeReservation({ reservation: reservation(channel), payments, listing: null, property }).status.pode_seguir_para_voucher, false);
  assert.equal(normalizePayment(reservation(channel), null).status, 'indisponivel');
  for (const value of [0, -1, 'invalid', 'Infinity']) {
    assert.notEqual(normalizePayment(reservation(channel), [{ type: 'credit', status: 'pending', _f_val: value }]).status, 'pago');
  }
  assert.notEqual(normalizePayment(reservation(channel), [{ type: 'debit', status: 'pending', _f_val: 1000 }]).status, 'pago');
}
for (const channel of ['API booking.com', 'Booking Airbnb', 'Reserva direta', 'Outro']) {
  const result = normalizeReservation({ reservation: reservation(channel), payments: [{ type: 'credit', status: 'pending', _f_val: 1000 }], listing, property });
  assert.equal(result.pagamento.status, 'divergente');
  assert.equal(result.pagamento.regra_aplicada, null);
  assert.equal(result.status.pode_seguir_para_voucher, false);
}
console.log('reservation payment policy: channel approval, Booking exclusion and voucher safety passed');
