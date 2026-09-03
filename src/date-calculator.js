const TIMEZONE = 'America/Sao_Paulo';

const WEEKDAYS = {
  domingo: 0, dom: 0,
  'segunda-feira': 1, segunda: 1, seg: 1,
  'terca-feira': 2, 'terça-feira': 2, terca: 2, terça: 2, ter: 2,
  'quarta-feira': 3, quarta: 3, qua: 3,
  'quinta-feira': 4, quinta: 4, qui: 4,
  'sexta-feira': 5, sexta: 5, sex: 5,
  sabado: 6, sábado: 6, sab: 6
};

const MONTHS = {
  janeiro: 1, jan: 1,
  fevereiro: 2, fev: 2,
  marco: 3, março: 3, mar: 3,
  abril: 4, abr: 4,
  maio: 5, mai: 5,
  junho: 6, jun: 6,
  julho: 7, jul: 7,
  agosto: 8, ago: 8,
  setembro: 9, set: 9,
  outubro: 10, out: 10,
  novembro: 11, nov: 11,
  dezembro: 12, dez: 12
};

const ORDINAL_NUMBERS = {
  primeiro: 1, primeira: 1, '1o': 1, '1a': 1, '1º': 1, '1ª': 1,
  segundo: 2, segunda: 2, '2o': 2, '2a': 2, '2º': 2, '2ª': 2,
  terceiro: 3, terceira: 3, '3o': 3, '3a': 3, '3º': 3, '3ª': 3,
  quarto: 4, quarta: 4, '4o': 4, '4a': 4, '4º': 4, '4ª': 4,
  quinto: 5, quinta: 5, '5o': 5, '5a': 5, '5º': 5, '5ª': 5,
  ultimo: 'last', última: 'last', ultima: 'last', último: 'last'
};

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

function validateStrictDate(year, month, day) {
  if (month === 2 && day === 29 && !isLeapYear(year)) {
    throw {
      sucesso: false,
      codigo: 'INVALID_LEAP_YEAR_DATE',
      instrucao_para_o_agente: `O ano de ${year} não é bissexto, portanto não possui o dia 29 de fevereiro.`,
      sugestao_de_fala: `O ano de ${year} não é bissexto e não tem 29 de fevereiro. Poderia confirmar a data desejada?`
    };
  }
}

// Algoritmo de Gauss / Meeus para cálculo da Páscoa e feriados móveis
function getEasterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function getHolidaysForYear(year) {
  const easter = getEasterSunday(year);
  
  // Feriados móveis relativos à Páscoa
  const carnavalFriday = addDays(easter, -51); // Sexta de carnaval
  const carnavalTuesday = addDays(easter, -47); // Terça de carnaval
  const paixaoCristo = addDays(easter, -2);    // Sexta-feira Santa
  const corpusChristi = addDays(easter, 60);    // Quinta-feira de Corpus Christi

  // Eventos Regionais de Caldas Novas
  const firstNov = new Date(Date.UTC(year, 10, 1));
  const caldasCountryFriday = addDays(firstNov, (5 - firstNov.getUTCDay() + 7) % 7);
  const caldasCountryThursday = addDays(caldasCountryFriday, -1);
  const caldasCountrySunday = addDays(caldasCountryFriday, 2);

  const firstJan = new Date(Date.UTC(year, 0, 1));
  const veraoSertanejoFriday = addDays(firstJan, ((5 - firstJan.getUTCDay() + 7) % 7) + 7);
  const veraoSertanejoSunday = addDays(veraoSertanejoFriday, 2);

  return [
    {
      nome: 'Ano Novo / Réveillon',
      slug: 'reveillon',
      aliases: ['ano novo', 'reveillon', 'reveilon', 'virada de ano', 'passagem de ano', 'virada'],
      check_in: new Date(Date.UTC(year, 11, 29)),
      check_out: new Date(Date.UTC(year + 1, 0, 2)),
      descricao: 'Pacote de Réveillon / Virada de Ano'
    },
    {
      nome: 'Carnaval',
      slug: 'carnaval',
      aliases: ['carnaval', 'feriado de carnaval', 'carnavrau'],
      check_in: carnavalFriday,
      check_out: addDays(carnavalTuesday, 1),
      descricao: 'Pacote de Carnaval (Sexta a Quarta de Cinzas)'
    },
    {
      nome: 'Semana Santa / Páscoa',
      slug: 'semana-santa',
      aliases: ['semana santa', 'pascoa', 'páscoa', 'sexta feira santa', 'feriado da pascoa'],
      check_in: addDays(paixaoCristo, -1),
      check_out: addDays(easter, 1),
      descricao: 'Feriado de Semana Santa e Páscoa'
    },
    {
      nome: 'Tiradentes',
      slug: 'tiradentes',
      aliases: ['tiradentes', 'feriado de tiradentes', '21 de abril'],
      check_in: getHolidayPackage(new Date(Date.UTC(year, 3, 21))).start,
      check_out: getHolidayPackage(new Date(Date.UTC(year, 3, 21))).end,
      descricao: 'Feriado de Tiradentes (21 de Abril)'
    },
    {
      nome: 'Dia do Trabalho',
      slug: 'dia-do-trabalho',
      aliases: ['dia do trabalho', 'dia do trabalhador', '1 de maio', 'primeiro de maio'],
      check_in: getHolidayPackage(new Date(Date.UTC(year, 4, 1))).start,
      check_out: getHolidayPackage(new Date(Date.UTC(year, 4, 1))).end,
      descricao: 'Feriado do Dia do Trabalho (01 de Maio)'
    },
    {
      nome: 'Corpus Christi',
      slug: 'corpus-christi',
      aliases: ['corpus christi', 'corpus cristi', 'feriado de corpus christi'],
      check_in: corpusChristi,
      check_out: addDays(corpusChristi, 3),
      descricao: 'Feriado prolongado de Corpus Christi (Quinta a Domingo)'
    },
    {
      nome: 'Independência do Brasil',
      slug: 'independencia',
      aliases: ['independencia', 'independência', '7 de setembro', 'sete de setembro', 'feriado da independencia'],
      check_in: getHolidayPackage(new Date(Date.UTC(year, 8, 7))).start,
      check_out: getHolidayPackage(new Date(Date.UTC(year, 8, 7))).end,
      descricao: 'Feriado da Independência do Brasil (07 de Setembro)'
    },
    {
      nome: 'Nossa Senhora Aparecida / Dia das Crianças',
      slug: 'dia-das-criancas',
      aliases: ['dia das criancas', 'dia das crianças', 'nossa senhora aparecida', 'aparecida', '12 de outubro', 'semana do saco cheio', 'saco cheio', 'outubro das criancas'],
      check_in: getHolidayPackage(new Date(Date.UTC(year, 9, 12))).start,
      check_out: getHolidayPackage(new Date(Date.UTC(year, 9, 12))).end,
      descricao: 'Feriado de N. Sra. Aparecida / Dia das Crianças / Saco Cheio'
    },
    {
      nome: 'Finados',
      slug: 'finados',
      aliases: ['finados', 'feriado de finados', '2 de novembro', 'dois de novembro'],
      check_in: getHolidayPackage(new Date(Date.UTC(year, 10, 2))).start,
      check_out: getHolidayPackage(new Date(Date.UTC(year, 10, 2))).end,
      descricao: 'Feriado de Finados (02 de Novembro)'
    },
    {
      nome: 'Caldas Country',
      slug: 'caldas-country',
      aliases: ['caldas country', 'festival caldas country', 'fds caldas country', 'show caldas country'],
      check_in: caldasCountryThursday,
      check_out: caldasCountrySunday,
      descricao: 'Caldas Country Festival (1º Fim de Semana Prolongado de Novembro)'
    },
    {
      nome: 'Proclamação da República',
      slug: 'proclamacao-da-republica',
      aliases: ['proclamacao da republica', 'proclamação da república', '15 de novembro', 'quinze de novembro'],
      check_in: getHolidayPackage(new Date(Date.UTC(year, 10, 15))).start,
      check_out: getHolidayPackage(new Date(Date.UTC(year, 10, 15))).end,
      descricao: 'Feriado da Proclamação da República (15 de Novembro)'
    },
    {
      nome: 'Consciência Negra',
      slug: 'consciencia-negra',
      aliases: ['consciencia negra', 'consciência negra', '20 de novembro', 'vinte de novembro'],
      check_in: getHolidayPackage(new Date(Date.UTC(year, 10, 20))).start,
      check_out: getHolidayPackage(new Date(Date.UTC(year, 10, 20))).end,
      descricao: 'Feriado da Consciência Negra (20 de Novembro)'
    },
    {
      nome: 'Verão Sertanejo',
      slug: 'verao-sertanejo',
      aliases: ['verao sertanejo', 'verão sertanejo', 'festival verao sertanejo'],
      check_in: veraoSertanejoFriday,
      check_out: veraoSertanejoSunday,
      descricao: 'Festival Verão Sertanejo (2º Fim de Semana de Janeiro)'
    },
    {
      nome: 'Natal',
      slug: 'natal',
      aliases: ['natal', 'feriado de natal', 'noite de natal'],
      check_in: new Date(Date.UTC(year, 11, 23)),
      check_out: new Date(Date.UTC(year, 11, 26)),
      descricao: 'Feriado de Natal (23 a 26 de Dezembro)'
    }
  ];
}

function getHolidayPackage(holidayDate) {
  const dayOfWeek = holidayDate.getUTCDay();
  let start = new Date(holidayDate.getTime());
  let end = new Date(holidayDate.getTime());

  if (dayOfWeek === 1) {
    start = addDays(holidayDate, -3);
    end = addDays(holidayDate, 1);
  } else if (dayOfWeek === 2) {
    start = addDays(holidayDate, -4);
    end = addDays(holidayDate, 1);
  } else if (dayOfWeek === 4) {
    start = holidayDate;
    end = addDays(holidayDate, 3);
  } else if (dayOfWeek === 5) {
    start = holidayDate;
    end = addDays(holidayDate, 2);
  } else {
    start = addDays(holidayDate, -1);
    end = addDays(holidayDate, 2);
  }

  return { start, end };
}

function normalizeText(val) {
  let text = String(val || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');

  // 1. Substituição de gírias, dias abreviados e termos turísticos
  text = text
    .replace(/\bprox\s+fds\b/g, 'proximo fim de semana')
    .replace(/\boutro\s+fds\b/g, 'outro fim de semana')
    .replace(/\bfds\b/g, 'fim de semana')
    .replace(/\bferiadao\b/g, 'feriado prolongado')
    .replace(/\bvirada\s+de\s+ano\b/g, 'reveillon')
    .replace(/\bvirada\b/g, 'reveillon')
    .replace(/\bpassagem\s+de\s+ano\b/g, 'reveillon')
    .replace(/\bfinal\s+de\s+semana\b/g, 'fim de semana')
    .replace(/(\d+)\s*-\s*(\d+)/g, '$1 a $2');

  // 2. Normalização de contrações de mês numérico: "do 10", "do 09", "de 10" -> "de outubro", "de setembro"
  const MONTH_NAMES_BY_NUM = {
    1: 'janeiro', 2: 'fevereiro', 3: 'marco', 4: 'abril', 5: 'maio', 6: 'junho',
    7: 'julho', 8: 'agosto', 9: 'setembro', 10: 'outubro', 11: 'novembro', 12: 'dezembro'
  };

  text = text.replace(/(?:do|de|no)\s+(\d{1,2})\b/g, (match, numStr, offset, fullStr) => {
    const num = Number(numStr);
    if (num >= 1 && num <= 12 && offset > 0) {
      const before = fullStr.slice(0, offset);
      if (/\d+\s*(?:a|ate|ao|e|-)?\s*$/.test(before) || /\d+$/.test(before)) {
        return `de ${MONTH_NAMES_BY_NUM[num]}`;
      }
    }
    return match;
  });

  // 3. Limpeza de prefixos/preposições iniciais que atrapalham o parser de intervalo
  text = text
    .replace(/^(?:a\s+partir\s+de|a\s+partir\s+do\s+dia|desde\s+o\s+dia|desde|no\s+dia|do\s+dia|de\s+o\s+dia|de)\s+/i, '')
    .replace(/^(?:quero\s+viajar\s+em|quero\s+ir\s+em|quero\s+reserva\s+para|reserva\s+para|para\s+o\s+dia|para\s+o|para|pro\s+dia|pro)\s+/i, '');

  return text.trim();
}

function getNowBRT(customDate) {
  let dateObj;
  if (customDate) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(customDate)) {
      const [y, m, d] = customDate.split('-').map(Number);
      dateObj = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    } else {
      dateObj = new Date(customDate);
    }
  } else {
    dateObj = new Date();
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(dateObj);
  const get = (type) => parts.find((p) => p.type === type)?.value;

  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hour = get('hour') || '12';
  const minute = get('minute') || '00';

  const utcMidnight = new Date(Date.UTC(year, month - 1, day));
  return {
    dateObj: utcMidnight,
    year,
    month,
    day,
    hour,
    minute,
    iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    timeStr: `${hour}:${minute}`
  };
}

function formatISODate(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(d, days) {
  const res = new Date(d.getTime());
  res.setUTCDate(res.getUTCDate() + days);
  return res;
}

function weekdayName(d) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    weekday: 'long'
  }).format(d);
}

function parseExactIso(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

function parseSingleDate(token, baseDate, currentYear) {
  const norm = normalizeText(token);
  if (!norm) return null;

  // 1. ISO YYYY-MM-DD
  const isoMatch = norm.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const yr = Number(isoMatch[1]);
    const mo = Number(isoMatch[2]);
    const da = Number(isoMatch[3]);
    validateStrictDate(yr, mo, da);
    return parseExactIso(`${yr}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`);
  }

  // 2. DD/MM/YYYY ou DD/MM
  const slashMatch = norm.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]);
    const isYearExplicit = Boolean(slashMatch[3]);
    let yr = isYearExplicit ? Number(slashMatch[3]) : currentYear;
    if (yr < 100) yr += 2000;
    
    validateStrictDate(yr, month, day);
    const dt = new Date(Date.UTC(yr, month - 1, day));
    if (dt < baseDate && !isYearExplicit) {
      dt.setUTCFullYear(yr + 1);
      validateStrictDate(yr + 1, month, day);
    } else if (dt < baseDate && isYearExplicit) {
      throw {
        sucesso: false,
        codigo: 'EXPLICIT_PAST_DATE',
        instrucao_para_o_agente: 'O usuário forneceu expressamente um ano no passado. Informe que apenas reservas futuras são permitidas.',
        sugestao_de_fala: `Você mencionou o ano de ${yr}, mas só realizamos reservas para datas futuras. Qual seria a data da sua viagem?`
      };
    }
    return dt;
  }

  // 3. DD de Mês (ex: 15 de setembro, 12 de out, 15 de nov de 2027)
  const monthNameMatch = norm.match(/^(\d{1,2})(?:\s*(?:de)?\s*([a-z]+))(?:\s*(?:de)?\s*(\d{4}))?$/);
  if (monthNameMatch && MONTHS[monthNameMatch[2]]) {
    const day = Number(monthNameMatch[1]);
    const month = MONTHS[monthNameMatch[2]];
    const isYearExplicit = Boolean(monthNameMatch[3]);
    const yr = isYearExplicit ? Number(monthNameMatch[3]) : currentYear;
    
    validateStrictDate(yr, month, day);
    const dt = new Date(Date.UTC(yr, month - 1, day));
    if (dt < baseDate && !isYearExplicit) {
      dt.setUTCFullYear(yr + 1);
      validateStrictDate(yr + 1, month, day);
    } else if (dt < baseDate && isYearExplicit) {
      throw {
        sucesso: false,
        codigo: 'EXPLICIT_PAST_DATE',
        instrucao_para_o_agente: 'O usuário forneceu expressamente um ano no passado.',
        sugestao_de_fala: `Você mencionou o ano de ${yr}, mas só realizamos reservas para datas futuras. Qual seria a data da sua viagem?`
      };
    }
    return dt;
  }

  // 4. "em N dias" ou "daqui a N dias"
  const inDaysMatch = norm.match(/^(?:em|daqui\s+a)\s+(\d{1,3})\s+dias?$/);
  if (inDaysMatch) {
    return addDays(baseDate, Number(inDaysMatch[1]));
  }

  // 5. Termos relativos simples
  if (norm === 'hoje') return baseDate;
  if (norm === 'amanha' || norm === 'amanhã') return addDays(baseDate, 1);
  if (norm === 'depois de amanha' || norm === 'depois de amanhã') return addDays(baseDate, 2);

  // 6. Dias da semana (com deslocamentos)
  const isOutro = norm.includes('outro') || norm.includes('outra');
  const isSemanaQueVem = norm.includes('semana que vem') || norm.includes('proxima semana') || norm.includes('seguinte');

  for (const [name, targetDay] of Object.entries(WEEKDAYS)) {
    if (norm === name || norm.startsWith(`${name} `) || norm.endsWith(` ${name}`) || norm.includes(` ${name} `)) {
      let daysAhead = (targetDay - baseDate.getUTCDay() + 7) % 7;
      if (daysAhead === 0) daysAhead = 7;

      if (isOutro) {
        // "Outro" = pula o próximo e vai para o subsequente (+7 dias)
        return addDays(baseDate, daysAhead + 7);
      } else if (isSemanaQueVem) {
        // "Semana que vem" = se o dia mais próximo for esta semana (<7), joga para a semana que vem (+7 dias)
        const daysToNextMonday = (8 - baseDate.getUTCDay()) % 7 || 7;
        const nextMonday = addDays(baseDate, daysToNextMonday);
        const dayOffset = targetDay === 0 ? 6 : targetDay - 1;
        return addDays(nextMonday, dayOffset);
      }

      return addDays(baseDate, daysAhead);
    }
  }

  return null;
}

function calculateDate(expression, referenceDate) {
  const clock = getNowBRT(referenceDate);
  const base = clock.dateObj;
  const raw = String(expression || '').trim();
  const norm = normalizeText(raw);

  const metaClock = {
    data_hoje: clock.iso,
    dia_semana: weekdayName(base),
    hora_brasilia: clock.timeStr,
    timezone: TIMEZONE,
    ano_corrente: clock.year
  };

  if (!raw || norm === 'hoje' || norm === 'data atual' || norm === 'agora' || norm === 'que dia e hoje') {
    return {
      sucesso: true,
      tipo: 'relogio_atual',
      data: clock.iso,
      check_in: clock.iso,
      check_out: formatISODate(addDays(base, 1)),
      noites: 1,
      dia_semana: weekdayName(base),
      dia_semana_checkin: weekdayName(base),
      dia_semana_checkout: weekdayName(addDays(base, 1)),
      relogio: metaClock,
      mensagem: `Hoje é ${metaClock.dia_semana}, ${clock.day.toString().padStart(2, '0')}/${clock.month.toString().padStart(2, '0')}/${clock.year}, às ${clock.timeStr} (Horário de Brasília).`,
      resumo_legivel: `Hoje é ${metaClock.dia_semana}, ${clock.day.toString().padStart(2, '0')}/${clock.month.toString().padStart(2, '0')}/${clock.year}`,
      pronto_para_busca: {
        from: clock.iso,
        to: formatISODate(addDays(base, 1))
      }
    };
  }

  try {
    // 1. CHECAGEM DE FERIADOS DINÂMICOS & GRANDES EVENTOS DE CALDAS NOVAS
    const extractedYearMatch = norm.match(/\b(20\d{2})\b/);
    const targetYear = extractedYearMatch ? Number(extractedYearMatch[1]) : clock.year;
    
    const targetHolidays = getHolidaysForYear(targetYear);
    const nextYearHolidays = getHolidaysForYear(targetYear + 1);
    const allHolidays = [...targetHolidays, ...nextYearHolidays];

    for (const h of allHolidays) {
      for (const alias of h.aliases) {
        if (norm.includes(alias)) {
          let holidayObj = h;
          if (h.check_out < base && !extractedYearMatch) {
            const foundNext = nextYearHolidays.find((x) => x.slug === h.slug);
            if (foundNext) holidayObj = foundNext;
          }

          const startIso = formatISODate(holidayObj.check_in);
          const endIso = formatISODate(holidayObj.check_out);
          const diffMs = holidayObj.check_out.getTime() - holidayObj.check_in.getTime();
          const noites = Math.round(diffMs / (1000 * 60 * 60 * 24));
          const startDay = weekdayName(holidayObj.check_in);
          const endDay = weekdayName(holidayObj.check_out);
          const startBR = `${holidayObj.check_in.getUTCDate().toString().padStart(2, '0')}/${(holidayObj.check_in.getUTCMonth() + 1).toString().padStart(2, '0')}/${holidayObj.check_in.getUTCFullYear()}`;
          const endBR = `${holidayObj.check_out.getUTCDate().toString().padStart(2, '0')}/${(holidayObj.check_out.getUTCMonth() + 1).toString().padStart(2, '0')}/${holidayObj.check_out.getUTCFullYear()}`;

          return {
            sucesso: true,
            tipo: 'feriado',
            feriado: holidayObj.nome,
            relogio: metaClock,
            check_in: startIso,
            check_out: endIso,
            inicio: startIso,
            fim: endIso,
            dia_semana_checkin: startDay,
            dia_semana_checkout: endDay,
            noites: noites,
            eh_alta_temporada: true,
            resumo_legivel: `De ${startDay}, ${startBR} até ${endDay}, ${endBR} (${holidayObj.nome} - ${noites} ${noites === 1 ? 'diária' : 'diárias'})`,
            pronto_para_busca: {
              from: startIso,
              to: endIso
            }
          };
        }
      }
    }

    // 2. DETECÇÃO DE PACOTES COMERCIAIS & EXPRESSÕES COLOQUIAIS
    let startDate = null;
    let endDate = null;
    let isExplicitInterval = false;

    // 2.1 Meio de Semana / Semana Econômica em Caldas Novas (Domingo a Quinta - 4 noites)
    if (/^(?:meio\s+de\s+semana|durante\s+a\s+semana|semana\s+economica|semana\s+econômica)$/i.test(norm)) {
      let daysToSunday = (7 - base.getUTCDay()) % 7;
      if (daysToSunday === 0) daysToSunday = 7;
      startDate = addDays(base, daysToSunday);
      endDate = addDays(startDate, 4);
      isExplicitInterval = true;
    }
    // 2.2 Fim de Semana Prolongado / Estendido (Quinta a Domingo - 3 noites)
    else if (/^(?:fim\s+de\s+semana\s+prolongado|fds\s+prolongado|fim\s+de\s+semana\s+estendido|fds\s+estendido)$/i.test(norm)) {
      let daysToThursday = (4 - base.getUTCDay() + 7) % 7;
      if (daysToThursday === 0) daysToThursday = 7;
      startDate = addDays(base, daysToThursday);
      endDate = addDays(startDate, 3);
      isExplicitInterval = true;
    }
    // 2.3 Férias de Julho ou Janeiro (Pacote de 7 noites na 2ª semana)
    else if (/^(?:ferias\s+de\s+(janeiro|julho)|férias\s+de\s+(janeiro|julho)|semana\s+de\s+ferias|semana\s+de\s+férias)$/i.test(norm)) {
      const feriasMatch = norm.match(/(?:janeiro|julho)/i);
      let mesFerias = feriasMatch ? (feriasMatch[0] === 'julho' ? 7 : 1) : (clock.month >= 6 && clock.month <= 8 ? 7 : 1);
      let anoFerias = clock.year;
      if (mesFerias < clock.month) anoFerias++;
      
      const firstDay = new Date(Date.UTC(anoFerias, mesFerias - 1, 1));
      const firstSundayOffset = (7 - firstDay.getUTCDay()) % 7;
      startDate = addDays(firstDay, firstSundayOffset + 7);
      endDate = addDays(startDate, 7);
      isExplicitInterval = true;
    }
    // 2.4 Expressões de posição mensal (ex: "primeiro fim de semana de outubro", "último fds de novembro")
    else if (/^(primeiro|primeira|segundo|segunda|terceiro|terceira|quarto|quarta|quinto|quinta|ultimo|último|ultima|última)\s+f(?:im|inal)\s+de\s+semana\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?$/i.test(norm)) {
      const match = norm.match(/^(primeiro|primeira|segundo|segunda|terceiro|terceira|quarto|quarta|quinto|quinta|ultimo|último|ultima|última)\s+f(?:im|inal)\s+de\s+semana\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?$/i);
      const position = ORDINAL_NUMBERS[normalizeText(match[1])];
      const month = MONTHS[normalizeText(match[2])];
      let yr = match[3] ? Number(match[3]) : clock.year;
      if (month < clock.month && !match[3]) yr++;

      const fridays = [];
      const d = new Date(Date.UTC(yr, month - 1, 1));
      while (d.getUTCMonth() === month - 1) {
        if (d.getUTCDay() === 5) fridays.push(new Date(d.getTime()));
        d.setUTCDate(d.getUTCDate() + 1);
      }

      let targetFriday;
      if (position === 'last') targetFriday = fridays[fridays.length - 1];
      else if (typeof position === 'number') targetFriday = fridays[position - 1] || fridays[fridays.length - 1];

      if (targetFriday) {
        startDate = targetFriday;
        endDate = addDays(startDate, 2);
        isExplicitInterval = true;
      }
    }
    // 2.5 Expressões de quinzenas e períodos ("começo de outubro", "meio de novembro", "primeira quinzena de dezembro")
    else if (/^(comeco|inicio|início|meio|fim|final|finalzinho|primeira\s+quinzena|segunda\s+quinzena)\s+(?:de\s+)?([a-z]+)(?:\s+de\s+(\d{4}))?$/i.test(norm)) {
      const match = norm.match(/^(comeco|inicio|início|meio|fim|final|finalzinho|primeira\s+quinzena|segunda\s+quinzena)\s+(?:de\s+)?([a-z]+)(?:\s+de\s+(\d{4}))?$/i);
      const term = normalizeText(match[1]);
      const month = MONTHS[normalizeText(match[2])];
      let yr = match[3] ? Number(match[3]) : clock.year;
      if (month < clock.month && !match[3]) yr++;

      const lastDayOfMonth = new Date(Date.UTC(yr, month, 0)).getUTCDate();

      if (term === 'comeco' || term === 'inicio') {
        startDate = new Date(Date.UTC(yr, month - 1, 1));
        endDate = new Date(Date.UTC(yr, month - 1, 5));
      } else if (term === 'meio') {
        startDate = new Date(Date.UTC(yr, month - 1, 14));
        endDate = new Date(Date.UTC(yr, month - 1, 16));
      } else if (term === 'fim' || term === 'final' || term === 'finalzinho') {
        startDate = new Date(Date.UTC(yr, month - 1, lastDayOfMonth - 3));
        endDate = new Date(Date.UTC(yr, month - 1, lastDayOfMonth));
      } else if (term === 'primeira quinzena') {
        startDate = new Date(Date.UTC(yr, month - 1, 1));
        endDate = new Date(Date.UTC(yr, month - 1, 15));
      } else if (term === 'segunda quinzena') {
        startDate = new Date(Date.UTC(yr, month - 1, 16));
        endDate = new Date(Date.UTC(yr, month - 1, lastDayOfMonth));
      }
      isExplicitInterval = true;
    }

    // 3. DETECTAR INTERVALOS EXPLÍCITOS ("X a Y", "X ate Y", "semana que vem de terca a quinta", etc.)
    if (!startDate) {
      if (/^(?:em|daqui\s+a)\s+\d+\s+dias?$/i.test(norm)) {
        startDate = parseSingleDate(norm, base, clock.year);
      } else {
        const intervalRegex = /^(?:(?:na\s+|da\s+)?semana\s+que\s+vem\s+de\s+|(?:na\s+|da\s+)?proxima\s+semana\s+de\s+)?(.+?)\s+(?:ate\s+o\s+dia|ate\s+a|ate\s+o|ate|ao\s+dia|ao|a\s+o\s+dia|a|e|-)\s+(.+)$/i;
        const match = norm.match(intervalRegex);

      if (match) {
        isExplicitInterval = true;
        let startStr = match[1].replace(/^dia\s+/i, '').trim();
        let endStr = match[2].replace(/^dia\s+/i, '').trim();

        // Se a expressão começou com "semana que vem de terca a quinta"
        if (norm.includes('semana que vem') || norm.includes('proxima semana')) {
          if (!startStr.includes('semana que vem') && !startStr.includes('proxim')) startStr += ' da semana que vem';
          if (!endStr.includes('semana que vem') && !endStr.includes('proxim')) endStr += ' da semana que vem';
        }

        // Herança de mês por extenso ("25 a 30 de setembro")
        const endMonthMatch = endStr.match(/^(\d{1,2})\s+(?:de\s+)?([a-z]+)(?:\s+(?:de\s+)?(\d{4}))?$/i);
        const endSlashMatch = endStr.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
        const startNumberMatch = startStr.match(/^(\d{1,2})$/i);

        if (startNumberMatch && endMonthMatch && MONTHS[normalizeText(endMonthMatch[2])]) {
          const monthPart = endMonthMatch[2];
          const yearPart = endMonthMatch[3] ? ` de ${endMonthMatch[3]}` : '';
          startStr = `${startNumberMatch[1]} de ${monthPart}${yearPart}`;
        } else if (startNumberMatch && endSlashMatch) {
          const monthPart = endSlashMatch[2];
          const yearPart = endSlashMatch[3] ? `/${endSlashMatch[3]}` : '';
          startStr = `${startNumberMatch[1]}/${monthPart}${yearPart}`;
        }

        if (endStr.includes('outro fim de semana') || endStr.includes('outra semana')) {
          if (!startStr.includes('outro')) startStr += ' do outro fim de semana';
          if (!endStr.includes('outro')) endStr += ' do outro fim de semana';
        } else if (endStr.includes('semana que vem') || endStr.includes('proxima semana') || endStr.includes('proximo fim de semana')) {
          if (!startStr.includes('semana que vem') && !startStr.includes('proxim')) startStr += ' da semana que vem';
          if (!endStr.includes('semana que vem') && !endStr.includes('proxim')) endStr += ' da semana que vem';
        }

        startDate = parseSingleDate(startStr, base, clock.year);
        endDate = parseSingleDate(endStr, base, clock.year);

        // Tratamento de virada de ano apenas quando os meses são diferentes (ex: 28 de dez a 3 de jan)
        if (startDate && endDate && endDate <= startDate) {
          if (startDate.getUTCMonth() > endDate.getUTCMonth()) {
            endDate.setUTCFullYear(endDate.getUTCFullYear() + 1);
          }
        }
      } else if (norm === 'proxima semana' || norm === 'semana que vem') {
        isExplicitInterval = true;
        const offset = (8 - base.getUTCDay()) % 7 || 7;
        startDate = addDays(base, offset);
        endDate = addDays(startDate, 6);
      } else if (norm === 'esta semana') {
        isExplicitInterval = true;
        startDate = addDays(base, 1 - base.getUTCDay());
        endDate = addDays(startDate, 6);
      } else if (norm.includes('fim de semana') || norm.includes('final de semana')) {
        isExplicitInterval = true;
        const isOutro = norm.includes('outro') || norm.includes('outra');
        const isProximo = norm.includes('proximo') || norm.includes('próximo') || norm.includes('semana que vem');
        const isEste = norm.includes('este') || norm.includes('esse') || norm.includes('atual');

        let daysToFriday;
        if (base.getUTCDay() === 6) {
          daysToFriday = isOutro ? 13 : 6;
        } else if (base.getUTCDay() === 0) {
          daysToFriday = isOutro ? 12 : 5;
        } else if (base.getUTCDay() === 5) {
          daysToFriday = (isProximo || isOutro) ? (isOutro ? 14 : 7) : 0;
        } else {
          daysToFriday = (5 - base.getUTCDay());
          if (isOutro) daysToFriday += 7;
          else if (isProximo && !isEste && daysToFriday < 2) daysToFriday += 7;
        }

        startDate = addDays(base, daysToFriday);
        endDate = addDays(startDate, 2);
      } else {
        startDate = parseSingleDate(norm, base, clock.year);
      }
    }
  }

    if (!startDate) {
      return {
        sucesso: false,
        codigo: 'UNPARSEABLE_DATE',
        relogio: metaClock,
        instrucao_para_o_agente: `Não foi possível interpretar a data/período "${raw}". Peça ao cliente as datas exatas no formato dia/mês.`,
        sugestao_de_fala: `Não consegui entender com certeza o período "${raw}". Poderia me confirmar as datas de entrada e saída (ex: 15 a 18 de outubro)?`,
        erro: `Não foi possível interpretar a data/período "${raw}". Forneça as datas como "15 a 17 de setembro", "feriado de finados" ou "sexta a domingo da semana que vem".`
      };
    }

    // 4. AUTO-FILL INTELIGENTE PARA DATA ÚNICA (Garante contrato consistente em 100% dos retornos)
    if (!isExplicitInterval || !endDate) {
      const dayOfWeek = startDate.getUTCDay();
      endDate = new Date(startDate.getTime());
      let autoNoites = 1;

      // Se for Sexta (5) ou Sábado (6) -> Auto-fill pacote de 2 noites (fim de semana)
      if (dayOfWeek === 5) {
        endDate = addDays(startDate, 2); // Domingo
        autoNoites = 2;
      } else if (dayOfWeek === 6) {
        endDate = addDays(startDate, 2); // Segunda
        autoNoites = 2;
      } else {
        endDate = addDays(startDate, 1);
        autoNoites = 1;
      }
    }

    // 5. VALIDAÇÕES SEMÂNTICAS RIGOROSAS (Sem adivinhações perigosas)
    if (endDate <= startDate) {
      return {
        sucesso: false,
        codigo: 'CHECKOUT_BEFORE_CHECKIN',
        relogio: metaClock,
        instrucao_para_o_agente: 'A data de check-out informada é anterior ou igual ao check-in. Solicite confirmação ao cliente.',
        sugestao_de_fala: 'Percebi que a data de saída informada é anterior ou igual à data de entrada. Você poderia confirmar as datas corretas da sua viagem?',
        erro: 'A data de check-out informada é anterior ou igual à data de check-in.'
      };
    }

    const diffMs = endDate.getTime() - startDate.getTime();
    const noites = Math.round(diffMs / (1000 * 60 * 60 * 24));
    const MAX_NOITES = 60;

    if (noites > MAX_NOITES) {
      return {
        sucesso: false,
        codigo: 'EXCESSIVE_STAY_DURATION',
        relogio: metaClock,
        instrucao_para_o_agente: `O período solicitado (${noites} noites) excede o máximo permitido de ${MAX_NOITES} noites.`,
        sugestao_de_fala: `O período solicitado é de ${noites} noites, mas realizamos reservas para até ${MAX_NOITES} diárias. Gostaria de ajustar o período?`,
        erro: `O período solicitado (${noites} noites) excede o limite máximo de ${MAX_NOITES} noites.`
      };
    }

    const startIso = formatISODate(startDate);
    const endIso = formatISODate(endDate);
    const startDayName = weekdayName(startDate);
    const endDayName = weekdayName(endDate);

    const startBR = `${startDate.getUTCDate().toString().padStart(2, '0')}/${(startDate.getUTCMonth() + 1).toString().padStart(2, '0')}/${startDate.getUTCFullYear()}`;
    const endBR = `${endDate.getUTCDate().toString().padStart(2, '0')}/${(endDate.getUTCMonth() + 1).toString().padStart(2, '0')}/${endDate.getUTCFullYear()}`;

    return {
      sucesso: true,
      tipo: isExplicitInterval ? 'intervalo' : 'data',
      relogio: metaClock,
      inicio: startIso,
      fim: endIso,
      check_in: startIso,
      check_out: endIso,
      data: startIso,
      dia_semana: startDayName,
      dia_semana_checkin: startDayName,
      dia_semana_checkout: endDayName,
      noites: noites,
      resumo_legivel: `De ${startDayName}, ${startBR} até ${endDayName}, ${endBR} (${noites} ${noites === 1 ? 'diária' : 'diárias'})`,
      pronto_para_busca: {
        from: startIso,
        to: endIso
      }
    };
  } catch (err) {
    if (err && err.codigo) {
      return {
        sucesso: false,
        codigo: err.codigo,
        relogio: metaClock,
        instrucao_para_o_agente: err.instrucao_para_o_agente,
        sugestao_de_fala: err.sugestao_de_fala,
        erro: err.instrucao_para_o_agente
      };
    }
    throw err;
  }
}

function todayInSaoPaulo() {
  return getNowBRT().iso;
}

module.exports = { calculateDate, getNowBRT, getHolidaysForYear, todayInSaoPaulo };
