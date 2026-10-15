function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/^crcn\s*[-:]?\s*/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeComparableName(value) {
  return normalizeName(value)
    .replace(/(^|\s)ii$/, (_, prefix) => `${prefix}2`)
    .replace(/(^|\s)i$/, (_, prefix) => `${prefix}1`);
}

function internalKey(name) {
  const slug = normalizeName(name).replace(/\s+/g, '-').replace(/^-|-$/g, '');
  if (!slug) throw new Error('Nome vazio não pode gerar identidade interna.');
  return `crcn:${slug}`;
}

function normalizeStaysProperty(item) {
  const id = item?._id || item?.id || item?.val;
  const name = item?._mstitle?.pt_BR || item?.internalName || item?.name || item?.val;
  if (!id || !name) return null;
  const alternateIds = [item?._id, item?.id, item?.val].filter(Boolean).map(String).filter((value) => value !== String(id));
  const alternateNames = [item?.internalName, item?._mstitle?.pt_BR, item?.name, item?.val]
    .filter((value) => value && normalizeName(value) !== normalizeName(name))
    .map((value) => String(value).trim());
  return { id: String(id), alternate_ids: [...new Set(alternateIds)], name: String(name).trim(), alternate_names: [...new Set(alternateNames)] };
}

function validateCatalog(catalog) {
  const keys = new Set();
  const imobIds = new Set();
  const staysIds = new Set();
  for (const [index, record] of (catalog?.properties || []).entries()) {
    if (!record?.property_key || !record?.canonical_name || !record?.status) {
      throw new Error(`Registro ${index} sem property_key, canonical_name ou status.`);
    }
    if (keys.has(record.property_key)) throw new Error(`property_key duplicada: ${record.property_key}`);
    keys.add(record.property_key);
    const imobId = record.sources?.imob?.id;
    if (imobId !== null && imobId !== undefined && imobId !== '') {
      const normalized = String(imobId);
      if (imobIds.has(normalized)) throw new Error(`ID Imob duplicado: ${normalized}`);
      imobIds.add(normalized);
    }
    for (const value of [record.sources?.stays?.id, ...(record.sources?.stays?.alternate_ids || [])]) {
      if (value === null || value === undefined || value === '') continue;
      const normalized = String(value);
      if (staysIds.has(normalized)) throw new Error(`ID Stays duplicado: ${normalized}`);
      staysIds.add(normalized);
    }
  }
  return catalog;
}

function findExactCatalogCandidates(names, records, excludedRecord = null) {
  return records.filter((candidate) => candidate !== excludedRecord).map((candidate) => ({
    candidate,
    name: names.find((name) => normalizeComparableName(candidate.canonical_name) === normalizeComparableName(name))
  })).filter((entry) => entry.name);
}

function validateSourceSnapshots({ imob, stays }) {
  const imobIds = new Set();
  for (const item of imob) {
    if (item?.id === null || item?.id === undefined || !String(item.name || '').trim()) throw new Error('Snapshot Imob contém ID ou nome vazio.');
    const id = String(item.id);
    if (imobIds.has(id)) throw new Error(`Snapshot Imob contém ID duplicado: ${id}`);
    imobIds.add(id);
  }
  const staysIds = new Set();
  for (const item of stays) {
    if (item?.id === null || item?.id === undefined || !String(item.name || '').trim()) throw new Error('Snapshot Stays contém ID ou nome vazio.');
    for (const value of [item.id, ...(item.alternate_ids || [])]) {
      const id = String(value);
      if (staysIds.has(id)) throw new Error(`Snapshot Stays contém ID/alias duplicado: ${id}`);
      staysIds.add(id);
    }
  }
}

function reconcileCatalog(existingCatalog, { imob = [], stays = [], syncedAt = new Date().toISOString() } = {}) {
  validateSourceSnapshots({ imob, stays });
  const catalog = structuredClone(existingCatalog);
  validateCatalog(catalog);
  const beforeSync = structuredClone(catalog);
  delete beforeSync.last_sync;
  const records = catalog.properties;
  const byImob = new Map(records.filter((r) => r.sources?.imob?.id != null).map((r) => [String(r.sources.imob.id), r]));
  const byStays = new Map(records.filter((r) => r.sources?.stays?.id != null).map((r) => [String(r.sources.stays.id), r]));
  const report = { synced_at: syncedAt, imob_seen: imob.length, stays_seen: stays.length, updated: [], added: [], pending: [], missing_from_imob: [], missing_from_stays: [] };

  for (const item of imob) {
    const id = String(item.id);
    let record = byImob.get(id);
    let verifiedExactName = false;
    if (!record) {
      const normalized = normalizeComparableName(item.name);
      const exactMatches = records.filter((candidate) => normalizeComparableName(candidate.canonical_name) === normalized);
      if (exactMatches.length === 1 && !exactMatches[0].sources?.imob?.id) {
        record = exactMatches[0];
        verifiedExactName = Boolean(record.sources?.stays?.id);
      }
      else {
        const newRecord = {
          property_key: internalKey(item.name), canonical_name: String(item.name).trim(), status: 'active',
          aliases: [], sources: { imob: { id: item.id, name: String(item.name).trim(), status: 'active' }, stays: null },
          match_status: 'source_only'
        };
        if (records.some((candidate) => candidate.property_key === newRecord.property_key)) {
          report.pending.push({ source: 'imob', id: item.id, name: item.name, reason: 'internal_key_collision' });
          continue;
        }
        records.push(newRecord);
        byImob.set(id, newRecord);
        report.added.push(newRecord.property_key);
        continue;
      }
    }
    record.sources.imob = { id: item.id, name: String(item.name).trim(), status: 'active' };
    record.status = 'active';
    if (record.sources.stays && verifiedExactName) {
      const matchedName = [record.sources.stays.name, ...(record.sources.stays.alternate_names || [])]
        .find((name) => normalizeComparableName(name) === normalizeComparableName(item.name));
      if (matchedName) record.sources.stays.matched_name = matchedName;
      record.match_status = normalizeName(item.name) === normalizeName(matchedName || '')
        ? 'verified_exact_name'
        : 'verified_normalized_name';
    } else if (!record.sources.stays) record.match_status = 'source_only';
    byImob.set(id, record);
    report.updated.push(record.property_key);
  }

  for (const item of stays) {
    const id = String(item.id);
    const matchNames = [item.name, ...(item.alternate_names || [])].filter(Boolean);
    let record = byStays.get(id);
    let verifiedExactName = false;
    let matchedName = null;
    if (!record) {
      const exactMatches = findExactCatalogCandidates(matchNames, records);
      const candidates = exactMatches.filter(({ candidate }) => !candidate.sources?.stays?.id);
      if (candidates.length === 1) {
        record = candidates[0].candidate;
        matchedName = candidates[0].name;
      }
      verifiedExactName = Boolean(record);
    } else if (!record.sources?.imob?.id) {
      const exactMatches = findExactCatalogCandidates(matchNames, records, record);
      const candidates = exactMatches.filter(({ candidate }) => candidate.sources?.imob?.id != null && !candidate.sources?.stays?.id);
      if (candidates.length === 1) {
        const staysOnlyIndex = records.indexOf(record);
        const staysOnlyRecord = record;
        record = candidates[0].candidate;
        matchedName = candidates[0].name;
        records.splice(staysOnlyIndex, 1);
        report.updated.push(staysOnlyRecord.property_key);
        verifiedExactName = true;
      }
    }
    if (record) {
      const preservedMatchedName = record.sources.stays?.matched_name;
      record.sources.stays = { id: item.id, alternate_ids: item.alternate_ids || [], name: item.name, alternate_names: item.alternate_names || [], ...((matchedName || preservedMatchedName) ? { matched_name: matchedName || preservedMatchedName } : {}), status: 'active' };
      record.status = 'active';
      if (record.sources.imob && verifiedExactName) {
        record.match_status = normalizeName(record.sources.imob.name) === normalizeName(matchedName || item.name)
          ? 'verified_exact_name'
          : 'verified_normalized_name';
      }
      byStays.set(id, record);
      report.updated.push(record.property_key);
      if (!record.sources.imob) {
        const suggestions = suggestMatches(item.name, records.filter((candidate) => candidate.sources?.imob?.id != null));
        report.pending.push({ source: 'stays', id: item.id, name: item.name, reason: suggestions.length ? 'possible_cross_provider_match' : 'unmatched_source_record', suggestions });
      }
      continue;
    }

    const key = internalKey(item.name);
    const collision = records.find((candidate) => candidate.property_key === key);
    const suggestions = suggestMatches(item.name, records.filter((candidate) => candidate.sources?.imob?.id != null));
    const uniqueKey = collision ? `${key}:stays-${String(item.id).toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-')}` : key;
    const newRecord = {
      property_key: uniqueKey, canonical_name: item.name, status: 'active', aliases: [],
      sources: { imob: null, stays: { id: item.id, alternate_ids: item.alternate_ids || [], name: item.name, alternate_names: item.alternate_names || [], status: 'active' } },
      match_status: 'pending_review'
    };
    records.push(newRecord);
    byStays.set(id, newRecord);
    report.added.push(uniqueKey);
    report.pending.push({ source: 'stays', id: item.id, name: item.name, reason: collision ? 'name_requires_manual_mapping' : suggestions.length ? 'possible_cross_provider_match' : 'unmatched_source_record', suggestions: collision ? [{ property_key: collision.property_key, canonical_name: collision.canonical_name, score: 1 }, ...suggestions].slice(0, 3) : suggestions });
  }

  const imobIds = new Set(imob.map((item) => String(item.id)));
  const staysIds = new Set(stays.flatMap((item) => [item.id, ...(item.alternate_ids || [])]).map(String));
  for (const record of records) {
    if (record.sources?.imob?.id != null && !imobIds.has(String(record.sources.imob.id))) {
      record.sources.imob.status = 'not_seen';
      report.missing_from_imob.push(record.property_key);
    }
    if (record.sources?.stays?.id != null && !staysIds.has(String(record.sources.stays.id))) {
      record.sources.stays.status = 'not_seen';
      report.missing_from_stays.push(record.property_key);
    }
  }
  catalog.last_sync = syncedAt;
  catalog.pending_matches = report.pending;
  const afterSync = structuredClone(catalog);
  delete afterSync.last_sync;
  if (JSON.stringify(beforeSync) === JSON.stringify(afterSync)) catalog.last_sync = existingCatalog.last_sync || null;
  return { catalog: validateCatalog(catalog), report };
}

const GENERIC_TOKENS = new Set(['crcn', 'condominio', 'flat', 'hotel', 'service', 'resort', 'thermas', 'termas', 'suite', 'suites', 'residence', 'das', 'dos', 'da', 'do', 'de', 'e']);

function suggestMatches(name, candidates) {
  const tokens = normalizeName(name).split(' ').filter((token) => token.length > 2 && !GENERIC_TOKENS.has(token));
  if (!tokens.length) return [];
  return candidates.map((candidate) => {
    const candidateTokens = normalizeName(candidate.canonical_name).split(' ').filter((token) => token.length > 2 && !GENERIC_TOKENS.has(token));
    const intersection = tokens.filter((token) => candidateTokens.includes(token)).length;
    const union = new Set([...tokens, ...candidateTokens]).size;
    return { property_key: candidate.property_key, canonical_name: candidate.canonical_name, score: union ? Number((intersection / union).toFixed(3)) : 0 };
  }).filter((candidate) => candidate.score >= 0.33).sort((a, b) => b.score - a.score).slice(0, 3);
}

function createImobCatalogFetcher({ baseUrl, fetchImpl = global.fetch, timeoutMs = 12000 } = {}) {
  return async function fetchImobCatalog() {
    const url = new URL(baseUrl);
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'text/html' } });
    if (!response.ok) throw new Error(`Catálogo público Imob respondeu HTTP ${response.status}.`);
    const html = await response.text();
    const records = [];
    const pattern = /href=["'](?:https?:\/\/reservascrcn\.com\.br)?\/condominio\/(\d+)(?:[?#][^"']*)?["'][^>]*>([\s\S]*?)<\/a>/gi;
    for (const match of html.matchAll(pattern)) {
      const name = match[2].replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#0*39;|&apos;/gi, "'").replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
      if (name) records.push({ id: Number(match[1]), name });
    }
    const recordsById = new Map();
    for (const record of records) {
      const key = String(record.id);
      const existing = recordsById.get(key);
      if (existing && normalizeName(existing.name) !== normalizeName(record.name)) throw new Error(`Catálogo Imob contém nomes conflitantes para o ID ${key}.`);
      if (!existing) recordsById.set(key, record);
    }
    const unique = [...recordsById.values()];
    if (!unique.length) throw new Error('O HTML do catálogo Imob não continha condomínios reconhecidos; catálogo não alterado.');
    return unique;
  };
}

module.exports = { normalizeName, normalizeComparableName, internalKey, normalizeStaysProperty, validateCatalog, validateSourceSnapshots, reconcileCatalog, createImobCatalogFetcher, suggestMatches };
