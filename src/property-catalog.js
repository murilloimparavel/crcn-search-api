const { cleanText } = require('./normalizer');

// IDs publicados em https://reservascrcn.com.br/condominio/{id}.
// A API Imob usa o mesmo ID no campo `condominio` de /listOrcamento.
// Nomes/IDs conferidos no catálogo público em 2026-10-15.
const IMOB_KNOWN_CONDOMINIUMS = [
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
].map(([nome, id, cidade = 'Caldas Novas']) => {
  const preservedDetails = {
    91: {
      regiao: 'Turista 1',
      descricao: 'Condomínio de alto padrão com complexo aquático completo, piscinas termais para adultos e crianças, sauna, toboáguas e lanchonete.',
      comodidades: ['Piscina ao ar livre (Compartilhada)', 'Piscina aquecida (Compartilhada)', 'Sauna', 'Estacionamento', 'Elevador', 'Recepção 24 horas']
    },
    44: {
      regiao: 'Centro',
      descricao: 'Localizado no centro de Caldas Novas, com fácil acesso ao comércio, piscinas de águas termais, sauna e recepção 24h.',
      comodidades: ['Piscina aquecida (Compartilhada)', 'Sauna', 'Estacionamento', 'Elevador', 'Recepção 24 horas']
    },
    135: {
      regiao: 'Lagoa Quente',
      descricao: 'Ao lado do Parque Lagoa Quente, com parque aquático termal próprio, toboáguas, bar molhado e ambiente familiar.',
      comodidades: ['Piscina ao ar livre (Compartilhada)', 'Piscina aquecida (Compartilhada)', 'Bar molhado', 'Sauna', 'Estacionamento']
    }
  }[id] || {};
  return {
    id,
    nome,
    cidade,
    regiao: preservedDetails.regiao || '',
    descricao: preservedDetails.descricao || 'Condomínio listado no catálogo público da CRCN.',
    comodidades: preservedDetails.comodidades || []
  };
});

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
  // Remove the CRCN brand prefix used in some Stays property titles before
  // matching the canonical condominium name from the Imob catalog.
  return normalizeLookupKey(value).replace(/^crcn\s+/, '');
}

function extractDistinctiveTokens(text) {
  const norm = normalizeLookupKey(text);
  if (!norm) return [];
  return [...new Set(norm.split(/\s+/).filter(t => t.length > 0 && !STOP_WORDS.has(t)))];
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

  const queryTokens = extractDistinctiveTokens(queryKey);
  if (!queryTokens.length) return 0;

  const queryCompact = compactLookupKey(query);
  const candidateCompact = compactLookupKey(candidate);
  if (queryCompact === candidateCompact) return 0.98;
  if (queryCompact.length >= 4 && candidateCompact.includes(queryCompact)) return 0.86;

  const candidateTokens = extractDistinctiveTokens(candidateKey);
  if (!queryTokens.length || !candidateTokens.length) return 0;

  const usedCandidateTokens = new Set();
  const matchedTokens = queryTokens.filter((token) => {
    const matchedCandidate = candidateTokens.find((candidateToken) => {
      if (usedCandidateTokens.has(candidateToken)) return false;
      if (candidateToken === token || candidateToken.startsWith(token)) return true;
      if (token.length >= 4 && candidateToken.includes(token)) return true;
      if (token.length < 5 || candidateToken.length < 5) return false;
      const maxDistance = Math.max(token.length, candidateToken.length) >= 8 ? 2 : 1;
      return editDistance(token, candidateToken) <= maxDistance;
    });
    if (!matchedCandidate) return false;
    usedCandidateTokens.add(matchedCandidate);
    return true;
  });
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

class PropertyCatalog {
  constructor({ staysClient, imobClient, imobCatalog = IMOB_KNOWN_CONDOMINIUMS } = {}) {
    this.staysClient = staysClient;
    this.imobClient = imobClient;
    this.imobCatalog = [...imobCatalog];
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

  // Pesquisa unificada em ambos os provedores para a rota GET /api/v1/properties
  async searchProperties(query = '') {
    const normalizedQuery = normalizeLookupKey(query);
    const results = [];
    const seenNames = new Set();

    // 1. Busca na Stays
    let staysMatches = [];
    let staysFilters = null;
    if (this.staysClient) {
      try {
        const found = await this.staysClient.searchProperties(query);
        staysFilters = await this.staysClient.getSearchFilters().catch(() => null);
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
      const normalizedName = normalizeLookupKey(name);
      seenNames.add(normalizedName);

      // Verifica se existe correspondente conhecido no Imob
      const matchedImob = findUniqueCatalogMatch(normalizeCatalogName(name), this.allImobCondominiums);

      results.push({
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
        // Se já foi incluído via Stays, não duplica
        const alreadyIncluded = results.some((item) => {
          if (normalizeLookupKey(item.nome) === normalizeLookupKey(imob.nome)) return true;
          return item.imob_id && String(item.imob_id) === String(imob.id);
        });

        if (!alreadyIncluded) {
          results.push({
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

    return results
      .map((item, index) => ({ item, index, score: normalizedQuery ? scoreCatalogName(query, item.nome) : 0 }))
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .slice(0, 5)
      .map(({ item }) => item);
  }

  // Resolve a intenção de propriedade enviada em POST /api/v1/search
  // Aceita: nome ("Thermas Place", "Golden Dolphin"), ID Stays ("LG15J", "6a356..."), ou ID Imob ("135")
  async resolvePropertyFilter(propertyInput) {
    if (!propertyInput) return null;

    const raw = String(propertyInput).trim();
    const isNumeric = /^\d+$/.test(raw);

    // 1. Se for ID numérico puro, verifica se é Imob direto
    if (isNumeric) {
      const imobCondo = this.allImobCondominiums.find((item) => String(item.id) === raw);
      return {
        type: 'imob_only',
        name: imobCondo?.nome || raw,
        imobId: raw,
        staysId: null
      };
    }

    // 2. Busca no catálogo Stays
    let staysFilter = null;
    let staysName = null;
    let staysId = null;

    if (this.staysClient) {
      try {
        const filters = await this.staysClient.getSearchFilters().catch(() => null);
        const staysList = Array.isArray(filters?.properties) ? filters.properties : [];

        // Prioriza ID exato; para nomes, exige uma correspondência única.
        const matchedStaysById = staysList.find((property) =>
          [property?._id, property?.id, property?.val].filter(Boolean).map(String).includes(raw)
        );
        const staysCandidates = staysList.map((property) => ({
          property,
          nome: cleanText(property?._mstitle?.pt_BR || property?.internalName || '')
        }));
        const matchedStays = matchedStaysById || findUniqueCatalogMatch(raw, staysCandidates)?.property;

        if (matchedStays) {
          staysId = matchedStays._id || matchedStays.id;
          staysName = cleanText(matchedStays._mstitle?.pt_BR || matchedStays.internalName || '');
          staysFilter = [staysId];
        }
      } catch {}
    }

    // 3. Busca correspondente no Imob
    const matchLookup = normalizeCatalogName(staysName || raw);
    const matchedImob = findUniqueCatalogMatch(matchLookup, this.allImobCondominiums);

    if (staysId && matchedImob) {
      return {
        type: 'hybrid',
        name: staysName,
        staysId,
        staysFilter,
        imobId: String(matchedImob.id),
        imobName: matchedImob.nome
      };
    }

    if (staysId) {
      return {
        type: 'stays_only',
        name: staysName,
        staysId,
        staysFilter,
        imobId: null,
        imobName: staysName
      };
    }

    if (matchedImob) {
      return {
        type: 'imob_only',
        name: matchedImob.nome,
        staysId: null,
        staysFilter: null,
        imobId: String(matchedImob.id),
        imobName: matchedImob.nome
      };
    }

    // Fallback: repassa como query de nome para ambos tentarem
    return {
      type: 'unknown',
      name: raw,
      staysId: null,
      staysFilter: null,
      imobId: null,
      imobName: raw
    };
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
  IMOB_KNOWN_CONDOMINIUMS
};
