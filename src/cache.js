const { LRUCache } = require('lru-cache');

const options = {
  max: 500, // Máximo de 500 buscas cacheadas
  ttl: 1000 * 60 * 3, // Cotação/dados de disponibilidade mudam rapidamente (3 min)
  allowStale: false,
  updateAgeOnGet: false
};

const searchCache = new LRUCache(options);
const inFlightRequests = new Map();

function buildKey(from, to, persons, limit = 3, filters = {}) {
  const sortedFilters = Object.keys(filters || {})
    .sort()
    .reduce((acc, k) => {
      acc[k] = filters[k];
      return acc;
    }, {});
  return `${from}_${to}_${persons}_${limit}_${JSON.stringify(sortedFilters)}`;
}

function getCachedSearch(from, to, persons) {
  const key = buildKey(from, to, persons);
  return searchCache.get(key);
}

function setCachedSearch(from, to, persons, data) {
  const key = buildKey(from, to, persons);
  searchCache.set(key, data);
}

function clearCache() {
  searchCache.clear();
  inFlightRequests.clear();
}

/**
 * Deduplica requisições simultâneas idênticas (Prevenção de Cache Stampede)
 */
async function fetchWithDeduplication(from, to, persons, limit, fetchFn, filters = {}) {
  const key = buildKey(from, to, persons, limit, filters);
  
  // 1. Se já está no cache, retorna imediatamente
  const cached = searchCache.get(key);
  if (cached) {
    return { data: cached, isHit: true };
  }

  // 2. Se já existe uma requisição em voo para os mesmos parâmetros, aguarda ela
  if (inFlightRequests.has(key)) {
    console.log(`[Cache] Aguardando requisição em voo para ${key}`);
    const data = await inFlightRequests.get(key);
    return { data, isHit: true };
  }

  // 3. Primeira requisição: cria e registra a Promise
  const promise = (async () => {
    try {
      const result = await fetchFn();
      searchCache.set(key, result);
      return result;
    } finally {
      inFlightRequests.delete(key);
    }
  })();

  inFlightRequests.set(key, promise);
  const data = await promise;
  return { data, isHit: false };
}

module.exports = {
  getCachedSearch,
  setCachedSearch,
  clearCache,
  fetchWithDeduplication
};
