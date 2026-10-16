const { LRUCache } = require('lru-cache');

const DEFAULT_BASE_URL = 'https://api.cnsp.app/crcn';
const DEFAULT_PUBLIC_BASE_URL = 'https://reservascrcn.com.br';
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_PRICE_TIMEOUT_MS = 5_000;
const DEFAULT_SEARCH_MAX_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 150;

function sanitizeDiagnostic(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email redacted]')
    .replace(/\b(?:\+?\d[\d ().-]{7,}\d)\b/g, '[number redacted]')
    .replace(/\b(bearer|basic)\s+[A-Z0-9._~+/-]+=*/gi, '$1 [redacted]')
    .replace(/\b(authorization|token|password|senha|api[_ -]?key|client[_ -]?secret|access[_ -]?token)\s*[:=]\s*[^ ,;]+/gi, '$1=[redacted]')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 200);
}

function getUpstreamErrorDetails(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const code = payload.code || payload.codigo || payload.error_code || payload.errorCode;
  const message = payload.message || payload.mensagem || payload.erro || payload.error;
  return {
    ...(code ? { upstreamCode: sanitizeDiagnostic(code) } : {}),
    ...(message ? { upstreamMessage: sanitizeDiagnostic(message) } : {})
  };
}

function hasRecognizedCollection(payload) {
  if (Array.isArray(payload)) return true;
  if (!payload || typeof payload !== 'object') return false;
  for (const key of ['opcoes', 'imoveis', 'orcamentos', 'resultados', 'data', 'dados', 'options', 'listings', 'results', 'items']) {
    if (Array.isArray(payload[key]) || hasRecognizedCollection(payload[key])) return true;
  }
  return ['id', 'idImovel', 'id_imovel', 'unidade', 'linkParceiro', 'link_parceiro'].some((key) => payload[key] != null);
}

function isRetryable(error) {
  if (['IMOB_TIMEOUT', 'IMOB_NETWORK_ERROR', 'IMOB_INVALID_RESPONSE', 'IMOB_API_ERROR'].includes(error.code)) return true;
  return error.code === 'IMOB_HTTP_ERROR'
    && (error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500);
}

function logProviderEvent(event, fields = {}) {
  console.log(JSON.stringify({
    event,
    service: 'crcn-search-api',
    provider: 'imob',
    timestamp: new Date().toISOString(),
    ...fields
  }));
}

class ImobError extends Error {
  constructor(message, { code = 'IMOB_REQUEST_FAILED', status, upstreamCode, upstreamMessage, minimumNights } = {}) {
    super(message);
    this.name = 'ImobError';
    this.code = code;
    this.status = status;
    this.upstreamCode = upstreamCode;
    this.upstreamMessage = upstreamMessage;
    this.minimumNights = minimumNights;
  }
}

function extractRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['opcoes', 'imoveis', 'orcamentos', 'resultados', 'data', 'dados']) {
    if (Array.isArray(payload[key])) return payload[key];
    if (payload[key] && typeof payload[key] === 'object') {
      const nested = extractRecords(payload[key]);
      if (nested.length) return nested;
    }
  }
  // Formatos históricos da API para um único imóvel.
  if (['id', 'idImovel', 'id_imovel', 'unidade', 'linkParceiro', 'link_parceiro'].some((key) => payload[key] != null)) return [payload];
  return [];
}

function formatImobDate(isoDate) {
  const match = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new ImobError('Data inválida para consulta Imob.', { code: 'IMOB_INVALID_DATE' });
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function normalizePropertyName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extractPixPrice(html) {
  const match = String(html || '').match(/["']formReserva-totalDinheiro["']\s*:\s*["']([^"']+)["']/i);
  if (!match) return null;
  const amount = Number(match[1].replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

class ImobClient {
  constructor({
    baseUrl = process.env.IMOB_BASE_URL || DEFAULT_BASE_URL,
    publicBaseUrl = process.env.IMOB_PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL,
    authorization = process.env.IMOB_AUTHORIZATION,
    fetchImpl = global.fetch,
    timeoutMs = Number(process.env.IMOB_REQUEST_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    priceTimeoutMs = DEFAULT_PRICE_TIMEOUT_MS,
    searchMaxAttempts = Number(process.env.IMOB_SEARCH_MAX_ATTEMPTS || DEFAULT_SEARCH_MAX_ATTEMPTS),
    retryDelayMs = Number(process.env.IMOB_RETRY_DELAY_MS || DEFAULT_RETRY_DELAY_MS),
    priceCacheTtlMs = Number(process.env.IMOB_PRICE_CACHE_TTL_MS || 60_000),
    maxExtraOccupants = Number(process.env.IMOB_MAX_EXTRA_OCCUPANTS ?? 2)
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('global fetch não está disponível. Use Node.js 18 ou superior.');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.publicBaseUrl = publicBaseUrl.replace(/\/$/, '');
    this.authorization = authorization;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.priceTimeoutMs = priceTimeoutMs;
    this.searchMaxAttempts = Math.min(3, Math.max(1, Number.parseInt(searchMaxAttempts, 10) || DEFAULT_SEARCH_MAX_ATTEMPTS));
    this.retryDelayMs = Math.max(0, Number.parseInt(retryDelayMs, 10) || 0);
    const parsedExtraOccupants = Number.parseInt(maxExtraOccupants, 10);
    this.maxExtraOccupants = Number.isInteger(parsedExtraOccupants)
      ? Math.min(4, Math.max(0, parsedExtraOccupants))
      : 2;
    this.quoteCache = new LRUCache({
      max: 1000,
      ttl: Math.max(0, Number.parseInt(priceCacheTtlMs, 10) || 0),
      allowStale: false
    });
    this.inFlightQuotes = new Map();
  }

  clearCache() {
    this.quoteCache.clear();
    this.inFlightQuotes.clear();
  }

  get configured() {
    return Boolean(this.authorization);
  }

  async search({ from, to, persons, condominiumId = null, onePerCondominium = false, requestId = null } = {}) {
    if (!this.configured) return [];
    const body = {
      rede: true,
      entrada: formatImobDate(from),
      saida: formatImobDate(to),
      condominio: condominiumId || null,
      qtdeqrts: 'all',
      maxPax: false,
      addCrianca: false,
      umCada: Boolean(onePerCondominium),
      entradaAntecipada: 'all',
      saidaProrrogada: 'all',
      piscina24h: false,
      bebidas: false
    };
    const startedAt = Date.now();
    for (let attempt = 1; attempt <= this.searchMaxAttempts; attempt += 1) {
      const attemptStartedAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      logProviderEvent('provider.request', {
        request_id: requestId,
        operation: 'availability_search',
        attempt,
        max_attempts: this.searchMaxAttempts,
        from: body.entrada,
        to: body.saida,
        persons: Number(persons),
        max_occupants_filter: 'omitted',
        property_filter: Boolean(body.condominio),
        condominium_id: body.condominio
      });
      try {
        const response = await this.fetchImpl(this.baseUrl + '/listOrcamento', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: this.authorization
          },
          body: JSON.stringify(body)
        });
        if (!response.ok) {
          const responseText = await response.text();
          let errorPayload = null;
          try { errorPayload = responseText ? JSON.parse(responseText) : null; } catch {}
          throw new ImobError(`Imob respondeu HTTP ${response.status}.`, {
            code: response.status === 401 || response.status === 403 ? 'IMOB_UNAUTHORIZED' : 'IMOB_HTTP_ERROR',
            status: response.status,
            ...getUpstreamErrorDetails(errorPayload)
          });
        }
        const responseText = await response.text();
        let payload;
        try {
          payload = responseText ? JSON.parse(responseText) : null;
        } catch {
          throw new ImobError('A API Imob retornou JSON inválido.', {
            code: 'IMOB_INVALID_RESPONSE', status: response.status
          });
        }
        if (payload?.erro || payload?.error) {
          const details = getUpstreamErrorDetails(payload);
          const message = String(payload.message || payload.mensagem || payload.erro || payload.error);
          const minimumNightsMatch = message.match(/min(?:imo|\.)?\s*(?:de\s*)?(\d+)\s*noites?/i);
          if (minimumNightsMatch) {
            throw new ImobError('A parceira Imob exige uma estadia mínima para esse período.', {
              code: 'IMOB_MINIMUM_NIGHTS', minimumNights: Number(minimumNightsMatch[1]), ...details
            });
          }
          if (/tarif[aá]rio\s+n[aã]o\s+dispon[ií]vel\s+para\s+essa\s+data/i.test(message)) {
            throw new ImobError('A parceira Imob não tem tarifário disponível para esse período.', {
              code: 'IMOB_TARIFF_UNAVAILABLE', ...details
            });
          }
          if (/nenhum im[oó]vel|sem disponibilidade|n[aã]o encontrado/i.test(message)) {
            logProviderEvent('provider.success', {
              request_id: requestId,
              operation: 'availability_search',
              attempt,
              status: response.status,
              records: 0,
              duration_ms: Date.now() - attemptStartedAt,
              outcome: 'no_availability'
            });
            return [];
          }
          throw new ImobError('A API Imob retornou erro de aplicação.', {
            code: 'IMOB_API_ERROR', status: response.status, ...details
          });
        }
        const records = extractRecords(payload);
        if (!hasRecognizedCollection(payload)) {
          throw new ImobError('A API Imob retornou um formato não reconhecido.', {
            code: 'IMOB_INVALID_RESPONSE', status: response.status
          });
        }
        logProviderEvent('provider.success', {
          request_id: requestId,
          operation: 'availability_search',
          attempt,
          status: response.status,
          records: records.length,
          duration_ms: Date.now() - attemptStartedAt,
          outcome: records.length ? 'available' : 'no_availability'
        });
        return records;
      } catch (caughtError) {
        const error = caughtError instanceof ImobError
          ? caughtError
          : caughtError.name === 'AbortError'
            ? new ImobError('A consulta à Imob excedeu o tempo limite.', { code: 'IMOB_TIMEOUT' })
            : new ImobError('Falha de rede ao consultar a API Imob.', { code: 'IMOB_NETWORK_ERROR' });
        const willRetry = attempt < this.searchMaxAttempts && isRetryable(error);
        error.attempts = attempt;
        error.durationMs = Date.now() - startedAt;
        logProviderEvent('provider.failure', {
          request_id: requestId,
          operation: 'availability_search',
          attempt,
          max_attempts: this.searchMaxAttempts,
          retrying: willRetry,
          code: error.code,
          ...(error.status ? { status: error.status } : {}),
          ...(error.upstreamCode ? { upstream_code: error.upstreamCode } : {}),
          ...(error.upstreamMessage ? { upstream_message: error.upstreamMessage } : {}),
          duration_ms: Date.now() - attemptStartedAt
        });
        if (!willRetry) throw error;
      } finally {
        clearTimeout(timer);
      }
      if (attempt < this.searchMaxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs * attempt));
      }
    }
    throw new ImobError('A consulta à Imob falhou após as tentativas configuradas.', { code: 'IMOB_REQUEST_FAILED' });
  }

  async searchByOccupancyRange({ from, to, persons, condominiumId = null, requestId = null } = {}) {
    const partySize = Number.parseInt(persons, 10);
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > 30) return [];
    const maxCapacity = Math.min(30, partySize + this.maxExtraOccupants);
    const records = await this.search({
      from,
      to,
      persons: partySize,
      condominiumId,
      onePerCondominium: false,
      requestId
    });
    const capacityOf = (record) => Number(
      record?.maxOcupantes ?? record?.max_ocupantes ?? record?.capacidade ?? record?.maxPax
    );
    const eligible = records.filter((record) => {
      const capacity = capacityOf(record);
      return Number.isFinite(capacity) && capacity >= partySize && capacity <= maxCapacity;
    });
    const widerEligible = records.filter((record) => {
      const capacity = capacityOf(record);
      return Number.isFinite(capacity) && capacity >= partySize;
    });
    const capacityFallback = eligible.length === 0 && widerEligible.length > 0;
    const selectedRecords = capacityFallback ? widerEligible : eligible;
    const unique = new Map();
    for (const record of selectedRecords) {
      const id = record?.id ?? record?.idImovel ?? record?.id_imovel;
      const condominium = record?.condominioId ?? record?.idCondominio ?? record?.condominio ?? '';
      const unit = record?.unidade ?? record?.nomeUnidade ?? record?.referencia ?? '';
      const identity = id !== undefined && id !== null
        ? `${condominium}|${id}`
        : `${condominium}|${unit}|${record?.nomeCond || ''}`;
      if (!unique.has(identity)) unique.set(identity, record);
    }
    logProviderEvent('provider.capacity_filter', {
      request_id: requestId,
      operation: 'availability_filter',
      persons: partySize,
      min_occupants: partySize,
      max_occupants: maxCapacity,
      received_records: records.length,
      preferred_fit_records: eligible.length,
      returned_records: unique.size,
      excluded_records: records.length - unique.size,
      widened_to_available_capacity: capacityFallback,
      highest_returned_capacity: Math.max(0, ...[...unique.values()].map(capacityOf).filter(Number.isFinite))
    });
    return Object.assign([...unique.values()], {
      capacityFallback,
      preferredMaxOccupants: maxCapacity
    });
  }

  async searchForProperty({ from, to, persons, propertyName, requestId = null }) {
    const query = normalizePropertyName(propertyName);
    if (!query) return [];
    if (/^\d+$/.test(query)) {
      return this.searchByOccupancyRange({ from, to, persons, condominiumId: query, requestId });
    }
    // Never infer an Imob condominium from the unfiltered inventory: if the
    // selected property has no results, absence in that broad sample proves
    // nothing. Callers must resolve a reviewed internal key to a numeric ID.
    const error = new ImobError('A consulta Imob de propriedade exige o ID de condomínio resolvido pelo catálogo interno.', {
      code: 'IMOB_PROPERTY_ID_REQUIRED'
    });
    logProviderEvent('provider.failure', {
      request_id: requestId,
      operation: 'availability_search',
      code: error.code,
      property_name_query: true
    });
    throw error;
  }

  async getPixPrice({ listingId, from, to, persons } = {}) {
    if (!listingId) return null;
    const cacheKey = `${listingId}|${from}|${to}|${persons}`;
    if (this.quoteCache.has(cacheKey)) return this.quoteCache.get(cacheKey);

    if (this.inFlightQuotes.has(cacheKey)) {
      return this.inFlightQuotes.get(cacheKey);
    }

    const quotePromise = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.priceTimeoutMs);
      try {
        const form = new URLSearchParams({
          Ajax: 'Ajax',
          Controller: 'parceiro',
          periodo: `${from},${to}`,
          action: 'buscaPrecos',
          e1: '0',
          s1: String(persons),
          condId: '',
          ImovRef: String(listingId),
          BaseConsulta: '1',
          ID_ORCA: ''
        });
        const response = await this.fetchImpl(this.publicBaseUrl + '/', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            Accept: 'text/html, */*;q=0.8',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: form.toString()
        });
        if (!response.ok) throw new ImobError(`Site de cotação Imob respondeu HTTP ${response.status}.`, { code: 'IMOB_PRICE_HTTP_ERROR', status: response.status });
        const amount = extractPixPrice(await response.text());
        this.quoteCache.set(cacheKey, amount);
        return amount;
      } catch (error) {
        if (error instanceof ImobError) throw error;
        if (error.name === 'AbortError') throw new ImobError('A cotação de preço Imob excedeu o tempo limite.', { code: 'IMOB_PRICE_TIMEOUT' });
        throw new ImobError('Falha de rede ao consultar preço no site Imob.', { code: 'IMOB_PRICE_NETWORK_ERROR' });
      } finally {
        clearTimeout(timer);
        this.inFlightQuotes.delete(cacheKey);
      }
    })();

    this.inFlightQuotes.set(cacheKey, quotePromise);
    return quotePromise;
  }
}

module.exports = { ImobClient, ImobError, extractRecords, formatImobDate, normalizePropertyName, extractPixPrice };
