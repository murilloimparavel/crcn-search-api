const DEFAULT_BASE_URL = 'https://www.centraldereservascaldas.com.br';
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_CONCURRENCY = 3;

class StaysError extends Error {
  constructor(message, { code = 'STAYS_REQUEST_FAILED', status } = {}) {
    super(message);
    this.name = 'StaysError';
    this.code = code;
    this.status = status;
  }
}

function getCookies(headers) {
  const values = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [headers.get('set-cookie')].filter(Boolean);
  return values
    .flatMap((value) => value.split(/,(?=[^;,\s]+=[^;,\s]+)/))
    .map((value) => value.split(';', 1)[0].trim())
    .filter(Boolean)
    .join('; ');
}

function parsePublicUid(html) {
  return html.match(/_user\s*:\s*\{\s*_id:'([^']+)'/)?.[1]
    || html.match(/_id:'([^']+)'/)?.[1]
    || null;
}

function formatStaysDate(date) {
  return `${date}T12:00:00.000Z`;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

class StaysClient {
  constructor({
    baseUrl = process.env.STAYS_BASE_URL || DEFAULT_BASE_URL,
    fetchImpl = global.fetch,
    timeoutMs = Number(process.env.STAYS_REQUEST_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    priceConcurrency = Number(process.env.STAYS_PRICE_CONCURRENCY || DEFAULT_CONCURRENCY)
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('global fetch não está disponível. Use Node.js 18 ou superior.');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.priceConcurrency = Math.max(1, priceConcurrency);
  }

  buildSearchUrl({ from, to, persons, extra = {} }) {
    const url = new URL('/pt/search', this.baseUrl);
    url.search = new URLSearchParams({ from, to, persons: String(persons), ...extra }).toString();
    return url;
  }

  async request(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { ...options, signal: controller.signal });
      if (!response.ok) {
        throw new StaysError(`Stays respondeu HTTP ${response.status}.`, {
          code: response.status === 401 ? 'STAYS_SESSION_EXPIRED' : 'STAYS_HTTP_ERROR',
          status: response.status
        });
      }
      return response;
    } catch (error) {
      if (error.name === 'AbortError') throw new StaysError('A consulta à Stays excedeu o tempo limite.', { code: 'STAYS_TIMEOUT' });
      if (error instanceof StaysError) throw error;
      throw new StaysError(`Falha de rede ao consultar a Stays: ${error.message}`, { code: 'STAYS_NETWORK_ERROR' });
    } finally {
      clearTimeout(timer);
    }
  }

  async createSession({ from, to, persons }) {
    const response = await this.request(this.buildSearchUrl({ from, to, persons }));
    const html = await response.text();
    const cookie = getCookies(response.headers);
    const uid = parsePublicUid(html);
    if (!cookie || !uid) throw new StaysError('A Stays não forneceu a sessão pública esperada.', { code: 'STAYS_SESSION_INVALID' });
    return { cookie, uid };
  }

  async fetchApartments(session, { from, to, persons, limit }) {
    const url = this.buildSearchUrl({ from, to, persons, extra: { formaps: '1', start: '0', limit: String(limit) } });
    const response = await this.request(url, {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'pok-route-path': ':lang/search', Cookie: session.cookie }
    });
    const payload = await response.json();
    if (!Array.isArray(payload.apartments)) throw new StaysError('A Stays retornou uma busca sem a lista de apartamentos.', { code: 'STAYS_INVALID_SEARCH_RESPONSE' });
    return payload.apartments;
  }

  async fetchOfficialPrice(session, apartment, { from, to, persons }) {
    const searchUrl = this.buildSearchUrl({ from, to, persons }).toString();
    const response = await this.request(`${this.baseUrl}/jsonrpc`, {
      method: 'POST',
      headers: {
        Accept: 'application/json', 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest',
        'pok-route-path': ':lang/search', Origin: this.baseUrl, Referer: searchUrl, Cookie: session.cookie
      },
      body: JSON.stringify({
        uid: session.uid,
        method: 'helpers._correctApartPrice',
        params: ['', { _id: apartment._id }, formatStaysDate(from), formatStaysDate(to), { persons, channel: 'Website' }]
      })
    });
    const price = (await response.json()).result?.[0];
    const valorDiaria = Number(price?._mcprice?.BRL);
    const valorTotal = Number(price?._t_mctotal?.BRL);
    if (!Number.isFinite(valorDiaria) || !Number.isFinite(valorTotal)) {
      throw new StaysError(`A Stays não retornou preço em BRL para ${apartment._id}.`, { code: 'STAYS_INVALID_PRICE_RESPONSE' });
    }
    return { valor_diaria: valorDiaria, valor_total: valorTotal };
  }

  async search({ from, to, persons, limit = 10 }) {
    const run = async () => {
      const session = await this.createSession({ from, to, persons });
      const apartments = await this.fetchApartments(session, { from, to, persons, limit });
      return mapWithConcurrency(apartments, this.priceConcurrency, async (apartment) => ({
        apartment,
        price: await this.fetchOfficialPrice(session, apartment, { from, to, persons })
      }));
    };
    try {
      return await run();
    } catch (error) {
      if (error.code !== 'STAYS_SESSION_EXPIRED') throw error;
      return run();
    }
  }
}

module.exports = { StaysClient, StaysError, parsePublicUid, getCookies, mapWithConcurrency };
