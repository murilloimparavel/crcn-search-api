const { cleanText } = require('./normalizer');

// Catálogo base de condomínios parceiros conhecidos do Imob em Caldas Novas
const IMOB_KNOWN_CONDOMINIUMS = [
  {
    id: 135,
    nome: 'Golden Dolphin Supreme',
    cidade: 'Caldas Novas',
    regiao: 'Turista 1',
    descricao: 'Condomínio de alto padrão com complexo aquático completo, piscinas termais para adultos e crianças, sauna, toboáguas e lanchonete.',
    comodidades: ['Piscina ao ar livre (Compartilhada)', 'Piscina aquecida (Compartilhada)', 'Sauna', 'Estacionamento', 'Elevador', 'Recepção 24 horas']
  },
  {
    id: 136,
    nome: 'Everest Flat Service',
    cidade: 'Caldas Novas',
    regiao: 'Centro',
    descricao: 'Localizado no centro de Caldas Novas, com fácil acesso ao comércio, piscinas de águas termais, sauna e recepção 24h.',
    comodidades: ['Piscina aquecida (Compartilhada)', 'Sauna', 'Estacionamento', 'Elevador', 'Recepção 24 horas']
  },
  {
    id: 137,
    nome: 'Lagoa Quente Flat Service',
    cidade: 'Caldas Novas',
    regiao: 'Lagoa Quente',
    descricao: 'Ao lado do Parque Lagoa Quente, com parque aquático termal próprio, toboáguas, bar molhado e ambiente familiar.',
    comodidades: ['Piscina ao ar livre (Compartilhada)', 'Piscina aquecida (Compartilhada)', 'Bar molhado', 'Sauna', 'Estacionamento']
  },
  {
    id: 138,
    nome: 'Golden Dolphin Grand Hotel',
    cidade: 'Caldas Novas',
    regiao: 'Turista 1',
    descricao: 'Um dos maiores complexos de lazer de Caldas Novas, com 9 piscinas termais, toboáguas infantis, quadras esportivas e recreação.',
    comodidades: ['Piscina ao ar livre (Compartilhada)', 'Piscina aquecida (Compartilhada)', 'Toboágua', 'Sauna', 'Quadra poliesportiva', 'Restaurante']
  },
  {
    id: 139,
    nome: 'Ilhas do Lago Eco Resort',
    cidade: 'Caldas Novas',
    regiao: 'Lago Corumbá',
    descricao: 'Resort à beira do Lago de Corumbá com piscinas de borda infinita, náutica, gastronomia refinada e contato com a natureza.',
    comodidades: ['Piscina ao ar livre (Compartilhada)', 'Piscina aquecida (Compartilhada)', 'Restaurante', 'Bar', 'Academia', 'Estacionamento']
  },
  {
    id: 140,
    nome: 'Enseada Náutica Flat Service',
    cidade: 'Caldas Novas',
    regiao: 'Lago Corumbá',
    descricao: 'Condomínio à beira do Lago Corumbá, píer náutico, piscinas termais e ambiente tranquilo para relaxamento.',
    comodidades: ['Piscina aquecida (Compartilhada)', 'Píer náutico', 'Estacionamento', 'Elevador']
  }
];

const STOP_WORDS = new Set(['hotel', 'condominio', 'flat', 'service', 'resort', 'spa', 'termas', 'thermas', 'do', 'da', 'dos', 'das', 'de', 'e', 'o', 'a']);

function normalizeLookupKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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
      const matchedImob = this.allImobCondominiums.find((imob) => {
        return calculateMatchScore(imob.nome, name) >= 0.6;
      });

      results.push({
        id: detail?.id || detail?._id,
        stays_id: detail?._id || detail?.id,
        imob_id: matchedImob ? matchedImob.id : null,
        provedor: matchedImob ? 'both' : 'stays',
        nome: name,
        descricao: cleanText(detail?._msdesc?.pt_BR || detail?._mssummary?.pt_BR || '').slice(0, 500),
        cidade: cleanText(address.city || 'Caldas Novas'),
        regiao: cleanText(address.region || ''),
        comodidades: Array.isArray(detail?.amenities) ? detail.amenities : [],
        imagens: (detail?._t_imagesMeta || detail?.images || []).map((img) => img?.url).filter(Boolean).slice(0, 3)
      });
    }

    // 2. Busca no catálogo Imob (para condomínios que a Stays não tem)
    for (const imob of this.allImobCondominiums) {
      const imobNorm = normalizeLookupKey(imob.nome);
      const isSubstring = normalizedQuery && (imobNorm.includes(normalizedQuery) || normalizedQuery.includes(imobNorm));
      const matchScore = normalizedQuery ? calculateMatchScore(imob.nome, query) : 1;
      if (!normalizedQuery || isSubstring || matchScore >= 0.4) {
        // Se já foi incluído via Stays, não duplica
        const alreadyIncluded = results.some((item) => {
          return calculateMatchScore(item.nome, imob.nome) >= 0.6;
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

    return results.slice(0, 5);
  }

  // Resolve a intenção de propriedade enviada em POST /api/v1/search
  // Aceita: nome ("Thermas Place", "Golden Dolphin"), ID Stays ("LG15J", "6a356..."), ou ID Imob ("135")
  async resolvePropertyFilter(propertyInput) {
    if (!propertyInput) return null;

    const raw = String(propertyInput).trim();
    const normalized = normalizeLookupKey(raw);
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

        // Match por ID ou por similaridade de Nome
        const matchedStays = staysList.find((p) => {
          const idMatch = String(p?._id || p?.id || '') === raw;
          if (idMatch) return true;
          const pName = p?._mstitle?.pt_BR || p?.internalName || '';
          return calculateMatchScore(pName, raw) >= 0.6;
        });

        if (matchedStays) {
          staysId = matchedStays._id || matchedStays.id;
          staysName = cleanText(matchedStays._mstitle?.pt_BR || matchedStays.internalName || '');
          staysFilter = [staysId];
        }
      } catch {}
    }

    // 3. Busca correspondente no Imob
    const matchLookup = staysName || raw;
    const matchedImob = this.allImobCondominiums.find((imob) => {
      return calculateMatchScore(imob.nome, matchLookup) >= 0.6;
    });

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
}

module.exports = {
  PropertyCatalog,
  normalizeLookupKey,
  calculateMatchScore,
  extractDistinctiveTokens,
  IMOB_KNOWN_CONDOMINIUMS
};
