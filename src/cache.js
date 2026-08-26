const { LRUCache } = require('lru-cache');

const options = {
  // Max 500 cached search queries
  max: 500,
  // 10 minutes TTL
  ttl: 1000 * 60 * 10,
  allowStale: false,
  updateAgeOnGet: false,
  updateAgeOnHas: false,
};

const searchCache = new LRUCache(options);

function getCacheKey(from, to, persons) {
  return `${from}_${to}_${persons}`;
}

function getCachedSearch(from, to, persons) {
  const key = getCacheKey(from, to, persons);
  return searchCache.get(key);
}

function setCachedSearch(from, to, persons, data) {
  const key = getCacheKey(from, to, persons);
  searchCache.set(key, data);
}

function clearCache() {
  searchCache.clear();
}

module.exports = {
  getCachedSearch,
  setCachedSearch,
  clearCache,
};
