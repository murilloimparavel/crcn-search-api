const TIMEZONE = 'America/Sao_Paulo';

const WEEKDAYS = {
  domingo: 0,
  'segunda-feira': 1,
  segunda: 1,
  'terca-feira': 2,
  'terça-feira': 2,
  terca: 2,
  terça: 2,
  'quarta-feira': 3,
  quarta: 3,
  'quinta-feira': 4,
  quinta: 4,
  'sexta-feira': 5,
  sexta: 5,
  sabado: 6,
  sábado: 6
};

function normalizeExpression(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function weekdayName(date) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    weekday: 'long'
  }).format(date);
}

function todayInSaoPaulo(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return new Date(Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day'))));
}

function nextWeekday(baseDate, targetWeekday, forceNextWeek = false) {
  let offset = (targetWeekday - baseDate.getUTCDay() + 7) % 7;
  if (forceNextWeek || offset === 0) offset += 7;
  return addDays(baseDate, offset);
}

function nextMonday(baseDate) {
  const offset = (8 - baseDate.getUTCDay()) % 7 || 7;
  return addDays(baseDate, offset);
}

function rangeResult(expression, interpretation, start, end) {
  return {
    sucesso: true,
    expressao: expression,
    interpretacao: interpretation,
    tipo: 'intervalo',
    inicio: isoDate(start),
    fim: isoDate(end),
    dias: [isoDate(start), isoDate(end)]
  };
}

function dateResult(expression, interpretation, date) {
  return {
    sucesso: true,
    expressao: expression,
    interpretacao: interpretation,
    tipo: 'data',
    data: isoDate(date),
    dia_semana: weekdayName(date)
  };
}

function calculateDate(expression, referenceDate) {
  const normalized = normalizeExpression(expression);
  const base = referenceDate ? parseIsoDate(referenceDate) : todayInSaoPaulo();

  if (!base) {
    return { sucesso: false, erro: 'reference_date deve estar no formato YYYY-MM-DD e ser uma data válida.' };
  }
  if (!normalized) {
    return { sucesso: false, erro: 'expression é obrigatório.' };
  }

  let result;
  if (normalized === 'hoje') result = dateResult(expression, 'Data de hoje', base);
  else if (normalized === 'amanha') result = dateResult(expression, 'Dia seguinte à data de referência', addDays(base, 1));
  else if (normalized === 'depois de amanha') result = dateResult(expression, 'Dois dias após a data de referência', addDays(base, 2));
  else if (normalized === 'proxima semana' || normalized === 'semana que vem') {
    const start = nextMonday(base);
    result = rangeResult(expression, 'Próxima semana-calendário, de segunda a domingo', start, addDays(start, 6));
  } else if (normalized === 'esta semana') {
    const start = addDays(base, 1 - base.getUTCDay());
    result = rangeResult(expression, 'Semana-calendário atual, de segunda a domingo', start, addDays(start, 6));
  } else if (normalized === 'este fim de semana') {
    const friday = nextWeekday(base, 5, base.getUTCDay() === 0);
    result = rangeResult(expression, 'Próximo período de sexta a domingo', friday, addDays(friday, 2));
  } else if (normalized === 'proximo fim de semana') {
    const friday = nextWeekday(base, 5, true);
    result = rangeResult(expression, 'Fim de semana seguinte, de sexta a domingo', friday, addDays(friday, 2));
  } else {
    const daysMatch = normalized.match(/^em (\d{1,3}) dias?$/);
    const weekdayMatch = normalized.match(/^(proxima |proximo )?(domingo|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado)$/);

    if (daysMatch) {
      const days = Number(daysMatch[1]);
      result = dateResult(expression, `${days} dia(s) após a data de referência`, addDays(base, days));
    } else if (weekdayMatch) {
      const target = WEEKDAYS[weekdayMatch[2]];
      result = dateResult(expression, `Próxima ocorrência de ${weekdayMatch[2]}`, nextWeekday(base, target));
    } else {
      return {
        sucesso: false,
        erro: 'Expressão não suportada. Use hoje, amanhã, depois de amanhã, próxima semana, este fim de semana, próxima sexta-feira ou em N dias.',
        expressoes_suportadas: ['hoje', 'amanhã', 'depois de amanhã', 'próxima semana', 'esta semana', 'este fim de semana', 'próximo fim de semana', 'próxima sexta-feira', 'em 3 dias']
      };
    }
  }

  return {
    ...result,
    timezone: TIMEZONE,
    data_referencia: isoDate(base),
    dia_semana_referencia: weekdayName(base)
  };
}

module.exports = { calculateDate, todayInSaoPaulo };
