require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { StaysClient } = require('./stays-client');
const { processAndRankResults } = require('./normalizer');
const { fetchWithDeduplication, clearCache } = require('./cache');
const { calculateDate, todayInSaoPaulo, getNowBRT } = require('./date-calculator');

const SEARCH_DATE_FORMAT = 'YYYY-MM-DD';
const SEARCH_DATE_EXAMPLE = '2026-09-05';

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const staysClient = new StaysClient();
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origem não permitida por CORS.'));
  }
}));
app.use(express.json());

// Validador e normalizador flexível de datas
function parseAndValidateDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const cleanStr = dateStr.trim();

  let year, month, day;

  // 1. Formato ISO: YYYY-MM-DD ou YYYY/MM/DD
  const isoMatch = cleanStr.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoMatch) {
    year = parseInt(isoMatch[1], 10);
    const p2 = parseInt(isoMatch[2], 10);
    const p3 = parseInt(isoMatch[3], 10);

    // Se p2 > 12 e p3 <= 12, foram passados invertidos (YYYY-DD-MM)
    if (p2 > 12 && p3 <= 12) {
      day = p2;
      month = p3;
    } else {
      month = p2;
      day = p3;
    }
  } else {
    // 2. Formato Brasileiro: DD/MM/YYYY ou DD-MM-YYYY ou DD.MM.YYYY
    const brMatch = cleanStr.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (brMatch) {
      day = parseInt(brMatch[1], 10);
      month = parseInt(brMatch[2], 10);
      year = parseInt(brMatch[3], 10);
    } else {
      // 3. Formato sem ano: DD/MM ou DD-MM
      const shortMatch = cleanStr.match(/^(\d{1,2})[-/.](\d{1,2})$/);
      if (shortMatch) {
        day = parseInt(shortMatch[1], 10);
        month = parseInt(shortMatch[2], 10);
        const currentYear = new Date().getFullYear();
        year = currentYear;
      } else {
        return null;
      }
    }
  }

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  const dateObj = new Date(Date.UTC(year, month - 1, day));
  if (
    dateObj.getUTCFullYear() !== year ||
    dateObj.getUTCMonth() !== month - 1 ||
    dateObj.getUTCDate() !== day
  ) {
    return null;
  }

  // Formato canônico YYYY-MM-DD
  const formattedStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { year, month, day, dateObj, str: formattedStr };
}

// Data mínima da busca: hoje no fuso operacional da CRCN
function getTodayBRT() {
  const clock = getNowBRT();
  return {
    dateObj: clock.dateObj,
    iso: clock.iso,
    relogio: {
      data_hoje: clock.iso,
      hora_brasilia: clock.timeStr,
      timezone: 'America/Sao_Paulo',
      ano_corrente: clock.year
    }
  };
}

function searchValidationError({ code, parameter, received, message, instrucao_para_o_agente }) {
  const today = getTodayBRT();
  return {
    sucesso: false,
    codigo: code,
    relogio_oficial: today.relogio,
    erro: message,
    parametro: parameter,
    valor_recebido: received,
    formato_aceito: SEARCH_DATE_FORMAT,
    exemplo: SEARCH_DATE_EXAMPLE,
    instrucao_para_o_agente: instrucao_para_o_agente || {
      o_que_fazer: 'Revise os dados de busca com o cliente ou use a ferramenta calcular_data_brt para resolver datas relativas.',
      proibido: 'NUNCA invente opções de apartamentos, valores fictícios ou links que não existam.'
    }
  };
}

function logSearch(event, fields = {}) {
  console.log(JSON.stringify({
    event,
    service: 'crcn-search-api',
    timestamp: new Date().toISOString(),
    ...fields
  }));
}

// Healthcheck
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'crcn-search-api',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Resolve expressões relativas de data no fuso de São Paulo para uso por agentes (sempre HTTP 200 via GET ou POST).
app.all('/api/v1/date/calculate', (req, res) => {
  const expression = req.body?.expression || req.query.expression;
  const referenceDate = req.body?.reference_date || req.query.reference_date;
  const result = calculateDate(expression, referenceDate);
  return res.status(200).json(result);
});

// Limpar cache manual
app.post('/api/v1/cache/clear', (req, res) => {
  const token = process.env.CACHE_CLEAR_TOKEN;
  if (isProduction && !token) {
    return res.status(503).json({ sucesso: false, erro: 'Limpeza manual de cache não configurada.' });
  }
  if (token && req.get('x-cache-clear-token') !== token) {
    return res.status(401).json({ sucesso: false, erro: 'Não autorizado.' });
  }
  clearCache();
  res.json({ success: true, message: 'Cache de pesquisas limpo com sucesso.' });
});

// Endpoint principal de pesquisa
app.get('/api/v1/search', async (req, res) => {
  const startedAt = Date.now();
  const requestId = req.get('x-request-id') || `${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
  const { from, to, persons = 2, max_results = 10 } = req.query;

  logSearch('search.request', { request_id: requestId, from, to, persons, max_results });

  // 1. Validação de presença
  if (!from || !to) {
    const payload = searchValidationError({
      code: 'MISSING_REQUIRED_DATE',
      parameter: !from ? 'from' : 'to',
      received: !from ? from : to,
      message: 'Os parâmetros "from" (check-in) e "to" (check-out) são obrigatórios.'
    });
    logSearch('search.validation_error', { request_id: requestId, code: payload.codigo, parameter: payload.parametro, received: payload.valor_recebido });
    return res.status(400).json(payload);
  }

  // 2. Validação estrita de calendário
  const validFrom = parseAndValidateDate(from);
  const validTo = parseAndValidateDate(to);

  if (!validFrom || !validTo) {
    const parameter = !validFrom ? 'from' : 'to';
    const received = !validFrom ? from : to;
    const payload = searchValidationError({
      code: 'INVALID_DATE_FORMAT',
      parameter,
      received,
      message: `O parâmetro "${parameter}" não contém uma data válida.`
    });
    logSearch('search.validation_error', { request_id: requestId, code: payload.codigo, parameter, received });
    return res.status(400).json(payload);
  }

  // 3. Validação de data no passado
  const todayBRT = getTodayBRT();
  if (validFrom.dateObj < todayBRT.dateObj) {
    const payload = searchValidationError({
      code: 'CHECK_IN_IN_PAST',
      parameter: 'from',
      received: validFrom.str,
      message: 'A data de check-in (from) não pode ser anterior à data de hoje em Brasília.',
      instrucao_para_o_agente: {
        o_que_fazer: `A data solicitada (${validFrom.str}) já passou. A data de hoje em Brasília é ${todayBRT.iso}. Peça ao cliente uma data futura ou use calcular_data_brt.`,
        sugestao_de_fala: `Notei que essa data (${validFrom.str}) já passou. Para quando exatamente você gostaria de planejar sua viagem a partir de hoje?`
      }
    });
    payload.data_minima = todayBRT.iso;
    logSearch('search.validation_error', { request_id: requestId, code: payload.codigo, parameter: payload.parametro, received: payload.valor_recebido });
    return res.status(200).json(payload);
  }

  // 4. Validação de período
  const diffTime = validTo.dateObj.getTime() - validFrom.dateObj.getTime();
  const nights = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (nights <= 0) {
    const payload = searchValidationError({
      code: 'INVALID_STAY_RANGE',
      parameter: 'to',
      received: validTo.str,
      message: 'A data de check-out (to) deve ser posterior à data de check-in (from) em pelo menos 1 noite.'
    });
    logSearch('search.validation_error', { request_id: requestId, code: payload.codigo, parameter: payload.parametro, received: payload.valor_recebido });
    return res.status(400).json(payload);
  }

  if (nights > 60) {
    const payload = searchValidationError({
      code: 'STAY_TOO_LONG',
      parameter: 'to',
      received: validTo.str,
      message: 'O período máximo permitido para pesquisa online é de 60 noites.'
    });
    logSearch('search.validation_error', { request_id: requestId, code: payload.codigo, parameter: payload.parametro, received: payload.valor_recebido });
    return res.status(400).json(payload);
  }

  // 5. Validação de hóspedes
  const numPersons = parseInt(persons, 10);
  if (isNaN(numPersons) || numPersons < 1 || numPersons > 30) {
    const payload = {
      sucesso: false,
      codigo: 'INVALID_PERSONS',
      erro: 'O parâmetro "persons" deve ser um número inteiro entre 1 e 30 hóspedes.',
      parametro: 'persons',
      valor_recebido: persons,
      exemplo: 4
    };
    logSearch('search.validation_error', { request_id: requestId, code: payload.codigo, parameter: payload.parametro, received: persons });
    return res.status(400).json(payload);
  }

  const limitResults = Math.min(Math.max(parseInt(max_results, 10) || 10, 1), 50);

  try {
    const startTime = Date.now();

    // 6. Busca com cache e prevenção de Cache Stampede (Thundering Herd)
    const { data: responseData, isHit } = await fetchWithDeduplication(
      validFrom.str,
      validTo.str,
      numPersons,
      limitResults,
      async () => {
        // Fluxo HTTP usado pelo próprio frontend Stays: sessão, busca JSON e preço oficial.
        const pricedApartments = await staysClient.search({
          from: validFrom.str,
          to: validTo.str,
          persons: numPersons,
          limit: limitResults
        });
        const allOptions = processAndRankResults(pricedApartments, {
          from: validFrom.str,
          to: validTo.str,
          persons: numPersons
        });

        const today = getTodayBRT();
        const noResultsInstruction = allOptions.length === 0 ? {
          o_que_fazer: 'NÃO invente opções fictícias nem links de exemplo. Explique com cordialidade que não há apartamentos disponíveis para esse período exato e sugira datas alternativas (próximo fim de semana ou outra semana).',
          sugestao_de_fala: 'Não encontrei apartamentos disponíveis para essas datas exatas. Você teria flexibilidade para viajar no final de semana seguinte ou em outras datas?'
        } : null;

        return {
          sucesso: true,
          total_encontrados: allOptions.length,
          relogio_oficial: today.relogio,
          periodo: {
            check_in: validFrom.str,
            check_out: validTo.str,
            noites: nights,
            hospedes: numPersons
          },
          ...(noResultsInstruction ? { instrucao_para_o_agente: noResultsInstruction } : {}),
          opcoes: allOptions
        };
      }
    );

    // Ajustar opções conforme limitResults solicitado e tempo de resposta
    const finalOptions = responseData.opcoes.slice(0, limitResults);
    
    res.setHeader('X-Cache', isHit ? 'HIT' : 'MISS');
    const payload = {
      ...responseData,
      tempo_resposta_ms: isHit ? 5 : (Date.now() - startTime),
      opcoes: finalOptions
    };
    logSearch('search.success', {
      request_id: requestId,
      from: validFrom.str,
      to: validTo.str,
      persons: numPersons,
      cache: isHit ? 'HIT' : 'MISS',
      total_encontrados: responseData.total_encontrados,
      returned_options: finalOptions.length,
      duration_ms: Date.now() - startedAt
    });
    return res.json(payload);
  } catch (error) {
    logSearch('search.error', {
      request_id: requestId,
      code: error.code || 'SEARCH_UNEXPECTED_ERROR',
      message: error.message,
      duration_ms: Date.now() - startedAt
    });
    res.status(500).json({
      sucesso: false,
      erro: error.code === 'STAYS_TIMEOUT'
        ? 'A consulta de disponibilidade excedeu o tempo limite. Tente novamente em instantes.'
        : 'Falha ao consultar disponibilidade na Central de Reservas Caldas.',
      ...(isProduction ? {} : { detalhes: error.message })
    });
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[crcn-search-api] Servidor rodando na porta ${PORT}`);
  console.log(`[crcn-search-api] Healthcheck: http://0.0.0.0:${PORT}/health`);
  console.log(`[crcn-search-api] Busca: http://0.0.0.0:${PORT}/api/v1/search?from=YYYY-MM-DD&to=YYYY-MM-DD&persons=2`);
});

function shutdown(signal) {
  console.log(`[crcn-search-api] ${signal} recebido; encerrando HTTP server.`);
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
