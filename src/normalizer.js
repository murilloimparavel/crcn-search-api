/**
 * Dicionário de diferenciais dos condomínios mais populares de Caldas Novas
 */
const CONDOMINIO_EXTRAS = {
  'evian': 'Resort de luxo, complexo aquático completo com águas termais, cinema, salão de jogos, academia e alta gastronomia.',
  'golden': 'Parque aquático completo com múltiplas piscinas termais, toboáguas, sauna, recreação infantil e lanchonetes.',
  'boulevard': 'Excelente localização central, parque aquático termal com cascatas, hidromassagem, toboáguas e bar molhado.',
  'thermas place': 'Piscinas termais 24h, sauna, excelente custo-benefício e localização privilegiada próxima ao centro.',
  'lagoa': 'Estrutura moderna, ambiente familiar com ampla área verde e proximidade com o Lagoa Termas Parque.',
  'amethist': 'Ótima localização central, piscinas termais, sauna e fácil acesso aos melhores restaurantes e comércio.',
  'recanto do bosque': 'Ambiente tranquilo, familiar e arborizado com piscinas termais e sauna.',
  'eldorado': 'Complexo de lazer termal, toboáguas, saunas, quadras e parque aquático para todas as idades.',
  'aquarius': 'Piscinas de águas termais, lanchonete, recepção 24h e ambiente familiar acolhedor.',
  'piazza': 'Design moderno e sofisticado, piscinas termais com borda infinita, hidromassagem e arquitetura italiana.',
  'diroma': 'Acesso a um dos maiores complexos termais, toboáguas gigantes e ampla infraestrutura de lazer.',
  'rio das pedras': 'Ambiente aconchegante com águas termais naturais, tranquilidade e área verde.'
};

function getDiferenciais(condominio) {
  const lower = (condominio || '').toLowerCase();
  for (const [key, desc] of Object.entries(CONDOMINIO_EXTRAS)) {
    if (lower.includes(key)) {
      return desc;
    }
  }
  return 'Parque aquático com piscinas de águas termais naturais, sauna e estrutura de lazer completa.';
}

/**
 * Sanitiza strings e remove quebras de linha/espaços excessivos
 */
function cleanString(str) {
  if (!str) return '';
  return str.replace(/\s+/g, ' ').trim();
}

/**
 * Normaliza e enriquece os dados brutos extraídos do site da CRCN
 */
function normalizeApartment(raw, from, to, nights, persons) {
  const text = raw.text || '';
  
  // Extrair nome
  const lines = text.split('\n').map(l => cleanString(l)).filter(Boolean);
  const nome = lines[0] || 'Apartamento em Caldas Novas';
  
  // Extrair condomínio
  const condominio = cleanString(nome.split('-')[0]);
  
  // Extrair quartos
  const quartosMatch = text.match(/(\d+)\s*Quarto/i);
  const quartos = quartosMatch ? parseInt(quartosMatch[1], 10) : 1;
  
  // Extrair banheiros
  const banheirosMatch = text.match(/(\d+)\s*Banheiro/i);
  const banheiros = banheirosMatch ? parseInt(banheirosMatch[1], 10) : 1;
  
  // Extrair capacidade de hóspedes
  const hospedesMatch = text.match(/(\d+)\s*H[oó]spede/i);
  const safePersons = Number.isInteger(persons) && persons > 0 ? persons : 2;
  const capacidade = hospedesMatch ? parseInt(hospedesMatch[1], 10) : safePersons;
  
  // Extrair valor da diária
  let valorDiaria = 0;
  const precoMatch = text.match(/R\$\s*([\d\.,]+)/i);
  if (precoMatch) {
    const rawPrice = precoMatch[1].replace(/\./g, '').replace(',', '.');
    valorDiaria = parseFloat(rawPrice) || 0;
  }
  
  const safeNights = Number.isInteger(nights) && nights > 0 ? nights : 1;
  const valorTotal = parseFloat((valorDiaria * safeNights).toFixed(2));
  const diferenciais = getDiferenciais(condominio);
  
  return {
    id: raw.id || null,
    nome,
    condominio,
    cidade: 'Caldas Novas',
    quartos,
    banheiros,
    capacidade,
    valor_diaria: valorDiaria,
    valor_total: valorTotal,
    diferenciais,
    link_reserva: raw.link || `https://www.centraldereservascaldas.com.br/pt/search?from=${from}&to=${to}&persons=${safePersons}`
  };
}

/**
 * Categoriza e ordena os resultados para facilitar a escolha da LLM
 */
function processAndRankResults(apartments, from, to, nights, persons) {
  const normalized = apartments.map(a => normalizeApartment(a, from, to, nights, persons));
  
  // Ordenar por preço (mais econômico primeiro)
  normalized.sort((a, b) => a.valor_diaria - b.valor_diaria);
  
  if (normalized.length === 0) {
    return [];
  }
  
  // Marcar categorias recomendadas
  const count = normalized.length;
  normalized.forEach((item, index) => {
    if (index === 0) {
      item.tag_sugerida = 'Mais Econômica';
    } else if (index === Math.floor(count / 2)) {
      item.tag_sugerida = 'Melhor Custo-Benefício';
    } else if (index === count - 1 || item.quartos >= 3) {
      item.tag_sugerida = 'Mais Completa / Alto Padrão';
    } else {
      item.tag_sugerida = 'Opção Disponível';
    }
  });
  
  return normalized;
}

module.exports = {
  normalizeApartment,
  processAndRankResults
};
