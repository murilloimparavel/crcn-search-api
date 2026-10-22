require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { timingSafeEqual } = require('node:crypto');
const { StaysClient } = require('./stays-client');
const { ImobClient } = require('./imob-client');
const { PropertyCatalog } = require('./property-catalog');
const { normalizeImobListing } = require('./imob-normalizer');
const { processAndRankResults, selectDiverseListings, assignSuggestedTags, normalizeProperty, getAmenityNames, getTitle, cleanText } = require('./normalizer');
const { fetchWithDeduplication, clearCache } = require('./cache');
const { calculateDate, todayInSaoPaulo, getNowBRT } = require('./date-calculator');
const { createCommercialAssistantRouter } = require('./commercial-assistant');
const { normalizeReservation } = require('./reservation-normalizer');

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
const propertyCatalog = new PropertyCatalog({ staysClient, imobClient });
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
app.use(express.json({ limit: '100kb', type: ['application/json', '*/*'] }));

app.use('/api/v1/commercial-assistant', createCommercialAssistantRouter({
  express,
  staysClient,
  imobClient,
  authServiceUrl: process.env.EVO_AUTH_SERVICE_URL
}));

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

function addDaysToIsoDate(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
  imobClient.clearCache();
  res.json({ success: true, message: 'Cache de pesquisas e cotações limpo com sucesso.' });
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

function reservationLookupAuthorized(req) {
  const expected = process.env.RESERVATION_LOOKUP_TOKEN;
  if (!expected) return { configured: false, authorized: false };
  const supplied = req.get('x-reservation-lookup-token') || '';
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  const sameLength = expectedBuffer.length === suppliedBuffer.length;
  const authorized = sameLength && timingSafeEqual(expectedBuffer, suppliedBuffer);
  return { configured: true, authorized };
}

function asPaymentList(response) {
  if (Array.isArray(response)) return response;
  if (!response || typeof response !== 'object') return null;
  for (const key of ['data', 'payments', 'results', 'items']) {
    if (Array.isArray(response[key])) return response[key];
  }
  return null;
}

// Busca uma reserva pelo código externo (partnerCode). O token é obrigatório
// porque códigos de Booking podem ser enumeráveis e a resposta contém dados da hospedagem.
app.get('/api/v1/reservations/:partnerCode', async (req, res) => {
  const auth = reservationLookupAuthorized(req);
  if (!auth.configured) {
    return res.status(503).json({
      sucesso: false,
      codigo: 'RESERVATION_LOOKUP_NOT_CONFIGURED',
      erro: 'A consulta de reservas ainda não está configurada.'
    });
  }
  if (!auth.authorized) {
    return res.status(401).json({ sucesso: false, codigo: 'UNAUTHORIZED', erro: 'Não autorizado.' });
  }

  const partnerCode = String(req.params.partnerCode || '').trim();
  if (!partnerCode || partnerCode.length > 100 || /[\u0000-\u001f\u007f/\\]/.test(partnerCode)) {
    return res.status(400).json({
      sucesso: false,
      codigo: 'INVALID_PARTNER_CODE',
      erro: 'Informe um código de reserva válido.'
    });
  }

  const requestId = req.get('x-request-id') || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  try {
    // Stays resolves partnerCode directly on the detail endpoint. The export
    // filter can return an empty list for valid Booking.com reservations.
    const reservation = await staysClient.getReservation(partnerCode);
    if (!reservation || typeof reservation !== 'object' || Array.isArray(reservation)) {
      logSearch('reservation.lookup.invalid_response', { request_id: requestId, duration_ms: Date.now() - startedAt });
      return res.status(502).json({ sucesso: false, codigo: 'STAYS_INVALID_RESERVATION_DETAILS', erro: 'A Stays retornou detalhes de reserva em formato inesperado.' });
    }
    if (String(reservation.partnerCode || '').trim().toLocaleLowerCase('pt-BR') !== partnerCode.toLocaleLowerCase('pt-BR')) {
      logSearch('reservation.lookup.identifier_mismatch', { request_id: requestId, duration_ms: Date.now() - startedAt });
      return res.status(404).json({
        sucesso: true,
        encontrada: false,
        mensagem: 'Não encontrei uma reserva com esse código. Confira se o código foi digitado corretamente.'
      });
    }

    const internalId = reservation._id || reservation.id;
    if (!internalId) {
      return res.status(502).json({ sucesso: false, codigo: 'STAYS_RESERVATION_ID_MISSING', erro: 'A reserva foi localizada, mas não foi possível consultar os detalhes.' });
    }

    const warnings = [];
    const [paymentsResult, listingResult] = await Promise.allSettled([
      staysClient.getReservationPayments(internalId),
      reservation._idlisting ? staysClient.getListing(reservation._idlisting) : Promise.resolve(null)
    ]);
    let payments = null;
    if (paymentsResult.status === 'fulfilled') {
      payments = asPaymentList(paymentsResult.value);
      if (!payments) warnings.push('A lista de pagamentos retornou um formato inesperado.');
    } else {
      warnings.push('Não foi possível consultar os lançamentos de pagamento.');
    }

    let listing = null;
    let property = null;
    if (listingResult.status === 'fulfilled') {
      listing = listingResult.value;
      if (listing?._idproperty) {
        try {
          property = await staysClient.getProperty(listing._idproperty);
          if (!property || typeof property !== 'object' || Array.isArray(property)) {
            property = null;
            warnings.push('A Stays não retornou os detalhes do condomínio.');
          }
        } catch {
          warnings.push('Não foi possível consultar o nome do condomínio.');
        }
      } else if (reservation._idlisting) {
        warnings.push('O imóvel não retornou vínculo com um condomínio.');
      }
    } else {
      warnings.push('Não foi possível consultar os detalhes do imóvel.');
    }

    const normalized = normalizeReservation({ reservation, payments, listing, property });
    if (!listing) warnings.push('Os dados de apartamento e descrição podem estar incompletos.');
    logSearch('reservation.lookup.success', {
      request_id: requestId,
      duration_ms: Date.now() - startedAt,
      reservation_status: reservation.type || 'unknown',
      payment_status: normalized.pagamento.status,
      warning_count: warnings.length
    });

    return res.json({
      sucesso: true,
      encontrada: true,
      mensagem: 'Reserva localizada. Os campos estão normalizados para orientar o atendimento.',
      reserva: normalized,
      dados_completos: warnings.length === 0,
      avisos: warnings
    });
  } catch (error) {
    if (error.status === 404) {
      logSearch('reservation.lookup.not_found', { request_id: requestId, duration_ms: Date.now() - startedAt });
      return res.status(404).json({
        sucesso: true,
        encontrada: false,
        mensagem: 'Não encontrei uma reserva com esse código. Confira se o código foi digitado corretamente.'
      });
    }
    logSearch('reservation.lookup.error', {
      request_id: requestId,
      code: error.code || 'RESERVATION_LOOKUP_FAILED',
      ...(error.status ? { status: error.status } : {}),
      duration_ms: Date.now() - startedAt
    });
    return publicError(res, error);
  }
});

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

// Pesquisa um empreendimento pelo nome sem depender de datas de hospedagem (Stays + Imob).
app.get('/api/v1/properties', async (req, res) => {
  try {
    const query = String(req.query.q || req.query.query || '').trim();
    if (!query) return res.status(400).json({ sucesso: false, codigo: 'MISSING_PROPERTY_QUERY', erro: 'Informe parte do nome da propriedade em q.' });
    const enriched = await propertyCatalog.searchProperties(query);
    return res.json({
      sucesso: true,
      total_encontrados: enriched.length,
      propriedades: enriched
    });
  } catch (error) {
    return publicError(res, error);
  }
});

// Detalhes ricos de uma acomodação específica, sem iniciar checkout ou criar reserva.
app.get('/api/v1/listings/:id', async (req, res) => {
  const targetId = req.params.id;
  const isNumeric = /^\d+$/.test(targetId);

  // Se for ID numérico (Imob), busca no catálogo de condomínios
  if (isNumeric) {
    const imobCondo = propertyCatalog.allImobCondominiums.find((item) => String(item.id) === targetId);
    if (imobCondo) {
      return res.json({
        sucesso: true,
        acomodacao: {
          id: String(imobCondo.id),
          nome: imobCondo.nome,
          propriedade: imobCondo.nome,
          cidade: imobCondo.cidade,
          capacidade: null,
          quartos: null,
          camas: null,
          banheiros: null,
          descricao: imobCondo.descricao,
          regras: '',
          comodidades: imobCondo.comodidades,
          imagem_principal: null,
          imagens: [],
          link_base: `https://reservascrcn.com.br/parceiro/1/${encodeURIComponent(imobCondo.id)}`
        }
      });
    }
  }

  try {
    const [listing, filters] = await Promise.all([
      staysClient.getListing(targetId),
      staysClient.getSearchFilters()
    ]);
    const property = listing?._idproperty ? await staysClient.getProperty(listing._idproperty).catch(() => null) : null;
    const images = (listing?._t_imagesMeta || []).map((image) => image?.url).filter(Boolean);
    return res.json({
      sucesso: true,
      acomodacao: {
        id: listing?.id || targetId,
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
        link_base: `https://www.centraldereservascaldas.com.br/pt/apartment/${encodeURIComponent(listing?.id || targetId)}`
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
  const hasAmenityPreference = filterInput.amenities.length > 0;

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
    let pageCandidates = [];

    // 6. Busca com cache e resolução unificada de propriedade (Stays + Imob)
    let staysPropertyNotFound = false;
    let searchFilters = {};
    let resolvedProperty = null;

    if (filterInput.properties.length > 0) {
      resolvedProperty = await propertyCatalog.resolvePropertyFilter(filterInput.properties[0]);
      if (resolvedProperty?.type === 'mapping_pending') {
        return res.status(409).json({
          sucesso: false,
          codigo: 'PROPERTY_MAPPING_PENDING',
          erro: 'O vínculo entre provedores desta propriedade ainda não foi validado; a busca foi interrompida para evitar consultar o condomínio errado.',
          propriedade: {
            property_key: resolvedProperty.propertyKey,
            nome: resolvedProperty.name,
            status_mapeamento: resolvedProperty.mappingStatus
          },
          instrucao_para_o_agente: {
            o_que_fazer: 'Não diga que não há disponibilidade. Explique que não foi possível confirmar o empreendimento e encaminhe para atendimento humano.',
            proibido: 'Não remova o filtro de propriedade nem escolha um ID de provedor por aproximação.'
          }
        });
      }
      if (resolvedProperty?.type === 'ambiguous') {
        return res.status(409).json({
          sucesso: false,
          codigo: 'PROPERTY_AMBIGUOUS',
          erro: 'O nome informado corresponde a mais de uma propriedade; a busca foi interrompida para evitar filtrar o condomínio errado.',
          instrucao_para_o_agente: {
            o_que_fazer: 'Mostre os resultados de buscar_propriedade_crcn e pergunte qual empreendimento o cliente deseja.',
            proibido: 'Não escolha um resultado por aproximação nem remova o filtro de propriedade.'
          }
        });
      }
      if (!resolvedProperty || resolvedProperty.type === 'unknown') {
        const propertyKeyRequired = resolvedProperty?.code === 'PROPERTY_KEY_REQUIRED';
        return res.status(422).json({
          sucesso: false,
          codigo: propertyKeyRequired ? 'PROPERTY_KEY_REQUIRED' : 'PROPERTY_NOT_RESOLVED',
          erro: propertyKeyRequired
            ? 'O filtro de disponibilidade exige o property_key interno retornado pelo catálogo CRCN.'
            : 'Não foi possível associar o empreendimento informado a uma propriedade única do catálogo CRCN.',
          instrucao_para_o_agente: {
            o_que_fazer: 'Pesquise o nome com buscar_propriedade_crcn e confirme com o cliente qual resultado corresponde ao empreendimento desejado.',
            proibido: 'Não faça uma busca geral removendo o filtro de propriedade.'
          }
        });
      }
    }

    if (resolvedProperty?.type === 'imob_only' && hasAmenityPreference) {
      return res.status(422).json({
        sucesso: false,
        codigo: 'AMENITY_FILTER_UNSUPPORTED_BY_PROVIDER',
        erro: 'Este empreendimento só está disponível no Imob, que não oferece filtro de comodidades nesta busca.',
        valores: filterInput.amenities,
        instrucao_para_o_agente: {
          o_que_fazer: 'Explique que não é possível confirmar essa comodidade para este empreendimento e pergunte se o cliente aceita pesquisar sem esse filtro. Não remova a comodidade sem autorização.',
          proibido: 'Não apresente opções como se a comodidade tivesse sido verificada.'
        }
      });
    }

    if (resolvedProperty?.type === 'imob_only') {
      staysPropertyNotFound = true;
      searchFilters = {};
    } else {
      try {
        const staysInputProperties = resolvedProperty?.staysFilter || filterInput.properties;
        searchFilters = await staysClient.resolveSearchFilters({
          ...filterInput,
          properties: staysInputProperties
        });
      } catch (error) {
        if (error.code !== 'STAYS_FILTER_NOT_FOUND' || filterInput.properties.length === 0) throw error;
        staysPropertyNotFound = true;
        searchFilters = await staysClient.resolveSearchFilters({ ...filterInput, properties: [] });
        logSearch('search.stays_property_filter_unavailable', {
          request_id: requestId,
          property_key: resolvedProperty?.propertyKey || null,
          code: error.code
        });
      }
    }

    const imobQueryTarget = resolvedProperty?.imobId || resolvedProperty?.imobName || (filterInput.properties.length ? filterInput.properties[0] : null);

    const cacheFilters = {
      ...searchFilters,
      _requested_property: filterInput.properties,
      _selection_strategy: 'portfolio-v1',
      _candidate_limit: CANDIDATE_SEARCH_LIMIT,
      _page: page
    };
    const { data: responseData, isHit, cacheStatus } = await fetchWithDeduplication(
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
        let staysFailed = false;
        let listings = [];
        const imobAmenityUnsupported = hasAmenityPreference && imobClient.configured && resolvedProperty?.type !== 'stays_only';
        const providerResults = {
          stays: {
            status: resolvedProperty?.type === 'imob_only' ? 'not_required' : staysPropertyNotFound ? 'error' : 'not_queried',
            property_filter: resolvedProperty?.staysId || null,
            ...(staysPropertyNotFound ? { code: 'STAYS_FILTER_NOT_FOUND' } : {})
          },
          imob: {
            status: imobClient.configured ? 'not_queried' : 'not_configured',
            condominium_filter: resolvedProperty?.imobId || null,
            ...(imobAmenityUnsupported ? { code: 'AMENITY_FILTER_UNSUPPORTED' } : {})
          }
        };
        if (!staysPropertyNotFound) {
          if (resolvedProperty?.type !== 'imob_only') providerResults.stays.status = 'queried';
          try {
            const cachedStays = await fetchWithDeduplication(
              validFrom.str,
              validTo.str,
              numPersons,
              CANDIDATE_SEARCH_LIMIT,
              () => staysClient.search({
                from: validFrom.str,
                to: validTo.str,
                persons: numPersons,
                limit: CANDIDATE_SEARCH_LIMIT,
                skip: candidateWindowOffset,
                filters: searchFilters,
                requestId
              }),
              candidateCacheFilters,
              { cacheResult: false }
            );
            listings = cachedStays.data || [];
            providerResults.stays.status = listings.length ? 'available' : 'no_availability';
            providerResults.stays.total_encontrados = listings.length;
          } catch (staysErr) {
            logSearch('search.stays_failure_fallback_to_imob', {
              request_id: requestId,
              code: staysErr.code
            });
            staysFailed = true;
            listings = [];
            providerResults.stays.status = 'error';
            providerResults.stays.code = staysErr.code || 'STAYS_REQUEST_FAILED';
            if (!imobClient.configured) throw staysErr;
          }
        }

        const orderedListings = selectDiverseListings(listings, listings.length, {
          preferDifferentProperties: filterInput.properties.length === 0
        });
        let imobRecords = [];
        let fallbackWarning = null;
        let capacityFallbackWarning = null;
        let capacityFallbackUsed = false;
        let minimumStayAlternative = null;
        let minimumStayHandled = false;
        if (staysFailed) {
          fallbackWarning = {
            codigo: 'STAYS_UPSTREAM_UNAVAILABLE',
            mensagem: 'O inventário oficial da Stays está temporariamente indisponível. Exibindo opções parceiras.'
          };
        }
        // Consulta Imob como contingência caso Stays falhe, propriedade seja exclusiva Imob, ou faltem opções para preencher a janela solicitada
        const imobPropertyRequired = resolvedProperty?.type === 'hybrid' || resolvedProperty?.type === 'imob_only';
        const needsImobSupplement = imobPropertyRequired || staysPropertyNotFound || staysFailed ||
          orderedListings.length < offsetWithinWindow + limitResults ||
          (!filterInput.properties.length && orderedListings.length < 3);

        if (imobClient.configured && needsImobSupplement && !hasAmenityPreference) {
          providerResults.imob.status = 'queried';
          try {
            imobRecords = imobQueryTarget
              ? await imobClient.searchForProperty({
                  from: validFrom.str,
                  to: validTo.str,
                  persons: numPersons,
                  propertyName: imobQueryTarget,
                  requestId
                })
              : await imobClient.searchByOccupancyRange({
                  from: validFrom.str,
                  to: validTo.str,
                  persons: numPersons,
                  requestId
                });

            if (resolvedProperty?.imobId) {
              const unexpectedRecords = imobRecords.filter((record) => {
                const sourceId = record?.condominioId ?? record?.idCondominio ?? record?.condominio;
                return sourceId == null || String(sourceId) !== String(resolvedProperty.imobId);
              });
              if (unexpectedRecords.length) {
                logSearch('search.imob_property_scope_mismatch', {
                  request_id: requestId,
                  property_key: resolvedProperty.propertyKey,
                  expected_condominium_id: String(resolvedProperty.imobId),
                  rejected_records: unexpectedRecords.length
                });
                imobRecords = imobRecords.filter((record) => {
                  const sourceId = record?.condominioId ?? record?.idCondominio ?? record?.condominio;
                  return sourceId != null && String(sourceId) === String(resolvedProperty.imobId);
                });
              }
            }

            providerResults.imob.status = imobRecords.length ? 'available' : 'no_availability';
            providerResults.imob.total_encontrados = imobRecords.length;

            // Use sempre o nome canônico publicado no catálogo quando o ID for conhecido.
            imobRecords.forEach((record) => {
              const condominiumId = record?.condominioId ?? record?.idCondominio ?? record?.condominio;
              const canonicalName = propertyCatalog.getImobCondominiumName(condominiumId);
              if (canonicalName) record.nomeCond = canonicalName;
            });

            capacityFallbackUsed = Boolean(imobRecords.capacityFallback);
            if (capacityFallbackUsed) {
              capacityFallbackWarning = {
                codigo: 'IMOB_CAPACITY_FILTER_WIDENED',
                mensagem: `Não houve opções na faixa preferida de capacidade até ${imobRecords.preferredMaxOccupants}. A busca foi ampliada para unidades maiores que acomodam ${numPersons} hóspedes.`
              };
              logSearch('search.imob_capacity_fallback', {
                request_id: requestId,
                persons: numPersons,
                preferred_max_occupants: imobRecords.preferredMaxOccupants,
                returned_options: imobRecords.length,
                highest_returned_capacity: Math.max(0, ...imobRecords.map((record) => Number(record.maxOcupantes || record.max_ocupantes || record.capacidade || record.maxPax || 0)))
              });
            }

            // Registra dinamicamente no catálogo para próximas pesquisas
            imobRecords.forEach((record) => propertyCatalog.registerDiscoveredImob(record));
          } catch (error) {
            providerResults.imob.status = 'error';
            providerResults.imob.code = error.code || 'IMOB_REQUEST_FAILED';
            if (error.code === 'IMOB_MINIMUM_NIGHTS' && Number.isInteger(error.minimumNights) && error.minimumNights > nights) {
              minimumStayHandled = true;
              const alternativeTo = addDaysToIsoDate(validFrom.str, error.minimumNights);
              minimumStayAlternative = {
                minimo_noites: error.minimumNights,
                total_encontrados: 0,
                periodo: {
                  check_in: validFrom.str,
                  check_out: alternativeTo,
                  noites: error.minimumNights,
                  hospedes: numPersons
                },
                opcoes: []
              };
              fallbackWarning = {
                codigo: 'IMOB_MINIMUM_NIGHTS',
                mensagem: `O Imob exige no mínimo ${error.minimumNights} noites. Foi consultada uma alternativa mantendo a entrada e os hóspedes.`
              };
              try {
                const alternativeRecords = await imobClient.searchByOccupancyRange({
                  from: validFrom.str,
                  to: alternativeTo,
                  persons: numPersons,
                  condominiumId: resolvedProperty?.imobId || null,
                  requestId
                });
                const alternativeCriteria = {
                  from: validFrom.str,
                  to: alternativeTo,
                  persons: numPersons,
                  nights: error.minimumNights,
                  page
                };
                const alternativeOptions = alternativeRecords
                  .map((record) => normalizeImobListing(record, alternativeCriteria))
                  .filter((option) => option.link_reserva)
                  .slice(0, limitResults);

                await Promise.all(alternativeOptions.filter((option) => !option.valor_total && option.id).map(async (option) => {
                  try {
                    const pixPrice = await imobClient.getPixPrice({
                      listingId: option.id,
                      from: validFrom.str,
                      to: alternativeTo,
                      persons: numPersons
                    });
                    if (pixPrice) {
                      option.valor_total = pixPrice;
                      option.valor_diaria = Math.round((pixPrice / error.minimumNights) * 100) / 100;
                    }
                  } catch (priceError) {
                    logSearch('search.imob_minimum_stay_price_error', {
                      request_id: requestId,
                      code: priceError.code || 'IMOB_PRICE_REQUEST_FAILED'
                    });
                  }
                }));

                minimumStayAlternative.total_encontrados = alternativeRecords.length;
                minimumStayAlternative.opcoes = alternativeOptions;
                minimumStayAlternative.capacidade_ampliada = Boolean(alternativeRecords.capacityFallback);
                minimumStayAlternative.capacidade_maxima_preferida = alternativeRecords.preferredMaxOccupants;
                if (minimumStayAlternative.capacidade_ampliada) {
                  capacityFallbackWarning = {
                    codigo: 'IMOB_CAPACITY_FILTER_WIDENED',
                    mensagem: `Não houve opções na faixa preferida até ${alternativeRecords.preferredMaxOccupants}; a busca ampliou para acomodações maiores que comportam ${numPersons} hóspedes.`
                  };
                }
                logSearch('search.imob_minimum_stay_fallback', {
                  request_id: requestId,
                  requested_from: validFrom.str,
                  requested_to: validTo.str,
                  alternative_to: alternativeTo,
                  persons: numPersons,
                  minimum_nights: error.minimumNights,
                  returned_options: alternativeOptions.length
                });
              } catch (fallbackError) {
                logSearch('search.imob_minimum_stay_fallback_error', {
                  request_id: requestId,
                  code: fallbackError.code || 'IMOB_REQUEST_FAILED',
                  ...(fallbackError.status ? { status: fallbackError.status } : {}),
                  ...(fallbackError.upstreamCode ? { upstream_code: fallbackError.upstreamCode } : {}),
                  ...(fallbackError.upstreamMessage ? { upstream_message: fallbackError.upstreamMessage } : {}),
                  attempts: fallbackError.attempts || 1
                });
              }
            }
            if (error.code === 'IMOB_TARIFF_UNAVAILABLE') {
              fallbackWarning = {
                codigo: error.code,
                mensagem: 'A parceira complementar não tem tarifário disponível para esse período.'
              };
            }
            if (minimumStayHandled) {
              logSearch('search.imob_minimum_stay_detected', {
                request_id: requestId,
                minimum_nights: error.minimumNights,
                alternative_to: minimumStayAlternative.periodo.check_out,
                alternative_options: minimumStayAlternative.opcoes.length,
                ...(error.upstreamMessage ? { upstream_message: error.upstreamMessage } : {})
              });
            } else {
              logSearch('search.imob_error', {
                request_id: requestId,
                operation: 'availability_search',
                code: error.code || 'IMOB_REQUEST_FAILED',
                ...(error.status ? { status: error.status } : {}),
                ...(error.upstreamCode ? { upstream_code: error.upstreamCode } : {}),
                ...(error.upstreamMessage ? { upstream_message: error.upstreamMessage } : {}),
                attempts: error.attempts || 1,
                duration_ms: error.durationMs || null
              });
            }
          }
        } else {
          providerResults.imob.status = imobClient.configured
            ? (imobAmenityUnsupported ? 'not_queried' : (imobPropertyRequired ? 'not_queried' : 'not_required'))
            : 'not_configured';
          logSearch('provider.skipped', {
            request_id: requestId,
            provider: 'imob',
            operation: 'availability_search',
            reason: imobClient.configured ? 'not_needed_to_fill_results' : 'not_configured',
            stays_candidates: orderedListings.length,
            requested_results: limitResults
          });
        }

        const nightsCriteria = {
          from: validFrom.str,
          to: validTo.str,
          persons: numPersons,
          nights,
          page
        };

        const imobCandidates = [];
        const seenImob = new Set();
        for (const record of imobRecords) {
          const option = normalizeImobListing(record, nightsCriteria);
          if (!option.link_reserva) continue;
          const identity = `${option.id || ''}|${option.link_reserva}`;
          if (seenImob.has(identity)) continue;
          seenImob.add(identity);
          imobCandidates.push({ record, option });
        }

        const diversifiedImob = imobCandidates.length
          ? selectDiverseListings(imobCandidates.map((i) => i.option), imobCandidates.length, {
              preferDifferentProperties: filterInput.properties.length === 0
            })
          : [];

        const portfolio = [
          ...orderedListings.map((listing) => ({ provider: 'stays', listing })),
          ...diversifiedImob.map((listing) => ({ provider: 'imob', listing }))
        ];
        pageCandidates = portfolio.slice(offsetWithinWindow, offsetWithinWindow + limitResults);

        // Otimização: Cota preço PIX SOMENTE para as opções do Imob que realmente entrarão na página!
        const imobRecordsById = new Map(imobCandidates.map((i) => [String(i.record?.id), i.record]));
        await Promise.all(pageCandidates.filter((c) => c.provider === 'imob').map(async (candidate) => {
          const opt = candidate.listing;
          if (opt.valor_total || !opt.id) return;
          try {
            const pixPrice = await imobClient.getPixPrice({
              listingId: opt.id,
              from: validFrom.str,
              to: validTo.str,
              persons: numPersons
            });
            if (pixPrice) {
              opt.valor_total = pixPrice;
              opt.valor_diaria = nights > 0 ? Math.round((pixPrice / nights) * 100) / 100 : pixPrice;
              const raw = imobRecordsById.get(String(opt.id));
              if (raw) raw.valorTotal = pixPrice;
            }
          } catch (error) {
            logSearch('search.imob_price_error', {
              request_id: requestId,
              code: error.code || 'IMOB_PRICE_REQUEST_FAILED'
            });
          }
        }));

        const selectedStays = pageCandidates.filter((c) => c.provider === 'stays').map((c) => c.listing);
        const enrichedListings = selectedStays.length ? await staysClient.enrichListings(selectedStays) : [];
        const staysOptions = processAndRankResults(enrichedListings, nightsCriteria);
        if (resolvedProperty?.imobName) {
          staysOptions.forEach((option) => { option.condominio = resolvedProperty.imobName; });
        }
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
        const requiredProviderNames = resolvedProperty?.type === 'hybrid'
          ? ['stays', 'imob']
          : resolvedProperty?.type === 'imob_only'
            ? ['imob']
            : resolvedProperty?.type === 'stays_only'
              ? ['stays']
              : ['stays'];
        const providerSearchComplete = requiredProviderNames.every((name) =>
          ['available', 'no_availability'].includes(providerResults[name]?.status)
        );
        const incompleteProviders = requiredProviderNames
          .filter((name) => !['available', 'no_availability'].includes(providerResults[name]?.status))
          .map((name) => ({ provider: name, status: providerResults[name]?.status || 'not_queried', code: providerResults[name]?.code || null }));
        const providerCoverageWarning = incompleteProviders.length
          ? {
              codigo: 'PROVIDER_SEARCH_INCOMPLETE',
              mensagem: 'A busca não foi concluída em todos os provedores vinculados a este empreendimento. Os resultados disponíveis são parciais; a ausência de opções não pode ser tratada como indisponibilidade confirmada.'
            }
          : null;
        const partialAmenityCoverage = hasAmenityPreference && providerResults.stays.status === 'no_availability' &&
          providerResults.imob.code === 'AMENITY_FILTER_UNSUPPORTED';
        const noResultsInstruction = allOptions.length === 0
          ? partialAmenityCoverage
            ? {
                o_que_fazer: `A busca aplicou a comodidade somente na Stays. O Imob não permite aplicar esse filtro e não foi consultado. NÃO afirme indisponibilidade geral. Pergunte se o cliente autoriza tentar outras datas; se autorizar, altere somente as datas e mantenha ${filterInput.properties.length ? 'o mesmo condomínio, ' : ''}a mesma comodidade e os demais filtros.`,
                sugestao_de_fala: 'Não encontrei opções com essa comodidade nas datas escolhidas na fonte que permite verificar esse filtro. O outro sistema não consegue confirmar comodidades. Você teria flexibilidade para tentar outras datas mantendo essa preferência?'
              }
            : providerSearchComplete
            ? {
                o_que_fazer: 'NÃO invente opções fictícias nem links de exemplo. Os provedores requeridos foram consultados e não retornaram disponibilidade para esse período exato. Explique isso com cordialidade e sugira datas alternativas.',
                sugestao_de_fala: 'Não encontrei apartamentos disponíveis para essas datas exatas. Você teria flexibilidade para viajar em outro período ou fim de semana?'
              }
            : {
                o_que_fazer: 'A busca não foi concluída em todos os provedores vinculados a este empreendimento. NÃO afirme que não há disponibilidade. Explique que não conseguiu confirmar a consulta e encaminhe para atendimento humano ou tente novamente após corrigir a integração.',
                sugestao_de_fala: 'Não consegui confirmar a disponibilidade em todos os sistemas para esse empreendimento. Vou pedir para um atendente verificar para você.'
              }
          : null;

        return {
          sucesso: true,
          total_encontrados: listings.length + imobRecords.length,
          total_exato: listings.length < CANDIDATE_SEARCH_LIMIT,
          opcoes_retornadas: allOptions.length,
          mais_opcoes_disponiveis: hasMore,
          proxima_pagina: hasMore ? page + 1 : null,
          relogio_oficial: today.relogio,
          periodo: {
            check_in: validFrom.str,
            check_out: validTo.str,
            noites: nights,
            hospedes: numPersons
          },
          filtros_aplicados: searchFilters,
          provedores_consultados: providerResults,
          ...(hasAmenityPreference ? {
            cobertura_filtros: {
              amenities: {
                valores_solicitados: filterInput.amenities,
                provedores_com_filtro_aplicado: ['stays'],
                provedores_sem_filtro_aplicado: imobAmenityUnsupported ? ['imob'] : []
              }
            }
          } : {}),
          ...(noResultsInstruction ? { instrucao_para_o_agente: noResultsInstruction } : {}),
          ...((fallbackWarning || capacityFallbackWarning) ? {
            avisos: [fallbackWarning, capacityFallbackWarning].filter(Boolean)
          } : {}),
          ...(providerCoverageWarning ? {
            avisos: [...(fallbackWarning || capacityFallbackWarning ? [fallbackWarning, capacityFallbackWarning].filter(Boolean) : []), providerCoverageWarning]
          } : {}),
          ...(capacityFallbackUsed ? {
            instrucao_para_o_agente: {
              o_que_fazer: 'A faixa preferida de capacidade não encontrou opções. A busca foi ampliada e encontrou acomodações maiores que comportam o grupo. Não diga que não há disponibilidade; informe claramente a capacidade de cada opção e confirme se o cliente aceita uma acomodação maior.',
              sugestao_de_fala: `Não encontrei opções menores para ${numPersons} hóspedes, mas achei acomodações para esse grupo com capacidade maior. Posso te mostrar essas opções e informar a capacidade de cada uma?`
            }
          } : {}),
          ...(minimumStayAlternative ? {
            alternativa_estadia_minima: minimumStayAlternative,
            instrucao_para_o_agente: {
              o_que_fazer: minimumStayAlternative.opcoes.length
                ? `O provedor exige uma estadia mínima. A API consultou automaticamente uma alternativa com a mesma entrada e o mesmo número de hóspedes. Apresente as opções com as datas exatas, explique a quantidade mínima de noites${minimumStayAlternative.capacidade_ampliada ? ', informe que a busca foi ampliada para unidades maiores e diga a capacidade de cada uma' : ''} e confirme se o cliente aceita esse período antes de avançar.`
                : 'O provedor exige uma estadia mínima. A API tentou consultar uma alternativa com a mesma entrada e o mesmo número de hóspedes, mas não encontrou opções para esse período. Explique a regra mínima com clareza e pergunte se o cliente tem flexibilidade de datas.',
              sugestao_de_fala: minimumStayAlternative.opcoes.length
                ? `Para essa data de entrada, o Imob exige pelo menos ${minimumStayAlternative.minimo_noites} noites. Consultei opções para ${minimumStayAlternative.periodo.check_in} a ${minimumStayAlternative.periodo.check_out}; quer que eu te apresente essas alternativas?`
                : `Para essa data de entrada, o Imob exige pelo menos ${minimumStayAlternative.minimo_noites} noites e não encontrei opções nesse período alternativo. Você teria flexibilidade para outras datas?`
            }
          } : {}),
          opcoes: allOptions
        };
      },
      cacheFilters,
      { cacheResult: false }
    );

    // Ajustar opções conforme limitResults solicitado e tempo de resposta
    const finalOptions = responseData.opcoes.slice(0, limitResults);
    
    res.setHeader('X-Cache', cacheStatus || (isHit ? 'HIT' : 'MISS'));
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
      cache: cacheStatus || (isHit ? 'HIT' : 'MISS'),
      total_encontrados: responseData.total_encontrados,
      returned_options: finalOptions.length,
      provider_results: {
        stays: pageCandidates.filter((candidate) => candidate.provider === 'stays').length,
        imob: pageCandidates.filter((candidate) => candidate.provider === 'imob').length
      },
      provider_searches: responseData.provedores_consultados,
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

// Middleware global de captura de erros não tratados do Express
app.use((err, req, res, next) => {
  console.error('[crcn-search-api] Erro interno não tratado:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({
    sucesso: false,
    codigo: 'INTERNAL_SERVER_ERROR',
    erro: 'Ocorreu um erro interno inesperado no servidor.'
  });
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
