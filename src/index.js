require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { StaysClient } = require('./stays-client');
const { ImobClient } = require('./imob-client');
const { normalizeImobListing } = require('./imob-normalizer');
const { processAndRankResults, selectDiverseListings, assignSuggestedTags, normalizeProperty, getAmenityNames, getTitle, cleanText } = require('./normalizer');
const { fetchWithDeduplication, clearCache } = require('./cache');
const { calculateDate, todayInSaoPaulo, getNowBRT } = require('./date-calculator');

const SEARCH_DATE_FORMAT = 'YYYY-MM-DD';
const SEARCH_DATE_EXAMPLE = '2026-09-05';
const CANDIDATE_SEARCH_LIMIT = Math.min(
  120,
  Math.max(20, Number.parseInt(process.env.STAYS_SEARCH_CANDIDATE_LIMIT || '60', 10) || 60)
);
const IMOB_PRICE_CANDIDATE_LIMIT = Math.min(
  40,
  Math.max(1, Number.parseInt(process.env.IMOB_PRICE_CANDIDATE_LIMIT || '20', 10) || 20)
);

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const staysClient = new StaysClient();
const imobClient = new ImobClient();
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
app.use((req, res, next) => {
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    if (!req.headers['content-type']) {
      req.headers['content-type'] = 'application/json';
    }
  }
  next();
});
app.use(express.json({ type: ['application/json', '*/*'] }));

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

// Relógio oficial de Brasília (sem regex, sem interpretação de texto, sempre HTTP 200 via GET ou POST).
app.all('/api/v1/date/now', (req, res) => {
  const now = new Date();
  const optionsDate = { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' };
  const optionsTime = { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  const optionsWeekday = { timeZone: 'America/Sao_Paulo', weekday: 'long' };

  const brDateStr = new Intl.DateTimeFormat('pt-BR', optionsDate).format(now);
  const [d, m, y] = brDateStr.split('/');
  const isoDate = `${y}-${m}-${d}`;
  const timeStr = new Intl.DateTimeFormat('pt-BR', optionsTime).format(now);
  const weekdayStr = new Intl.DateTimeFormat('pt-BR', optionsWeekday).format(now);

  return res.status(200).json({
    sucesso: true,
    data_hoje: isoDate,
    formato_iso: 'YYYY-MM-DD',
    data_formatada: `${d}/${m}/${y}`,
    dia_semana: weekdayStr,
    hora_brasilia: timeStr,
    ano_corrente: parseInt(y, 10),
    timezone: 'America/Sao_Paulo',
    mensagem: `Hoje é ${weekdayStr}, ${d}/${m}/${y}, às ${timeStr} (Horário Oficial de Brasília).`
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

function parseList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean);
  } catch {}
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function publicError(res, error) {
  const status = error.code === 'STAYS_NOT_CONFIGURED' ? 503
    : error.code === 'STAYS_FILTER_NOT_FOUND' ? 400
      : 502;
  return res.status(status).json({
    sucesso: false,
    codigo: error.code || 'STAYS_REQUEST_FAILED',
    erro: status === 503
      ? 'A integração com a Stays ainda não está configurada.'
      : status === 400
        ? error.message
        : 'Não foi possível consultar a API oficial de reservas neste momento.'
  });
}

// Catálogos de busca para tools de pesquisa dirigida (comodidades, inventário, propriedades e cidades).
app.get('/api/v1/searchfilters', async (req, res) => {
  try {
    const filters = await staysClient.getSearchFilters();
    const simplify = (items = []) => items.map((item) => ({
      id: item?._id || item?.id || item?.val || null,
      nome: cleanText(item?._mstitle?.pt_BR || item?.internalName || item?.val || item?.id || '')
    }));
    return res.json({
      sucesso: true,
      comodidades: simplify(filters.amenities),
      inventario: simplify(filters.inventory),
      propriedades: simplify(filters.properties),
      cidades: simplify(filters.cities),
      regioes: simplify(filters.regions),
      quartos: filters.rooms || [],
      hospedes: filters.guests || []
    });
  } catch (error) {
    return publicError(res, error);
  }
});

// Pesquisa um empreendimento pelo nome sem depender de datas de hospedagem.
app.get('/api/v1/properties', async (req, res) => {
  try {
    const query = String(req.query.q || req.query.query || '').trim();
    if (!query) return res.status(400).json({ sucesso: false, codigo: 'MISSING_PROPERTY_QUERY', erro: 'Informe parte do nome da propriedade em q.' });
    const found = await staysClient.searchProperties(query);
    const filters = await staysClient.getSearchFilters();
    const enriched = await Promise.all(found.slice(0, 5).map(async (property) => {
      const detail = await staysClient.getProperty(property?._id || property?.id).catch(() => property);
      return normalizeProperty(detail, { amenityCatalog: filters.amenities || [] });
    }));
    return res.json({
      sucesso: true,
      total_encontrados: found.length,
      propriedades: enriched
    });
  } catch (error) {
    return publicError(res, error);
  }
});

// Detalhes ricos de uma acomodação específica, sem iniciar checkout ou criar reserva.
app.get('/api/v1/listings/:id', async (req, res) => {
  try {
    const [listing, filters] = await Promise.all([
      staysClient.getListing(req.params.id),
      staysClient.getSearchFilters()
    ]);
    const property = listing?._idproperty ? await staysClient.getProperty(listing._idproperty).catch(() => null) : null;
    const images = (listing?._t_imagesMeta || []).map((image) => image?.url).filter(Boolean);
    return res.json({
      sucesso: true,
      acomodacao: {
        id: listing?.id || req.params.id,
        nome: getTitle(listing),
        propriedade: cleanText(property?._mstitle?.pt_BR || property?.internalName || ''),
        cidade: cleanText(listing?.address?.city || property?.address?.city || ''),
        capacidade: Number(listing?._i_maxGuests) || null,
        quartos: Number(listing?._i_rooms) || null,
        camas: Number(listing?._i_beds) || null,
        banheiros: Number(listing?._f_bathrooms) || null,
        descricao: cleanText(listing?._mssummary?.pt_BR || listing?._msdesc?.pt_BR).slice(0, 700),
        regras: cleanText(listing?._mshouserules?.pt_BR).slice(0, 700),
        comodidades: getAmenityNames(listing, filters.amenities),
        imagem_principal: listing?._t_mainImageMeta?.url || null,
        imagens: images.slice(0, 20),
        link_base: `https://www.centraldereservascaldas.com.br/pt/apartment/${encodeURIComponent(listing?.id || req.params.id)}`
      }
    });
  } catch (error) {
    return publicError(res, error);
  }
});

// Endpoint principal de pesquisa (suporta GET e POST para compatibilidade total com o ADK / Evo CRM)
app.all('/api/v1/search', async (req, res) => {
  const startedAt = Date.now();
  const requestId = req.get('x-request-id') || `${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
  
  const fromRaw = req.body?.from || req.body?.check_in || req.body?.checkin || req.body?.entrada || req.query.from || req.query.check_in || req.query.checkin;
  const toRaw = req.body?.to || req.body?.check_out || req.body?.checkout || req.body?.saida || req.query.to || req.query.check_out || req.query.checkout;
  const personsRaw = req.body?.persons || req.body?.hospedes || req.body?.guests || req.body?.adults || req.query.persons || req.query.hospedes || 2;
  const maxResultsRaw = req.body?.max_results || req.query.max_results || 3;
  const pageRaw = req.body?.page ?? req.body?.pagina ?? req.query.page ?? req.query.pagina ?? 1;

  const from = typeof fromRaw === 'string' ? fromRaw : (Array.isArray(fromRaw) ? fromRaw[0] : fromRaw);
  const to = typeof toRaw === 'string' ? toRaw : (Array.isArray(toRaw) ? toRaw[0] : toRaw);
  const persons = parseInt(personsRaw, 10) || 2;
  const max_results = parseInt(maxResultsRaw, 10) || 10;
  const page = Number(pageRaw);

  const filterInput = {
    amenities: parseList(req.body?.amenities || req.body?.comodidades || req.query.amenities || req.query.comodidades),
    inventory: parseList(req.body?.inventory || req.body?.inventario || req.query.inventory || req.query.inventario),
    properties: parseList(req.body?.properties || req.body?.propriedades || req.query.properties || req.query.propriedades || req.body?.property || req.query.property),
    cities: parseList(req.body?.cities || req.body?.cidades || req.query.cities || req.query.cidades),
    rooms: parseList(req.body?.rooms || req.body?.quartos || req.query.rooms || req.query.quartos).map((value) => Number(value)).filter(Number.isFinite),
    listingId: req.body?.listingId || req.body?.listing_id || req.query.listingId || req.query.listing_id
  };

  logSearch('search.request', { request_id: requestId, from, to, persons, max_results, page });

  if (!Number.isInteger(page) || page < 1 || page > 100) {
    return res.status(400).json({
      sucesso: false,
      codigo: 'INVALID_PAGE',
      erro: 'O parâmetro "page" deve ser um número inteiro entre 1 e 100.',
      parametro: 'page',
      valor_recebido: pageRaw,
      exemplo: 2
    });
  }

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

  const limitResults = Math.min(Math.max(parseInt(max_results, 10) || 3, 1), 20);
  const pageStart = (page - 1) * limitResults;
  const candidateWindowOffset = Math.floor(pageStart / CANDIDATE_SEARCH_LIMIT) * CANDIDATE_SEARCH_LIMIT;
  const offsetWithinWindow = pageStart % CANDIDATE_SEARCH_LIMIT;

  try {
    const startTime = Date.now();

    // 6. Busca com cache e prevenção de Cache Stampede (Thundering Herd)
    let staysPropertyNotFound = false;
    let searchFilters;
    try {
      searchFilters = await staysClient.resolveSearchFilters(filterInput);
    } catch (error) {
      if (error.code !== 'STAYS_FILTER_NOT_FOUND' || filterInput.properties.length === 0) throw error;
      // O nome/ID pode existir só no catálogo de parceiros. Nesse caso não
      // removemos o filtro e mostramos outros condomínios da Stays por engano.
      staysPropertyNotFound = true;
      searchFilters = await staysClient.resolveSearchFilters({ ...filterInput, properties: [] });
    }
    const imobPropertyNames = await Promise.all(filterInput.properties.map(async (requestedName) => {
      if (!/^\d+$/.test(requestedName)) return requestedName;
      const staysFilters = await staysClient.getSearchFilters().catch(() => null);
      const property = (staysFilters?.properties || []).find((item) =>
        String(item?._id || item?.id || '') === requestedName
      );
      return property?._mstitle?.pt_BR || property?.internalName || requestedName;
    }));
    const cacheFilters = {
      ...searchFilters,
      _requested_property: filterInput.properties,
      _selection_strategy: 'portfolio-v1',
      _candidate_limit: CANDIDATE_SEARCH_LIMIT,
      _page: page
    };
    const { data: responseData, isHit } = await fetchWithDeduplication(
      validFrom.str,
      validTo.str,
      numPersons,
      limitResults,
      async () => {
        // A Stays já retorna preço oficial; a API enriquece somente as opções entregues à IA.
        const candidateCacheFilters = {
          ...searchFilters,
          _requested_property: filterInput.properties,
          _cache_type: 'candidate-pool-v1',
          _candidate_offset: candidateWindowOffset,
          _candidate_limit: CANDIDATE_SEARCH_LIMIT
        };
        const { data: listings } = await fetchWithDeduplication(
          validFrom.str,
          validTo.str,
          numPersons,
          CANDIDATE_SEARCH_LIMIT,
          () => staysPropertyNotFound ? Promise.resolve([]) : staysClient.search({
              from: validFrom.str,
              to: validTo.str,
              persons: numPersons,
              limit: CANDIDATE_SEARCH_LIMIT,
              skip: candidateWindowOffset,
              filters: searchFilters
            }),
          candidateCacheFilters
        );
        const orderedListings = selectDiverseListings(listings, listings.length, {
          preferDifferentProperties: filterInput.properties.length === 0
        });
        let imobRecords = [];
        if (imobClient.configured && orderedListings.length < offsetWithinWindow + limitResults) {
          try {
            imobRecords = filterInput.properties.length
              ? (await Promise.all(imobPropertyNames.map((propertyName) => imobClient.searchForProperty({
                  from: validFrom.str,
                  to: validTo.str,
                  persons: numPersons,
                  propertyName
                })))).flat()
              : await imobClient.search({
                  from: validFrom.str,
                  to: validTo.str,
                  persons: numPersons,
                  onePerCondominium: true
                });
          } catch (error) {
            logSearch('search.imob_error', {
              request_id: requestId,
              code: error.code || 'IMOB_REQUEST_FAILED'
            });
          }
        }

        const nightsCriteria = {
          from: validFrom.str,
          to: validTo.str,
          persons: numPersons,
          nights,
          page
        };
        imobRecords = await Promise.all(imobRecords.map(async (record, index) => {
          if (index >= IMOB_PRICE_CANDIDATE_LIMIT) return record;
          const current = normalizeImobListing(record, nightsCriteria);
          if (current.valor_total || !record?.id) return record;
          try {
            const pixPrice = await imobClient.getPixPrice({
              listingId: record.id,
              from: validFrom.str,
              to: validTo.str,
              persons: numPersons
            });
            return pixPrice ? { ...record, valorTotal: pixPrice } : record;
          } catch (error) {
            logSearch('search.imob_price_error', {
              request_id: requestId,
              code: error.code || 'IMOB_PRICE_REQUEST_FAILED'
            });
            return record;
          }
        }));
        const selectedListings = orderedListings.slice(offsetWithinWindow, offsetWithinWindow + limitResults);
        const enrichedListings = selectedListings.length ? await staysClient.enrichListings(selectedListings) : [];
        const staysOptions = processAndRankResults(enrichedListings, nightsCriteria);
        const imobOptions = [];
        const seenImob = new Set();
        for (const record of imobRecords) {
          const option = normalizeImobListing(record, nightsCriteria);
          if (!option.link_reserva) continue;
          const identity = `${option.id || ''}|${option.link_reserva}`;
          if (seenImob.has(identity)) continue;
          seenImob.add(identity);
          imobOptions.push(option);
        }
        const diversifiedImob = imobOptions.length
          ? selectDiverseListings(imobOptions, imobOptions.length, {
              preferDifferentProperties: filterInput.properties.length === 0
            })
          : [];
        const portfolio = [...orderedListings.map((listing) => ({ provider: 'stays', listing })), ...diversifiedImob.map((listing) => ({ provider: 'imob', listing }))];
        const pageCandidates = portfolio.slice(offsetWithinWindow, offsetWithinWindow + limitResults);
        const staysById = new Map(staysOptions.map((item) => [String(item.id || ''), item]));
        const imobByLink = new Map(diversifiedImob.map((item) => [item.link_reserva, item]));
        const allOptions = pageCandidates.map(({ provider, listing }) => provider === 'stays'
          ? staysById.get(String(listing?.listing?.id || listing?.listing?._id || listing?.id || listing?._id || ''))
          : imobByLink.get(listing.link_reserva)
        ).filter(Boolean);
        assignSuggestedTags(allOptions, page === 1);

        const hasMoreInWindow = portfolio.length > offsetWithinWindow + allOptions.length;
        const hasMoreCandidates = listings.length === CANDIDATE_SEARCH_LIMIT;
        const hasMore = allOptions.length > 0 && (hasMoreInWindow || hasMoreCandidates);

        const today = getTodayBRT();
        const noResultsInstruction = allOptions.length === 0 ? {
          o_que_fazer: 'NÃO invente opções fictícias nem links de exemplo. Explique com cordialidade que não há apartamentos disponíveis para esse período exato e sugira datas alternativas (próximo fim de semana ou outra semana).',
          sugestao_de_fala: 'Não encontrei apartamentos disponíveis para essas datas exatas. Você teria flexibilidade para viajar no final de semana seguinte ou em outras datas?'
        } : null;

        return {
          sucesso: true,
          total_encontrados: listings.length + imobRecords.length,
          total_exato: listings.length < CANDIDATE_SEARCH_LIMIT,
          opcoes_retornadas: allOptions.length,
          mais_opcoes_disponiveis: hasMore,
          relogio_oficial: today.relogio,
          periodo: {
            check_in: validFrom.str,
            check_out: validTo.str,
            noites: nights,
            hospedes: numPersons
          },
          filtros_aplicados: searchFilters,
          ...(noResultsInstruction ? { instrucao_para_o_agente: noResultsInstruction } : {}),
          opcoes: allOptions
        };
      },
      cacheFilters
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
    return publicError(res, error);
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
