const DEFAULT_BASE_URL = 'https://api.cnsp.app/crcn';
const DEFAULT_PUBLIC_BASE_URL = 'https://reservascrcn.com.br';
const DEFAULT_TIMEOUT_MS = 12_000;

class ImobError extends Error {
  constructor(message, { code = 'IMOB_REQUEST_FAILED', status } = {}) {
    super(message);
    this.name = 'ImobError';
    this.code = code;
    this.status = status;
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
    timeoutMs = Number(process.env.IMOB_REQUEST_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('global fetch não está disponível. Use Node.js 18 ou superior.');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.publicBaseUrl = publicBaseUrl.replace(/\/$/, '');
    this.authorization = authorization;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.quoteCache = new Map();
  }

  get configured() {
    return Boolean(this.authorization);
  }

  async search({ from, to, persons, condominiumId = null, onePerCondominium = false } = {}) {
    if (!this.configured) return [];
    const body = {
      rede: true,
      entrada: formatImobDate(from),
      saida: formatImobDate(to),
      condominio: condominiumId || null,
      qtdeqrts: 'all',
      maxOcupantes: String(persons),
      maxPax: false,
      addCrianca: false,
      umCada: Boolean(onePerCondominium),
      entradaAntecipada: 'all',
      saidaProrrogada: 'all',
      piscina24h: false,
      bebidas: false
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
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
        throw new ImobError(`Imob respondeu HTTP ${response.status}.`, {
          code: response.status === 401 || response.status === 403 ? 'IMOB_UNAUTHORIZED' : 'IMOB_HTTP_ERROR',
          status: response.status
        });
      }
      const payload = await response.json();
      if (payload?.erro || payload?.error) {
        const message = String(payload.erro || payload.error);
        if (/nenhum im[oó]vel|sem disponibilidade|n[aã]o encontrado/i.test(message)) return [];
        throw new ImobError('A API Imob recusou a consulta.', { code: 'IMOB_API_ERROR' });
      }
      const records = extractRecords(payload);
      if (!records.length && payload && typeof payload === 'object' && !Array.isArray(payload)
        && !Object.keys(payload).length) {
        throw new ImobError('A API Imob retornou uma resposta vazia em formato inesperado.', { code: 'IMOB_INVALID_RESPONSE' });
      }
      return records;
    } catch (error) {
      if (error instanceof ImobError) throw error;
      if (error.name === 'AbortError') throw new ImobError('A consulta à Imob excedeu o tempo limite.', { code: 'IMOB_TIMEOUT' });
      throw new ImobError('Falha de rede ao consultar a API Imob.', { code: 'IMOB_NETWORK_ERROR' });
    } finally {
      clearTimeout(timer);
    }
  }

  async searchForProperty({ from, to, persons, propertyName }) {
    const query = normalizePropertyName(propertyName);
    if (!query) return [];
    if (/^\d+$/.test(query)) {
      return this.search({ from, to, persons, condominiumId: query, onePerCondominium: false });
    }
    const initial = await this.search({ from, to, persons, onePerCondominium: false });
    const matchingCondominiums = new Map();
    for (const record of initial) {
      const name = normalizePropertyName(record?.nomeCond || record?.condominioNome || record?.condominio_name);
      const id = record?.condominioId || record?.idCondominio || (typeof record?.condominio === 'number' || /^\d+$/.test(String(record?.condominio || '')) ? record.condominio : null);
      if (id && name && (name === query || name.includes(query) || query.includes(name))) matchingCondominiums.set(String(id), name);
    }
    if (!matchingCondominiums.size) {
      return initial.filter((record) => {
        const name = normalizePropertyName(record?.nomeCond || record?.condominioNome || record?.condominio_name);
        return name && (name === query || name.includes(query) || query.includes(name));
      });
    }
    const scoped = await Promise.all([...matchingCondominiums.keys()].map((condominiumId) =>
      this.search({ from, to, persons, condominiumId, onePerCondominium: false })
    ));
    return scoped.flat();
  }

  async getPixPrice({ listingId, from, to, persons } = {}) {
    if (!listingId) return null;
    const cacheKey = `${listingId}|${from}|${to}|${persons}`;
    if (this.quoteCache.has(cacheKey)) return this.quoteCache.get(cacheKey);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
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
    }
  }
}

module.exports = { ImobClient, ImobError, extractRecords, formatImobDate, normalizePropertyName, extractPixPrice };
