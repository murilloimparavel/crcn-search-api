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
async function fetchWithDeduplication(from, to, persons, limit, fetchFn, filters = {}, { cacheResult = true } = {}) {
  const key = buildKey(from, to, persons, limit, filters);
  
  // Disponibilidade pode mudar rapidamente. Chamadores podem manter apenas
  // a deduplicação em voo sem reutilizar um retrato antigo do inventário.
  if (cacheResult) {
    const cached = searchCache.get(key);
    if (cached !== undefined) {
      return { data: cached, isHit: true, cacheStatus: 'HIT' };
    }
  }

  // Deduplica somente chamadas simultâneas idênticas.
  if (inFlightRequests.has(key)) {
    const data = await inFlightRequests.get(key);
    return { data, isHit: false, cacheStatus: 'IN_FLIGHT' };
  }

  // 3. Primeira requisição: cria e registra a Promise
  const promise = (async () => {
    try {
      const result = await fetchFn();
      if (cacheResult) searchCache.set(key, result);
      return result;
    } finally {
      inFlightRequests.delete(key);
    }
  })();

  inFlightRequests.set(key, promise);
  const data = await promise;
  return { data, isHit: false, cacheStatus: 'MISS' };
}

module.exports = {
  getCachedSearch,
  setCachedSearch,
  clearCache,
  fetchWithDeduplication
};
