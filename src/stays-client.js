const DEFAULT_BASE_URL = 'https://crcn.stays.net/external/v1';
const DEFAULT_TIMEOUT_MS = 8_000;

function logStaysProviderEvent(event, fields = {}) {
  console.log(JSON.stringify({
    event,
    service: 'crcn-search-api',
    provider: 'stays',
    timestamp: new Date().toISOString(),
    ...fields
  }));
}

class StaysError extends Error {
  constructor(message, { code = 'STAYS_REQUEST_FAILED', status } = {}) {
    super(message);
    this.name = 'StaysError';
    this.code = code;
    this.status = status;
  }
}

class StaysClient {
  constructor({
    baseUrl = process.env.STAYS_BASE_URL || DEFAULT_BASE_URL,
    clientId = process.env.STAYS_CLIENT_ID,
    clientSecret = process.env.STAYS_CLIENT_SECRET,
    fetchImpl = global.fetch,
    timeoutMs = Number(process.env.STAYS_REQUEST_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('global fetch não está disponível. Use Node.js 18 ou superior.');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.searchFiltersCache = null;
    this.searchFiltersExpiresAt = 0;
  }

  get authHeader() {
    if (!this.clientId || !this.clientSecret) {
      throw new StaysError('Credenciais da API Stays não configuradas.', { code: 'STAYS_NOT_CONFIGURED' });
    }
    return `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`;
  }

  get configured() {
    return Boolean(this.clientId && this.clientSecret);
  }

  async request(path, { method = 'GET', query, body } = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: this.authHeader
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      if (!response.ok) {
        throw new StaysError(`Stays respondeu HTTP ${response.status}.`, {
          code: response.status === 401 ? 'STAYS_UNAUTHORIZED' : 'STAYS_HTTP_ERROR',
          status: response.status
        });
      }
      return response.json();
    } catch (error) {
      if (error instanceof StaysError) throw error;
      if (error.name === 'AbortError') throw new StaysError('A consulta à Stays excedeu o tempo limite.', { code: 'STAYS_TIMEOUT' });
      throw new StaysError(`Falha de rede ao consultar a Stays: ${error.message}`, { code: 'STAYS_NETWORK_ERROR' });
    } finally {
      clearTimeout(timer);
    }
  }

  async getSearchFilters() {
    if (this.searchFiltersCache && Date.now() < this.searchFiltersExpiresAt) return this.searchFiltersCache;
    this.searchFiltersCache = await this.request('/booking/searchfilter');
    this.searchFiltersExpiresAt = Date.now() + 5 * 60 * 1000;
    return this.searchFiltersCache;
  }

  async searchListings({ from, to, persons, limit = 20, skip = 0, filters = {} }) {
    return this.request('/booking/search-listings', {
      method: 'POST',
      body: {
        from,
        to,
        guests: persons,
        skip,
        limit: Math.min(Math.max(Number(limit) || 20, 1), 20),
        ...filters
      }
    });
  }

  async search({ from, to, persons, limit = 3, skip = 0, filters = {}, requestId = null }) {
    const pageSize = 20;
    const results = [];
    const startedAt = Date.now();
    logStaysProviderEvent('provider.request', {
      request_id: requestId,
      operation: 'availability_search',
      from,
      to,
      persons: Number(persons),
      property_filter: filters.properties?.[0] || null,
      limit,
      skip
    });
    try {
      while (results.length < limit) {
        const page = await this.searchListings({
          from,
          to,
          persons,
          limit: Math.min(pageSize, limit - results.length),
          skip: skip + results.length,
          filters
        });
        if (!Array.isArray(page)) {
          throw new StaysError('A Stays retornou a busca em formato inválido.', { code: 'STAYS_INVALID_SEARCH_RESPONSE' });
        }
        results.push(...page);
        if (page.length < Math.min(pageSize, limit - (results.length - page.length))) break;
      }
    } catch (error) {
      logStaysProviderEvent('provider.failure', {
        request_id: requestId,
        operation: 'availability_search',
        code: error.code || 'STAYS_REQUEST_FAILED',
        ...(error.status ? { status: error.status } : {}),
        duration_ms: Date.now() - startedAt
      });
      throw error;
    }
    const selected = results.slice(0, limit);
    logStaysProviderEvent('provider.success', {
      request_id: requestId,
      operation: 'availability_search',
      status: 200,
      records: selected.length,
      outcome: selected.length ? 'available' : 'no_availability',
      duration_ms: Date.now() - startedAt
    });
    return selected;
  }

  async enrichListings(listings) {
    const [searchFilters, ...details] = await Promise.all([
      this.getSearchFilters(),
      ...listings.map((listing) => this.getListing(listing.id || listing._id).catch(() => listing))
    ]);
    const amenityCatalog = searchFilters.amenities || [];
    return listings.map((listing, index) => {
      const detail = details[index] || listing;
      const property = (searchFilters.properties || []).find((item) => item?._id === detail?._idproperty) || null;
      return { listing, details: detail, property, amenityCatalog };
    });
  }

  async getListing(id) {
    return this.request(`/content/listings/${encodeURIComponent(id)}`);
  }

  async getProperty(id) {
    return this.request(`/content/properties/${encodeURIComponent(id)}`);
  }

  async getReservation(id) {
    return this.request(`/booking/reservations/${encodeURIComponent(id)}`);
  }

  async getReservationPayments(id) {
    return this.request(`/booking/reservations/${encodeURIComponent(id)}/payments`);
  }

  async searchProperties(query = '') {
    const filters = await this.getSearchFilters();
    const properties = Array.isArray(filters.properties) ? filters.properties : [];
    const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR');
    return properties.filter((property) => {
      const title = property?._mstitle?.pt_BR || property?.internalName || property?.id || '';
      return !normalizedQuery || title.toLocaleLowerCase('pt-BR').includes(normalizedQuery);
    });
  }

  async resolveSearchFilters({ amenities, inventory, properties, cities, rooms, listingId } = {}) {
    const hasLabels = [amenities, inventory, properties, cities].some((values) => Array.isArray(values) && values.length > 0);
    const catalog = hasLabels ? await this.getSearchFilters() : null;
    const resolve = (values, entries, groupName) => {
      if (!Array.isArray(values) || !values.length) return undefined;
      return values.map((value) => {
        const raw = String(value);
        const found = (entries || []).find((entry) => {
          const ids = [entry?._id, entry?.id, entry?.val].filter(Boolean).map(String);
          const labels = [entry?._mstitle?.pt_BR, entry?._mstitle?.en_US, entry?.internalName, entry?.val].filter(Boolean);
          return ids.includes(raw) || labels.some((label) => String(label).toLocaleLowerCase('pt-BR') === raw.toLocaleLowerCase('pt-BR'));
        });
        if (!found) {
          throw new StaysError(`Filtro ${groupName} não encontrado no catálogo Stays.`, { code: 'STAYS_FILTER_NOT_FOUND' });
        }
        return found._id || found.id || found.val;
      });
    };
    return {
      ...(resolve(amenities, catalog?.amenities, 'amenities') ? { amenities: resolve(amenities, catalog?.amenities, 'amenities') } : {}),
      ...(resolve(inventory, catalog?.inventory, 'inventory') ? { inventory: resolve(inventory, catalog?.inventory, 'inventory') } : {}),
      ...(resolve(properties, catalog?.properties, 'properties') ? { properties: resolve(properties, catalog?.properties, 'properties') } : {}),
      ...(resolve(cities, catalog?.cities, 'cities') ? { cities: resolve(cities, catalog?.cities, 'cities') } : {}),
      ...(Array.isArray(rooms) && rooms.length ? { rooms } : {}),
      ...(listingId ? { listingId: String(listingId) } : {})
    };
  }
}

module.exports = { StaysClient, StaysError };
