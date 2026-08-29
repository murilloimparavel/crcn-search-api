const assert = require('assert/strict');
const { calculateDate } = require('../src/date-calculator');

function test(expression, referenceDate, expected) {
  const actual = calculateDate(expression, referenceDate);
  assert.equal(actual.sucesso, true, JSON.stringify(actual));
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key], value, `${expression}: ${key}`);
}

test('próxima sexta-feira', '2026-08-29', { tipo: 'data', data: '2026-09-04', dia_semana: 'sexta-feira' });
test('sexta-feira', '2026-08-28', { tipo: 'data', data: '2026-09-04' });
test('amanhã', '2026-08-29', { tipo: 'data', data: '2026-08-30' });
test('em 10 dias', '2026-08-29', { tipo: 'data', data: '2026-09-08' });
test('próxima semana', '2026-08-29', { tipo: 'intervalo', inicio: '2026-08-31', fim: '2026-09-06' });
test('este fim de semana', '2026-08-29', { tipo: 'intervalo', inicio: '2026-09-04', fim: '2026-09-06' });

const unsupported = calculateDate('mês que vem', '2026-08-29');
assert.equal(unsupported.sucesso, false);

console.log('date-calculator: all tests passed');
