const DAY_MS = 86_400_000;
const { todayInSaoPaulo } = require('./date-calculator');
const { normalizeImobListing } = require('./imob-normalizer');
const { processAndRankResults } = require('./normalizer');

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isOptionalText(value, maxLength = 100) {
  return value === undefined || value === null || value === '' || (typeof value === 'string' && value.length <= maxLength);
}

function safeReservation(reservation, payments) {
  const paymentRows = Array.isArray(payments) ? payments : [];
  let paymentDataValid = Array.isArray(payments);
  const totalPaid = paymentRows.reduce((total, payment) => {
    const status = String(payment?.status || '').toLowerCase();
    if (status !== 'completed') return total;
    const rawAmount = payment?._f_val ?? payment?.amount;
    const type = String(payment?.type || '').toLowerCase();
    const amount = Number(rawAmount);
    if (rawAmount === undefined || rawAmount === null || rawAmount === '' || !Number.isFinite(amount) || !['credit', 'debit'].includes(type)) {
      paymentDataValid = false;
      return total;
    }
    return total + (type === 'debit' ? -Math.abs(amount) : Math.abs(amount));
  }, 0);
  const guestsDetails = reservation?.guestsDetails || {};
  return {
    reservationCode: String(reservation?.partnerCode || reservation?._id || reservation?.id || ''),
    listingId: String(reservation?._idlisting || reservation?.listingId || ''),
    status: String(reservation?.status || reservation?.type || 'Reserva'),
    checkIn: reservation?.checkInDate || reservation?.from || null,
    checkOut: reservation?.checkOutDate || reservation?.to || null,
    guests: Number(reservation?.guests || guestsDetails?.adults || 0),
    guestsDetails: {
      adults: Number(guestsDetails?.adults || reservation?.guests || 0),
      children: Number(guestsDetails?.children || 0)
    },
    totalPaid: paymentDataValid ? Math.max(0, Math.round(totalPaid * 100) / 100) : null,
    currency: /^[A-Z]{3}$/.test(reservation?.price?.currency || '') ? reservation.price.currency : 'BRL'
  };
}

function validateAvailability(body) {
  const from = String(body?.from || '');
  const to = String(body?.to || '');
  if (!isIsoDate(from) || !isIsoDate(to)) return { error: 'Informe datas válidas no formato YYYY-MM-DD.' };
  const nights = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
  if (!Number.isInteger(nights) || nights < 1 || nights > 60) return { error: 'O período deve ter entre 1 e 60 noites.' };
  const adults = Number(body?.adults);
  const children = Number(body?.children || 0);
  if (!Number.isInteger(adults) || adults < 1 || !Number.isInteger(children) || children < 0 || adults + children > 30) {
    return { error: 'Informe entre 1 e 30 hóspedes.' };
  }
  if (from < todayInSaoPaulo()) return { error: 'A data de chegada não pode estar no passado.' };
  return { from, to, nights, persons: adults + children, adults, children };
}

function providerError(res, error, fallbackMessage, { reservationLookup = false } = {}) {
  const status = error.code === 'STAYS_NOT_CONFIGURED' || error.code === 'IMOB_NOT_CONFIGURED' ? 503
    : error.code === 'STAYS_FILTER_NOT_FOUND' ? 400
      : error.status === 404 ? 404 : 502;
  const code = status === 503 ? 'PROVIDER_NOT_CONFIGURED'
    : status === 400 ? 'INVALID_FILTER'
      : status === 404 ? (reservationLookup ? 'RESERVATION_NOT_FOUND' : 'PROVIDER_RESOURCE_NOT_FOUND') : 'PROVIDER_UNAVAILABLE';
  const message = status === 503 ? 'A integração solicitada não está configurada.'
    : status === 400 ? 'O filtro informado não foi encontrado no catálogo do provedor.'
      : status === 404 ? (reservationLookup ? 'Reserva não encontrada.' : fallbackMessage) : fallbackMessage;
  return res.status(status).json({ success: false, error: { code, message } });
}

function createCommercialAssistantRouter({ express, fetchImpl = global.fetch, staysClient, imobClient, authServiceUrl }) {
  const router = express.Router();
  const configuredAuthUrl = String(authServiceUrl || '').replace(/\/$/, '');
  const requestWindows = new Map();

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    return next();
  });

  router.use(async (req, res, next) => {
    const authorization = req.get('authorization') || '';
    if (!/^Bearer\s+\S+$/i.test(authorization)) return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } });
    if (!configuredAuthUrl) return res.status(503).json({ success: false, error: { code: 'AUTH_UNAVAILABLE', message: 'Validação de sessão indisponível.' } });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetchImpl(`${configuredAuthUrl}/api/v1/auth/validate`, {
        method: 'POST', signal: controller.signal,
        headers: { Authorization: authorization, Accept: 'application/json', 'Content-Type': 'application/json' }, body: '{}'
      });
      if (response.status === 401 || response.status === 403) return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } });
      if (!response.ok) return res.status(503).json({ success: false, error: { code: 'AUTH_UNAVAILABLE', message: 'Validação de sessão indisponível.' } });
      const payload = await response.json();
      if (payload?.success !== true || !payload?.data?.user?.id) return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } });
      req.crmUserId = String(payload.data.user.id);
      const now = Date.now();
      let window = requestWindows.get(req.crmUserId);
      if (!window || now - window.startedAt >= 60_000) window = { startedAt: now, count: 0 };
      window.count += 1;
      requestWindows.set(req.crmUserId, window);
      if (requestWindows.size > 10_000) {
        for (const [userId, item] of requestWindows) if (now - item.startedAt >= 60_000) requestWindows.delete(userId);
        if (requestWindows.size > 10_000) requestWindows.delete(requestWindows.keys().next().value);
      }
      if (window.count > 30) {
        res.set('Retry-After', String(Math.max(1, Math.ceil((60_000 - (now - window.startedAt)) / 1000))));
        return res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Limite de consultas atingido. Tente novamente em instantes.' } });
      }
      return next();
    } catch {
      return res.status(503).json({ success: false, error: { code: 'AUTH_UNAVAILABLE', message: 'Validação de sessão indisponível.' } });
    } finally { clearTimeout(timeout); }
  });

  router.post('/availability', async (req, res) => {
    const criteria = validateAvailability(req.body);
    if (criteria.error) return res.status(400).json({ success: false, error: { code: 'INVALID_SEARCH', message: criteria.error } });
    if (!isOptionalText(req.body.inventory)) return res.status(400).json({ success: false, error: { code: 'INVALID_FILTER', message: 'O filtro de inventário deve ser um texto curto.' } });
    try {
      if (req.body.source === 'imobsys') {
        if (!imobClient.configured) return res.status(503).json({ success: false, error: { code: 'PROVIDER_NOT_CONFIGURED', message: 'A integração solicitada não está configurada.' } });
        const filters = req.body.filters || {};
        if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
          return res.status(400).json({ success: false, error: { code: 'INVALID_FILTER', message: 'Os filtros Imob devem ser enviados como objeto.' } });
        }
        const supported = new Set(['condominio', 'umCada']);
        const hasValue = (value) => value !== undefined && value !== null && value !== '' && value !== false && value !== 'all';
        const unsupported = Object.entries(filters).some(([key, value]) => !supported.has(key) && hasValue(value));
        if (unsupported || !isOptionalText(filters.condominio, 64) || (filters.umCada !== undefined && typeof filters.umCada !== 'boolean')) {
          return res.status(400).json({ success: false, error: { code: 'UNSUPPORTED_FILTER', message: 'Um ou mais filtros não são suportados pelo contrato Imob atual.' } });
        }
        const records = await imobClient.search({
          from: criteria.from, to: criteria.to, persons: criteria.persons,
          condominiumId: filters.condominio || null,
          onePerCondominium: filters.umCada === true
        });
        // Preserve provider results without a booking URL instead of silently
        // turning a non-empty response into an empty search result.
        const options = records.map((record) => normalizeImobListing(record, criteria));
        return res.json({ success: true, data: { alternatives: options, period: { from: criteria.from, to: criteria.to, nights: criteria.nights, guests: criteria.persons }, limitations: ['A idade individual das crianças não é aplicada pela API parceira; apenas o total de hóspedes é enviado.'] } });
      }
      if (req.body.source && req.body.source !== 'stays') return res.status(400).json({ success: false, error: { code: 'INVALID_SOURCE', message: 'Origem de busca inválida.' } });
      if (!staysClient.configured) return res.status(503).json({ success: false, error: { code: 'PROVIDER_NOT_CONFIGURED', message: 'A integração solicitada não está configurada.' } });
      const filters = await staysClient.resolveSearchFilters({ inventory: req.body.inventory ? [req.body.inventory] : [] });
      const results = await staysClient.search({ from: criteria.from, to: criteria.to, persons: criteria.persons, limit: 20, filters });
      const enriched = await staysClient.enrichListings(results);
      const alternatives = processAndRankResults(enriched, criteria);
      return res.json({ success: true, data: { alternatives, period: { from: criteria.from, to: criteria.to, nights: criteria.nights, guests: criteria.persons } } });
    } catch (error) {
      return providerError(res, error, 'Não foi possível consultar a disponibilidade agora.');
    }
  });

  router.post('/reservation', async (req, res) => {
    const code = String(req.body?.reservationCode || '').trim();
    if (!code || code.length > 100) return res.status(400).json({ success: false, error: { code: 'INVALID_RESERVATION_CODE', message: 'Informe um código de reserva válido.' } });
    try {
      const [reservation, payments] = await Promise.all([
        staysClient.getReservation(code),
        staysClient.getReservationPayments(code).catch(() => null)
      ]);
      if (!reservation || typeof reservation !== 'object') return res.status(404).json({ success: false, error: { code: 'RESERVATION_NOT_FOUND', message: 'Reserva não encontrada.' } });
      const paymentRows = Array.isArray(payments) ? payments : Array.isArray(payments?.payments) ? payments.payments : Array.isArray(payments?.data) ? payments.data : null;
      return res.json({ success: true, data: { reservation: safeReservation(reservation, paymentRows) } });
    } catch (error) {
      return providerError(res, error, 'Não foi possível consultar a reserva agora.', { reservationLookup: true });
    }
  });
  router.post('/alternative', async (req, res) => {
    const code = String(req.body?.reservationCode || '').trim();
    if (!code || code.length > 100) return res.status(400).json({ success: false, error: { code: 'INVALID_RESERVATION_CODE', message: 'Informe um código de reserva válido.' } });
    if (!isOptionalText(req.body?.amenity)) return res.status(400).json({ success: false, error: { code: 'INVALID_FILTER', message: 'O filtro de comodidade deve ser um texto curto.' } });
    let reservation;
    try {
      reservation = await staysClient.getReservation(code);
    } catch (error) {
      return providerError(res, error, 'Não foi possível consultar a reserva agora.', { reservationLookup: true });
    }
    try {
      const checkIn = reservation?.checkInDate || reservation?.from;
      const checkOut = reservation?.checkOutDate || reservation?.to;
      const guests = Number(reservation?.guests || reservation?.guestsDetails?.adults || 1);
      if (!isIsoDate(String(checkIn || '')) || !isIsoDate(String(checkOut || ''))) {
        return res.status(422).json({ success: false, error: { code: 'INVALID_RESERVATION_DATES', message: 'A reserva não contém datas válidas para consultar alternativas.' } });
      }
      const nights = (Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / DAY_MS;
      if (!Number.isInteger(nights) || nights < 1 || nights > 60 || !Number.isInteger(guests) || guests < 1 || guests > 30) {
        return res.status(422).json({ success: false, error: { code: 'INVALID_RESERVATION_CRITERIA', message: 'Os dados da reserva não permitem uma busca segura de alternativas.' } });
      }
      const filters = await staysClient.resolveSearchFilters({ amenities: req.body?.amenity ? [req.body.amenity] : [] });
      const listings = await staysClient.search({ from: checkIn, to: checkOut, persons: guests, limit: 20, filters });
      const enriched = await staysClient.enrichListings(listings);
      const alternatives = processAndRankResults(enriched, {
        from: checkIn, to: checkOut,
        nights,
        persons: guests
      }).filter((item) => String(item.id) !== String(reservation?._idlisting));
      return res.json({ success: true, data: { reservation: safeReservation(reservation, null), alternatives } });
    } catch (error) {
      return providerError(res, error, 'Não foi possível consultar alternativas agora.');
    }
  });
  return router;
}

module.exports = { createCommercialAssistantRouter, safeReservation, validateAvailability };
