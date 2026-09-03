const assert = require('assert/strict');
const { calculateDate } = require('../src/date-calculator');

function test(expression, referenceDate, expected) {
  const actual = calculateDate(expression, referenceDate);
  assert.equal(actual.sucesso, true, JSON.stringify(actual));
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(actual[key], value, `${expression}: ${key} -> esperado ${JSON.stringify(value)}, recebido ${JSON.stringify(actual[key])}`);
  }
}

// 1. Testes de dias da semana e datas simples
test('próxima sexta-feira', '2026-08-29', { tipo: 'data', data: '2026-09-04', dia_semana: 'sexta-feira' });
test('sexta-feira', '2026-08-28', { tipo: 'data', data: '2026-09-04' });
test('amanhã', '2026-08-29', { tipo: 'data', data: '2026-08-30' });
test('em 10 dias', '2026-08-29', { tipo: 'data', data: '2026-09-08' });

// 2. Testes de intervalos de semana
test('próxima semana', '2026-08-29', { tipo: 'intervalo', inicio: '2026-08-31', fim: '2026-09-06', noites: 6 });
test('este fim de semana', '2026-08-29', { tipo: 'intervalo', inicio: '2026-09-04', fim: '2026-09-06', noites: 2 });
test('sexta a domingo do outro final de semana', '2026-09-02', { tipo: 'intervalo', check_in: '2026-09-11', check_out: '2026-09-13', noites: 2 });
test('sexta-feira da semana que vem a domingo', '2026-09-02', { tipo: 'intervalo', check_in: '2026-09-11', check_out: '2026-09-13', noites: 2 });

// 3. Testes de feriados nacionais
test('feriado de finados', '2026-09-02', { tipo: 'feriado', feriado: 'Finados', check_in: '2026-10-30', check_out: '2026-11-03' });
test('dia das criancas', '2026-09-02', { tipo: 'feriado', feriado: 'Nossa Senhora Aparecida / Dia das Crianças', check_in: '2026-10-09', check_out: '2026-10-13' });
test('reveillon', '2026-09-02', { tipo: 'feriado', feriado: 'Ano Novo / Réveillon', check_in: '2026-12-29', check_out: '2027-01-02' });

// 4. Testes de expressões mensais e intervalos de dias
test('25 a 30 de setembro', '2026-09-02', { tipo: 'intervalo', check_in: '2026-09-25', check_out: '2026-09-30', noites: 5 });
test('dia 10 ao dia 15 de outubro', '2026-09-02', { tipo: 'intervalo', check_in: '2026-10-10', check_out: '2026-10-15', noites: 5 });
test('primeiro fim de semana de outubro', '2026-09-02', { tipo: 'intervalo', check_in: '2026-10-02', check_out: '2026-10-04', noites: 2 });

console.log('✅ date-calculator: TODOS OS TESTES PASSARAM COM SUCESSO!');
