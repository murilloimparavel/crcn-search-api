const { cleanText } = require('./normalizer');
const fs = require('node:fs');
const path = require('node:path');
const { internalKey, validateCatalog } = require('./property-identity');

// IDs publicados em https://reservascrcn.com.br/condominio/{id}.
// A API Imob usa o mesmo ID no campo `condominio` de /listOrcamento.
// Nomes/IDs conferidos no catálogo público em 2026-10-15.
const LEGACY_IMOB_CONDOMINIUMS = [
  ['LACQUA DIROMA', 86],
  ['LAGOA QUENTE FLAT SERVICE', 135],
  ['SOL DAS CALDAS', 49],
  ['AGUAS DA FONTE', 22],
  ['AGUAS DA SERRA', 47],
  ['AQUARIUS RESIDENCE', 74],
  ['BOULEVARD SUITE HOTEL', 16],
  ['CALDAS NOVAS FLAT (EXPRESS)', 90],
  ['CASA DA MADEIRA', 17],
  ['DIROMA FIORI', 87],
  ['DIROMA RESORT', 88],
  ['ATRIUM THERMAS', 15],
  ['ECOLOGIC PARK', 72],
  ['ELDORADO FLAT SERVICE', 13],
  ['ELDORADO PARK', 12],
  ['EVEREST FLAT SERVICE', 44],
  ['EVIAN THERMAS RESIDENCE', 107],
  ['FIORE PRIME', 55],
  ['GOLDEN DOLPHIN G HOTEL', 89],
  ['GOLDEN DOLPHIN SUPREME', 91],
  ['JARDINS DAS THERMAS', 21],
  ['LAGOA QUENTE HOTEL', 133],
  ['LE JARDIN SUITES', 9],
  ['MILLENIUM RESIDENCE', 95],
  ['PARK VEREDAS - RIO QUENTE', 200, 'Rio Quente'],
  ['PIAZZA DIROMA', 84],
  ['PRIVE DAS THERMAS 1', 103],
  ['PRIVE DAS THERMAS 2', 102],
  ['RECANTO DO BOSQUE', 105],
  ['RIO CALDAS', 39],
  ['ROYAL PARK', 96],
  ['SPAZZIO DIROMA', 83],
  ['SPLENDOR THERMAS', 45],
  ['THERMAS DAS CALDAS', 43],
  ['THERMAS DO BANDEIRANTE', 106],
  ['THERMAS PLACE', 94],
  ['VITORIA DAS THERMAS', 101]
].map(([nome, id, cidade = 'Caldas Novas']) => ({
  id,
  nome,
  cidade,
  regiao: '',
  descricao: 'Condomínio listado no catálogo público da CRCN.',
  comodidades: []
}));

const PROPERTY_CATALOG_PATH = path.join(__dirname, '..', 'data', 'property-catalog.json');

function loadInternalCatalog() {
  try {
    const catalog = JSON.parse(fs.readFileSync(PROPERTY_CATALOG_PATH, 'utf8'));
    validateCatalog(catalog);
    const imobProperties = (catalog.properties || []).filter((item) => item.status === 'active' && item.sources?.imob?.id != null && item.sources.imob.status === 'active');
    return imobProperties.map((item) => ({
      id: item.sources.imob.id,
      nome: item.canonical_name,
      cidade: item.city || 'Caldas Novas',
      regiao: item.region || '',
      descricao: item.description || 'Condomínio listado no catálogo CRCN.',
      comodidades: item.amenities || [],
      property_key: item.property_key
    }));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return LEGACY_IMOB_CONDOMINIUMS.map((item) => ({ ...item, property_key: internalKey(item.nome) }));
}

function loadPropertyIdentityCatalog() {
  try {
    const catalog = JSON.parse(fs.readFileSync(PROPERTY_CATALOG_PATH, 'utf8'));
    validateCatalog(catalog);
    return catalog;
  } catch (error) {
    if (error.code === 'ENOENT') return { properties: [] };
    throw error;
  }
}

const IMOB_KNOWN_CONDOMINIUMS = loadInternalCatalog();

const STOP_WORDS = new Set(['hotel', 'condominio', 'flat', 'service', 'resort', 'spa', 'termas', 'thermas', 'do', 'da', 'dos', 'das', 'de', 'e', 'o', 'a']);

function normalizeLookupKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeCatalogName(value) {
  // Stays often prefixes property titles with the CRCN brand. It is not
  // part of the condominium name and must not reduce a catalog match score.
  return normalizeLookupKey(value).replace(/^crcn\s+/, '');
}

function extractDistinctiveTokens(text) {
  const norm = normalizeLookupKey(text);
  if (!norm) return [];
  return norm.split(/\s+/).filter(t => t.length > 2 && !STOP_WORDS.has(t));
}

function calculateMatchScore(textA, textB) {
  const normA = normalizeLookupKey(textA);
  const normB = normalizeLookupKey(textB);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;

  const tokensA = extractDistinctiveTokens(normA);
  const tokensB = extractDistinctiveTokens(normB);

  if (!tokensA.length || !tokensB.length) {
    return normA.includes(normB) || normB.includes(normA) ? 0.7 : 0;
  }

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const common = tokensA.filter(t => setB.has(t));
  if (!common.length) return 0;

  // Jaccard similarity: intersection / union
  const union = new Set([...tokensA, ...tokensB]);
  const score = common.length / union.size;
  return score;
}

function compactLookupKey(value) {
  return normalizeLookupKey(value).replace(/\s+/g, '');
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function scoreCatalogName(query, candidate) {
  const queryKey = normalizeLookupKey(query);
  const candidateKey = normalizeLookupKey(candidate);
  if (!queryKey || !candidateKey) return 0;
  if (queryKey === candidateKey) return 1;

  const queryCompact = compactLookupKey(query);
  const candidateCompact = compactLookupKey(candidate);
  if (queryCompact === candidateCompact) return 0.98;
  if (queryCompact.length >= 4 && candidateCompact.includes(queryCompact)) return 0.86;

  const queryTokens = extractDistinctiveTokens(queryKey);
  const candidateTokens = extractDistinctiveTokens(candidateKey);
  if (!queryTokens.length || !candidateTokens.length) return 0;

  const matchedTokens = queryTokens.filter((token) => candidateTokens.some((candidateToken) => {
    if (candidateToken === token || candidateToken.startsWith(token)) return true;
    if (token.length >= 4 && candidateToken.includes(token)) return true;
    if (token.length < 5 || candidateToken.length < 5) return false;
    const maxDistance = Math.max(token.length, candidateToken.length) >= 8 ? 2 : 1;
    return editDistance(token, candidateToken) <= maxDistance;
  }));
  if (matchedTokens.length === queryTokens.length) {
    return 0.76 + 0.2 * (queryTokens.length / candidateTokens.length);
  }
  if (matchedTokens.length) return 0.68 * (matchedTokens.length / queryTokens.length);

  const distance = editDistance(queryCompact, candidateCompact);
  const ratio = distance / Math.max(queryCompact.length, candidateCompact.length);
  return queryCompact.length >= 5 && ratio <= 0.2 ? 0.78 - 0.3 * ratio : 0;
}

function findUniqueCatalogMatch(query, catalog) {
  const ranked = catalog
    .map((item) => ({ item, score: scoreCatalogName(query, item.nome) }))
    .filter(({ score }) => score >= 0.72)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return null;
  if (ranked.length > 1 && ranked[0].score - ranked[1].score < 0.08) return null;
  return ranked[0].item;
}

function findUniqueStaysMatch(query, staysList, rawInput) {
  const byId = staysList.find((property) =>
    [property?._id, property?.id, property?.val].filter(Boolean).map(String).includes(String(rawInput))
  );
  if (byId) return { property: byId, ambiguous: false };

  const ranked = staysList
    .map((property) => ({
      property,
      score: calculateMatchScore(
        normalizeCatalogName(property?._mstitle?.pt_BR || property?.internalName || property?.name || ''),
        normalizeCatalogName(query)
      )
    }))
    .filter(({ score }) => score >= 0.6)
    .sort((left, right) => right.score - left.score);
  if (!ranked.length) return { property: null, ambiguous: false };
  if (ranked.length > 1 && ranked[0].score - ranked[1].score < 0.08) {
    return { property: null, ambiguous: true };
  }
  return { property: ranked[0].property, ambiguous: false };
}

class PropertyCatalog {
  constructor({ staysClient, imobClient, imobCatalog = IMOB_KNOWN_CONDOMINIUMS, identityCatalog = null } = {}) {
    this.staysClient = staysClient;
    this.imobClient = imobClient;
    this.imobCatalog = [...imobCatalog];
    this.identityCatalog = identityCatalog;
    this.dynamicImobDiscovered = new Map();
  }

  // Registra dinamicamente condomínios encontrados em buscas do Imob
  registerDiscoveredImob(record) {
    const id = record?.condominioId || record?.idCondominio || (typeof record?.condominio === 'number' ? record.condominio : null);
    const name = record?.nomeCond || record?.condominioNome || record?.condominio_name;
    if (id && name && !this.imobCatalog.some((item) => String(item.id) === String(id))) {
      const entry = {
        id: Number(id) || id,
        nome: cleanText(name),
        cidade: cleanText(record?.cidade || 'Caldas Novas'),
        regiao: '',
        descricao: `Condomínio parceiro em Caldas Novas com estrutura de lazer e piscinas.`,
        comodidades: ['Piscina aquecida (Compartilhada)', 'Estacionamento', 'Elevador', 'Recepção 24 horas']
      };
      this.dynamicImobDiscovered.set(String(id), entry);
    }
  }

  get allImobCondominiums() {
    return [...this.imobCatalog, ...this.dynamicImobDiscovered.values()];
  }

  findInternalRecordForStays(staysIds = []) {
    const ids = new Set(staysIds.filter(Boolean).map(String));
    const catalog = this.identityCatalog || loadPropertyIdentityCatalog();
    return (catalog.properties || []).find((record) => {
      if (record.status !== 'active' || record.sources?.stays?.status !== 'active') return false;
      const stays = record.sources?.stays;
      const recordIds = [stays?.id, ...(stays?.alternate_ids || [])].filter(Boolean).map(String);
      return recordIds.some((id) => ids.has(id));
    });
  }

  findInternalRecordByKey(propertyKey) {
    if (!propertyKey) return null;
    const catalog = this.identityCatalog || loadPropertyIdentityCatalog();
    return (catalog.properties || []).find((record) => record.property_key === String(propertyKey)) || null;
  }

  findVerifiedImobForStays(staysIds = []) {
    const record = this.findInternalRecordForStays(staysIds);
    if (!record || !['verified_exact_name', 'verified_normalized_name', 'verified_manual'].includes(record.match_status) || record.sources?.imob?.status !== 'active' || record.sources?.imob?.id == null) return null;
    return this.allImobCondominiums.find((item) => String(item.id) === String(record.sources.imob.id)) || null;
  }

  // Pesquisa unificada em ambos os provedores para a rota GET /api/v1/properties
  async searchProperties(query = '') {
    const normalizedQuery = normalizeLookupKey(query);
    const results = [];

    // 1. Busca na Stays
    let staysMatches = [];
    if (this.staysClient) {
      try {
        const found = await this.staysClient.searchProperties(query);
        staysMatches = found.slice(0, 5);
      } catch (err) {
        // Continua para o Imob se a Stays falhar
      }
    }

    // Enriquece correspondências da Stays
    for (const property of staysMatches) {
      let detail = property;
      try {
        if (this.staysClient) {
          detail = await this.staysClient.getProperty(property?._id || property?.id).catch(() => property);
        }
      } catch {}

      const address = detail?.address || {};
      const name = cleanText(detail?._mstitle?.pt_BR || detail?.internalName || detail?.id);

      // Cross-provider links must come from a reviewed internal catalog record.
      const staysIds = [detail?._id, detail?.id, property?._id, property?.id];
      const identity = this.findInternalRecordForStays(staysIds);
      const matchedImob = this.findVerifiedImobForStays(staysIds);

      results.push({
        property_key: identity?.property_key || matchedImob?.property_key || internalKey(name),
        mapping_status: identity?.match_status || 'pending_review',
        id: detail?.id || detail?._id,
        stays_id: detail?._id || detail?.id,
        imob_id: matchedImob ? matchedImob.id : null,
        provedor: matchedImob ? 'both' : 'stays',
        nome: matchedImob ? matchedImob.nome : name,
        descricao: cleanText(detail?._msdesc?.pt_BR || detail?._mssummary?.pt_BR || '').slice(0, 500),
        cidade: cleanText(address.city || 'Caldas Novas'),
        regiao: cleanText(address.region || ''),
        comodidades: Array.isArray(detail?.amenities) ? detail.amenities : [],
        imagens: (detail?._t_imagesMeta || detail?.images || []).map((img) => img?.url).filter(Boolean).slice(0, 3)
      });
    }

    // 2. Busca no catálogo Imob (para condomínios que a Stays não tem)
    for (const imob of this.allImobCondominiums) {
      const matchScore = normalizedQuery ? scoreCatalogName(query, imob.nome) : 1;
      if (!normalizedQuery || matchScore >= 0.4) {
        const identity = this.findInternalRecordByKey(imob.property_key);
        // Se já foi incluído via Stays, não duplica
        const alreadyIncluded = results.some((item) => {
          return String(item.imob_id || '') === String(imob.id)
            || String(item.property_key || '') === String(imob.property_key || '');
        });

        if (!alreadyIncluded) {
          results.push({
            property_key: imob.property_key || internalKey(imob.nome),
            mapping_status: identity?.match_status || 'source_only',
            id: String(imob.id),
            stays_id: null,
            imob_id: imob.id,
            provedor: 'imob',
            nome: imob.nome,
            descricao: imob.descricao,
            cidade: imob.cidade,
            regiao: imob.regiao,
            comodidades: imob.comodidades,
            imagens: []
          });
        }
      }
    }

    return results.slice(0, 5);
  }

  // Resolve a intenção de propriedade enviada em POST /api/v1/search
  // Disponibilidade aceita somente a identidade interna CRCN.
  async resolvePropertyFilter(propertyInput) {
    if (!propertyInput) return null;

    const raw = String(propertyInput).trim();
    if (!raw.startsWith('crcn:')) {
      return { type: 'unknown', name: raw, propertyKey: null, staysId: null, imobId: null, code: 'PROPERTY_KEY_REQUIRED' };
    }

    // A property_key is the stable CRCN identity. Resolve it directly instead
    // of treating the key as a fuzzy name and accidentally selecting a source.
    if (raw.startsWith('crcn:')) {
      const identity = this.findInternalRecordByKey(raw);
      if (!identity || identity.status !== 'active') {
        return { type: 'unknown', name: raw, propertyKey: raw, staysId: null, imobId: null };
      }

      const stays = identity.sources?.stays;
      const imob = identity.sources?.imob;
      const staysActive = stays?.status === 'active' && stays.id != null;
      const imobActive = imob?.status === 'active' && imob.id != null;
      const verifiedMatches = ['verified_exact_name', 'verified_normalized_name', 'verified_manual'];
      const mappingVerified = verifiedMatches.includes(identity.match_status);

      if (staysActive && imobActive && !mappingVerified) {
        return {
          type: 'mapping_pending',
          propertyKey: identity.property_key,
          name: identity.canonical_name,
          mappingStatus: identity.match_status,
          staysId: String(stays.id),
          imobId: String(imob.id)
        };
      }

      if (staysActive && imobActive) {
        return {
          type: 'hybrid',
          propertyKey: identity.property_key,
          name: identity.canonical_name,
          staysId: String(stays.id),
          staysFilter: [String(stays.id)],
          imobId: String(imob.id),
          imobName: identity.canonical_name,
          mappingStatus: identity.match_status
        };
      }

      if (staysActive) {
        return {
          type: 'stays_only',
          propertyKey: identity.property_key,
          name: identity.canonical_name,
          staysId: String(stays.id),
          staysFilter: [String(stays.id)],
          imobId: null,
          imobName: identity.canonical_name,
          mappingStatus: identity.match_status
        };
      }

      if (imobActive) {
        return {
          type: 'imob_only',
          propertyKey: identity.property_key,
          name: identity.canonical_name,
          staysId: null,
          staysFilter: null,
          imobId: String(imob.id),
          imobName: identity.canonical_name,
          mappingStatus: identity.match_status
        };
      }

      return { type: 'unknown', name: identity.canonical_name, propertyKey: identity.property_key, staysId: null, imobId: null };
    }

    return { type: 'unknown', name: raw, propertyKey: raw, staysId: null, imobId: null };
  }

  getImobCondominiumName(id) {
    return this.allImobCondominiums.find((item) => String(item.id) === String(id))?.nome || null;
  }
}

module.exports = {
  PropertyCatalog,
  normalizeLookupKey,
  calculateMatchScore,
  scoreCatalogName,
  extractDistinctiveTokens,
  findUniqueStaysMatch,
  IMOB_KNOWN_CONDOMINIUMS,
  PROPERTY_CATALOG_PATH
};
