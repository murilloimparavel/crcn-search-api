const TIMEZONE = 'America/Sao_Paulo';

const WEEKDAYS = {
  domingo: 0,
  'segunda-feira': 1, segunda: 1,
  'terca-feira': 2, 'terça-feira': 2, terca: 2, terça: 2,
  'quarta-feira': 3, quarta: 3,
  'quinta-feira': 4, quinta: 4,
  'sexta-feira': 5, sexta: 5,
  sabado: 6, sábado: 6
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

  return [
    {
      nome: 'Ano Novo / Réveillon',
      slug: 'reveillon',
      aliases: ['ano novo', 'reveillon', 'reveilon', 'virada de ano', 'passagem de ano'],
      check_in: new Date(Date.UTC(year, 11, 29)), // 29/12 ou 30/12
      check_out: new Date(Date.UTC(year + 1, 0, 2)), // 02/01
      descricao: 'Pacote de Réveillon / Virada de Ano'
    },
    {
      nome: 'Carnaval',
      slug: 'carnaval',
      aliases: ['carnaval', 'feriado de carnaval', 'carnavrau'],
      check_in: carnavalFriday,
      check_out: addDays(carnavalTuesday, 1), // Quarta de cinzas
      descricao: 'Pacote de Carnaval (Sexta a Quarta de Cinzas)'
    },
    {
      nome: 'Semana Santa / Páscoa',
      slug: 'semana-santa',
      aliases: ['semana santa', 'pascoa', 'páscoa', 'sexta feira santa', 'feriado da pascoa'],
      check_in: addDays(paixaoCristo, -1), // Quinta-feira Santa
      check_out: addDays(easter, 1),        // Domingo / Segunda
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
      check_in: corpusChristi, // Quinta
      check_out: addDays(corpusChristi, 3), // Domingo
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
      aliases: ['dia das criancas', 'dia das crianças', 'nossa senhora aparecida', 'aparecida', '12 de outubro', 'semana do saco cheio', 'saco cheio'],
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
      nome: 'Natal',
      slug: 'natal',
      aliases: ['natal', 'feriado de natal', 'noite de natal'],
      check_in: new Date(Date.UTC(year, 11, 23)),
      check_out: new Date(Date.UTC(year, 11, 26)),
      descricao: 'Feriado de Natal (23 a 26 de Dezembro)'
    }
  ];
}

// Cria um pacote inteligente de fim de semana prolongado se o feriado cair próximo a fim de semana
function getHolidayPackage(holidayDate) {
  const dayOfWeek = holidayDate.getUTCDay();
  let start = new Date(holidayDate.getTime());
  let end = new Date(holidayDate.getTime());

  if (dayOfWeek === 1) { // Segunda-feira
    start = addDays(holidayDate, -3); // Sexta anterior
    end = addDays(holidayDate, 1);    // Terça
  } else if (dayOfWeek === 2) { // Terça-feira (emenda segunda)
    start = addDays(holidayDate, -4); // Sexta anterior
    end = addDays(holidayDate, 1);    // Quarta
  } else if (dayOfWeek === 4) { // Quinta-feira (emenda sexta)
    start = holidayDate;              // Quinta
    end = addDays(holidayDate, 3);    // Domingo
  } else if (dayOfWeek === 5) { // Sexta-feira
    start = holidayDate;              // Sexta
    end = addDays(holidayDate, 2);    // Domingo
  } else { // Sábado ou Domingo
    start = addDays(holidayDate, -1);
    end = addDays(holidayDate, 2);
  }

  return { start, end };
}

function normalizeText(val) {
  return String(val || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
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
    return parseExactIso(`${isoMatch[1]}-${String(isoMatch[2]).padStart(2, '0')}-${String(isoMatch[3]).padStart(2, '0')}`);
  }

  // 2. DD/MM/YYYY ou DD/MM
  const slashMatch = norm.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]);
    let yr = slashMatch[3] ? Number(slashMatch[3]) : currentYear;
    if (yr < 100) yr += 2000;
    const dt = new Date(Date.UTC(yr, month - 1, day));
    if (dt < baseDate && !slashMatch[3]) {
      dt.setUTCFullYear(yr + 1);
    }
    return dt;
  }

  // 3. DD de Mês (ex: 15 de setembro, 12 de out)
  const monthNameMatch = norm.match(/^(\d{1,2})(?:\s*(?:de)?\s*([a-z]+))(?:\s*(?:de)?\s*(\d{4}))?$/);
  if (monthNameMatch && MONTHS[monthNameMatch[2]]) {
    const day = Number(monthNameMatch[1]);
    const month = MONTHS[monthNameMatch[2]];
    const yr = monthNameMatch[3] ? Number(monthNameMatch[3]) : currentYear;
    const dt = new Date(Date.UTC(yr, month - 1, day));
    if (dt < baseDate && !monthNameMatch[3]) {
      dt.setUTCFullYear(yr + 1);
    }
    return dt;
  }

  // 4. "em N dias"
  const inDaysMatch = norm.match(/^em\s+(\d{1,3})\s+dias?$/);
  if (inDaysMatch) {
    return addDays(baseDate, Number(inDaysMatch[1]));
  }

  // 5. Termos relativos simples
  if (norm === 'hoje') return baseDate;
  if (norm === 'amanha') return addDays(baseDate, 1);
  if (norm === 'depois de amanha') return addDays(baseDate, 2);

  // 6. Dias da semana (com deslocamentos)
  let offsetWeeks = 0;
  if (norm.includes('outro') || norm.includes('outra')) offsetWeeks = 2;
  else if (norm.includes('semana que vem') || norm.includes('proxima semana') || norm.includes('seguinte')) offsetWeeks = 1;

  for (const [name, targetDay] of Object.entries(WEEKDAYS)) {
    if (norm.includes(name)) {
      let daysAhead = (targetDay - baseDate.getUTCDay() + 7) % 7;
      if (daysAhead === 0 && offsetWeeks === 0) daysAhead = 7;
      daysAhead += (offsetWeeks > 0 ? (offsetWeeks - 1) * 7 : 0);
      if (offsetWeeks > 0 && daysAhead < 7) daysAhead += 7;
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
      dia_semana: weekdayName(base),
      relogio: metaClock,
      mensagem: `Hoje é ${metaClock.dia_semana}, ${clock.day.toString().padStart(2, '0')}/${clock.month.toString().padStart(2, '0')}/${clock.year}, às ${clock.timeStr} (Horário de Brasília).`
    };
  }

  // 1. CHECAGEM DE FERIADOS NACIONAIS / PROLONGADOS
  const currentHolidays = getHolidaysForYear(clock.year);
  const nextYearHolidays = getHolidaysForYear(clock.year + 1);
  const allHolidays = [...currentHolidays, ...nextYearHolidays];

  for (const h of allHolidays) {
    for (const alias of h.aliases) {
      if (norm.includes(alias)) {
        // Se o feriado deste ano já passou e não foi explicitado o ano, usar o do próximo ano
        let holidayObj = h;
        if (h.check_out < base && !norm.includes(String(h.check_in.getUTCFullYear()))) {
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

  // 2. DETECÇÃO DE EXPRESSÕES MENSAIS (ex: "primeiro fim de semana de outubro", "ultimo fim de semana de setembro")
  const weekendMonthMatch = norm.match(/^(primeiro|ultimo|último|segundo|terceiro)\s+f(?:im|inal)\s+de\s+semana\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?$/);
  if (weekendMonthMatch && MONTHS[weekendMonthMatch[2]]) {
    const position = weekendMonthMatch[1];
    const month = MONTHS[weekendMonthMatch[2]];
    const yr = weekendMonthMatch[3] ? Number(weekendMonthMatch[3]) : clock.year;

    // Encontrar todas as sextas-feiras do mês
    const fridays = [];
    const d = new Date(Date.UTC(yr, month - 1, 1));
    while (d.getUTCMonth() === month - 1) {
      if (d.getUTCDay() === 5) {
        fridays.push(new Date(d.getTime()));
      }
      d.setUTCDate(d.getUTCDate() + 1);
    }

    let targetFriday;
    if (position === 'primeiro') targetFriday = fridays[0];
    else if (position === 'segundo') targetFriday = fridays[1] || fridays[0];
    else if (position === 'terceiro') targetFriday = fridays[2] || fridays[1];
    else if (position === 'ultimo' || position === 'último') targetFriday = fridays[fridays.length - 1];

    if (targetFriday) {
      const startDate = targetFriday;
      const endDate = addDays(startDate, 2);
      const startIso = formatISODate(startDate);
      const endIso = formatISODate(endDate);
      const startDay = weekdayName(startDate);
      const endDay = weekdayName(endDate);
      const startBR = `${startDate.getUTCDate().toString().padStart(2, '0')}/${(startDate.getUTCMonth() + 1).toString().padStart(2, '0')}/${startDate.getUTCFullYear()}`;
      const endBR = `${endDate.getUTCDate().toString().padStart(2, '0')}/${(endDate.getUTCMonth() + 1).toString().padStart(2, '0')}/${endDate.getUTCFullYear()}`;

      return {
        sucesso: true,
        tipo: 'intervalo',
        relogio: metaClock,
        check_in: startIso,
        check_out: endIso,
        inicio: startIso,
        fim: endIso,
        dia_semana_checkin: startDay,
        dia_semana_checkout: endDay,
        noites: 2,
        resumo_legivel: `De ${startDay}, ${startBR} até ${endDay}, ${endBR} (2 diárias)`,
        pronto_para_busca: {
          from: startIso,
          to: endIso
        }
      };
    }
  }

  // 3. DETECTAR INTERVALOS EXPLÍCITOS ("X a Y", "X ate Y")
  const intervalRegex = /^(.+?)\s+(?:a|ate|ao|ate o dia|ate a|ate o|e|-)\s+(.+)$/i;
  const match = norm.match(intervalRegex);

  let startDate = null;
  let endDate = null;
  let isExplicitInterval = false;

  if (match) {
    isExplicitInterval = true;
    let startStr = match[1].trim();
    let endStr = match[2].trim();

    if (endStr.includes('outro final de semana') || endStr.includes('outra semana')) {
      endStr = endStr.replace(/do outro final de semana|da outra semana/g, '').trim();
      if (!startStr.includes('outro')) startStr += ' do outro final de semana';
    } else if (endStr.includes('semana que vem') || endStr.includes('proxima semana') || endStr.includes('proximo')) {
      endStr = endStr.replace(/da semana que vem|da proxima semana|proxima|proximo/g, '').trim();
      if (!startStr.includes('semana que vem') && !startStr.includes('proxim')) startStr += ' da semana que vem';
    }

    startDate = parseSingleDate(startStr, base, clock.year);
    endDate = parseSingleDate(endStr, startDate || base, clock.year);

    if (startDate && endDate && endDate <= startDate) {
      endDate = addDays(endDate, 7);
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
    let offset = 0;
    if (norm.includes('outro') || norm.includes('outra')) offset = 2;
    else if (norm.includes('proximo') || norm.includes('semana que vem')) offset = 1;

    let daysToFriday = (5 - base.getUTCDay() + 7) % 7;
    if (daysToFriday === 0 && offset === 0) daysToFriday = 7;
    daysToFriday += (offset > 0 ? (offset - 1) * 7 : 0);
    if (offset > 0 && daysToFriday < 7) daysToFriday += 7;

    startDate = addDays(base, daysToFriday);
    endDate = addDays(startDate, 2);
  } else {
    startDate = parseSingleDate(norm, base, clock.year);
  }

  if (!startDate) {
    return {
      sucesso: false,
      relogio: metaClock,
      erro: `Não foi possível interpretar a data/período "${raw}". Forneça as datas como "15 a 17 de setembro", "feriado de finados" ou "sexta a domingo da semana que vem".`
    };
  }

  const startIso = formatISODate(startDate);
  const startDayName = weekdayName(startDate);

  if (!isExplicitInterval) {
    return {
      sucesso: true,
      tipo: 'data',
      data: startIso,
      dia_semana: startDayName,
      relogio: metaClock,
      mensagem: `${startDayName}, ${startDate.getUTCDate().toString().padStart(2, '0')}/${(startDate.getUTCMonth() + 1).toString().padStart(2, '0')}/${startDate.getUTCFullYear()}`
    };
  }

  const diffMs = endDate.getTime() - startDate.getTime();
  const noites = Math.round(diffMs / (1000 * 60 * 60 * 24));
  const endIso = formatISODate(endDate);
  const endDayName = weekdayName(endDate);

  const startBR = `${startDate.getUTCDate().toString().padStart(2, '0')}/${(startDate.getUTCMonth() + 1).toString().padStart(2, '0')}/${startDate.getUTCFullYear()}`;
  const endBR = `${endDate.getUTCDate().toString().padStart(2, '0')}/${(endDate.getUTCMonth() + 1).toString().padStart(2, '0')}/${endDate.getUTCFullYear()}`;

  return {
    sucesso: true,
    tipo: 'intervalo',
    relogio: metaClock,
    inicio: startIso,
    fim: endIso,
    check_in: startIso,
    check_out: endIso,
    dia_semana_checkin: startDayName,
    dia_semana_checkout: endDayName,
    noites: noites,
    resumo_legivel: `De ${startDayName}, ${startBR} até ${endDayName}, ${endBR} (${noites} ${noites === 1 ? 'diária' : 'diárias'})`,
    pronto_para_busca: {
      from: startIso,
      to: endIso
    }
  };
}

function todayInSaoPaulo() {
  return getNowBRT().iso;
}

module.exports = { calculateDate, getNowBRT, getHolidaysForYear, todayInSaoPaulo };
