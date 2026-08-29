function cleanText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTitle(apartment) {
  return cleanText(
    apartment?._t_mstitle?.pt_BR
    || apartment?._mstitle?.pt_BR
    || apartment?.avatar
    || apartment?.id
    || 'Apartamento em Caldas Novas'
  );
}

function getCondominio(apartment, title) {
  return cleanText(apartment?._t_building?._t_mstitle?.pt_BR || title.split('-')[0]);
}

function getDiferenciais(apartment) {
  const resumo = cleanText(apartment?._mssummary?.pt_BR || apartment?._msdesc?.pt_BR);
  return resumo ? resumo.slice(0, 280) : '';
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getPublicApartmentCode(apartment) {
  // The Stays public page uses the short listing code (e.g. LG03J), not _id.
  return cleanText(apartment?.id || apartment?._id);
}

function getApartmentSlug(apartment, title) {
  // `avatar` matches the website slug (e.g. "Aquarius Flat - Apto D 704").
  return slugify(apartment?.avatar || title);
}

function buildBookingLink({ apartment, from, to, persons, title }) {
  const params = new URLSearchParams({ from, to, persons: String(persons) });
  const code = getPublicApartmentCode(apartment);
  const slug = getApartmentSlug(apartment, title);
  if (code && slug) {
    return `https://www.centraldereservascaldas.com.br/pt/apartment/${encodeURIComponent(code)}/${slug}?${params}`;
  }
  // Keep a safe fallback for malformed records without public identity.
  return `https://www.centraldereservascaldas.com.br/pt/search?${params}`;
}

function normalizeApartment({ apartment, price }, { from, to, persons }) {
  const nome = getTitle(apartment);
  return {
    id: apartment._id || apartment.id || null,
    nome,
    condominio: getCondominio(apartment, nome),
    cidade: cleanText(apartment?._adr?.city) || 'Caldas Novas',
    quartos: Number(apartment?._i_rooms) || null,
    banheiros: Number(apartment?._f_bathrooms) || null,
    capacidade: Number(apartment?._i_maxPers) || persons,
    valor_diaria: price.valor_diaria,
    valor_total: price.valor_total,
    diferenciais: getDiferenciais(apartment),
    link_reserva: buildBookingLink({ apartment, title: nome, from, to, persons })
  };
}

function processAndRankResults(pricedApartments, criteria) {
  const normalized = pricedApartments.map((item) => normalizeApartment(item, criteria));
  normalized.sort((a, b) => a.valor_total - b.valor_total);
  normalized.forEach((item, index) => {
    item.tag_sugerida = index === 0
      ? 'Mais Econômica'
      : index === Math.floor(normalized.length / 2)
        ? 'Melhor Custo-Benefício'
        : 'Opção Disponível';
  });
  return normalized;
}

module.exports = { cleanText, slugify, buildBookingLink, normalizeApartment, processAndRankResults };
