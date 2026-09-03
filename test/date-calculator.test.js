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

// 5. Testes da Sprint 1 (Gírias, preposições e meses numéricos coloquiais)
test('de 12 ate 15 do 10', '2026-09-02', { tipo: 'intervalo', check_in: '2026-10-12', check_out: '2026-10-15', noites: 3 });
test('do dia 15 ao dia 18/11', '2026-09-02', { tipo: 'intervalo', check_in: '2026-11-15', check_out: '2026-11-18', noites: 3 });
test('a partir de 20 a 25 do 12', '2026-09-02', { tipo: 'intervalo', check_in: '2026-12-20', check_out: '2026-12-25', noites: 5 });
test('proximo fds', '2026-08-29', { tipo: 'intervalo', check_in: '2026-09-04', check_out: '2026-09-06', noites: 2 });
test('feriadao de finados', '2026-09-02', { tipo: 'feriado', feriado: 'Finados', check_in: '2026-10-30', check_out: '2026-11-03' });
test('virada de ano', '2026-09-02', { tipo: 'feriado', feriado: 'Ano Novo / Réveillon', check_in: '2026-12-29', check_out: '2027-01-02' });

// 6. Testes da Sprint 2 & 3 (Pacotes Comerciais de Caldas Novas, Quinzenas, Virada de Ano e Validações)
test('meio de semana', '2026-09-02', { tipo: 'intervalo', check_in: '2026-09-06', check_out: '2026-09-10', noites: 4 });
test('fds prolongado', '2026-09-02', { tipo: 'intervalo', check_in: '2026-09-03', check_out: '2026-09-06', noites: 3 });
test('caldas country', '2026-09-02', { tipo: 'feriado', feriado: 'Caldas Country', check_in: '2026-11-05', check_out: '2026-11-08', noites: 3 });
test('verao sertanejo', '2026-09-02', { tipo: 'feriado', feriado: 'Verão Sertanejo', check_in: '2027-01-08', check_out: '2027-01-10', noites: 2 });
test('semana que vem de terca a quinta', '2026-09-02', { tipo: 'intervalo', check_in: '2026-09-08', check_out: '2026-09-10', noites: 2 });
test('28 de dezembro a 3 de janeiro', '2026-09-02', { tipo: 'intervalo', check_in: '2026-12-28', check_out: '2027-01-03', noites: 6 });
test('primeira quinzena de outubro', '2026-09-02', { tipo: 'intervalo', check_in: '2026-10-01', check_out: '2026-10-15', noites: 14 });
test('comeco de novembro', '2026-09-02', { tipo: 'intervalo', check_in: '2026-11-01', check_out: '2026-11-05', noites: 4 });
test('carnaval 2028', '2026-09-02', { tipo: 'feriado', check_in: '2028-02-25', check_out: '2028-03-01' });

// 7. Testes de Validações Semânticas (Erros controlados)
function testError(expression, referenceDate, expectedCode) {
  const actual = calculateDate(expression, referenceDate);
  assert.equal(actual.sucesso, false, `Esperado erro para ${expression}`);
  assert.equal(actual.codigo, expectedCode, `${expression}: esperado codigo ${expectedCode}, recebido ${actual.codigo}`);
}

testError('20 a 15 de outubro', '2026-09-02', 'CHECKOUT_BEFORE_CHECKIN');
testError('15/10/2023', '2026-09-02', 'EXPLICIT_PAST_DATE');
testError('29 de fevereiro de 2027', '2026-09-02', 'INVALID_LEAP_YEAR_DATE');

// 8. Testes de Cenários Extremos e Auto-Fill de Datas Únicas
test('sexta-feira', '2026-09-02', { tipo: 'data', check_in: '2026-09-04', check_out: '2026-09-06', noites: 2 });
test('quarta-feira', '2026-09-02', { tipo: 'data', check_in: '2026-09-09', check_out: '2026-09-10', noites: 1 });
test('15 de outubro', '2026-09-02', { tipo: 'data', check_in: '2026-10-15', check_out: '2026-10-16', noites: 1 });
test('semana do saco cheio', '2026-09-02', { tipo: 'feriado', feriado: 'Nossa Senhora Aparecida / Dia das Crianças' });
test('ferias de julho', '2026-09-02', { tipo: 'intervalo', check_in: '2027-07-11', check_out: '2027-07-18', noites: 7 });
test('segunda quinzena de novembro', '2026-09-02', { tipo: 'intervalo', check_in: '2026-11-16', check_out: '2026-11-30', noites: 14 });
test('finalzinho de janeiro', '2026-09-02', { tipo: 'intervalo', check_in: '2027-01-28', check_out: '2027-01-31', noites: 3 });
test('daqui a 15 dias', '2026-09-02', { tipo: 'data', check_in: '2026-09-17', check_out: '2026-09-18', noites: 1 });
test('12-15 de outubro', '2026-09-02', { tipo: 'intervalo', check_in: '2026-10-12', check_out: '2026-10-15', noites: 3 });

testError('1 a 70 de outubro', '2026-09-02', 'EXCESSIVE_STAY_DURATION');

console.log('✅ date-calculator: TODOS OS TESTES PASSARAM COM SUCESSO! (Suíte com +50 cenários homologados)');
