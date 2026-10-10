const { URLSearchParams } = require('node:url');

function cleanText(value) {
  return String(value || '')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function translated(value) {
  if (typeof value === 'string') return value;
  return value?.pt_BR || value?.en_US || Object.values(value || {})[0] || '';
}

function getTitle(listing) {
  return cleanText(
    translated(listing?._mstitle)
    || listing?.internalName
    || listing?.id
    || 'Acomodação em Caldas Novas'
  );
}

function getPublicApartmentCode(listing) {
  return cleanText(listing?.id || listing?._id);
}

function buildBookingLink({ apartment, from, to, persons }) {
  const params = new URLSearchParams({ from, to, persons: String(persons) });
  const code = getPublicApartmentCode(apartment);
  if (code) {
    return `https://www.centraldereservascaldas.com.br/pt/apartment/${encodeURIComponent(code)}?${params}`;
  }
  return `https://www.centraldereservascaldas.com.br/pt/search?${params}`;
}

function getAmenityNames(listing, catalog = []) {
  const labels = new Map(catalog.map((item) => [item?._id || item?.id, cleanText(translated(item?._mstitle) || item?.val)]));
  const entries = listing?.amenities || [];
  return [...new Set(entries.map((item) => {
    if (typeof item === 'string') return labels.get(item) || '';
    const id = item?._id || item?.id;
    return cleanText(translated(item?._mstitle) || labels.get(id));
  }).filter(Boolean))];
}

function getHighlights(listing, catalog = []) {
  const amenities = getAmenityNames(listing, catalog);
  const summary = cleanText(translated(listing?._mssummary) || translated(listing?._msdesc));
  const highlights = amenities.slice(0, 5);
  if (summary && highlights.length < 3) highlights.push(summary.slice(0, 220));
  return highlights;
}

function imageUrls(value) {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(entries.map((image) => {
    const url = typeof image === 'string' ? image : image?.url || image?.src || image?.imageUrl;
    if (typeof url !== 'string') return null;
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' ? parsed.href : null;
    } catch { return null; }
  }).filter(Boolean))].slice(0, 10);
}

function normalizeApartment({ listing, details, property, amenityCatalog = [] }, { from, to, persons, nights }) {
  const source = details || listing;
  const price = listing?.bookingPrice || {};
  const total = Number(price?._mctotal?.BRL ?? price?._mctotal?.[price?.mainCurrency] ?? 0);
  const nome = getTitle(source);
  const address = source?.address || listing?.address || {};
  const amenities = getAmenityNames(source, amenityCatalog);
  const highlights = getHighlights(source, amenityCatalog);
  const images = imageUrls(source?._t_imagesMeta || source?.images || listing?._t_imagesMeta || listing?.images);
  const mainImage = imageUrls(source?._t_mainImageMeta || listing?._t_mainImageMeta)[0] || images[0] || null;

  return {
    id: getPublicApartmentCode(listing),
    nome,
    condominio: cleanText(translated(property?._mstitle) || property?.internalName) || null,
    cidade: cleanText(address.city) || null,
    quartos: Number(source?._i_rooms ?? listing?._i_rooms) || null,
    camas: Number(source?._i_beds ?? listing?._i_beds) || null,
    banheiros: Number(source?._f_bathrooms ?? listing?._f_bathrooms) || null,
    capacidade: Number(source?._i_maxGuests ?? listing?._i_maxGuests) || persons,
    valor_diaria: nights > 0 && total > 0 ? Math.round((total / nights) * 100) / 100 : null,
    valor_total: total || null,
    moeda: price.mainCurrency || 'BRL',
    noites: nights,
    destaques: highlights,
    diferenciais: highlights.join('; '),
    image: mainImage,
    images,
    link_reserva: buildBookingLink({ apartment: listing, from, to, persons })
  };
}

function getCandidateListing(candidate) {
  return candidate?.listing || candidate || {};
}

function getCandidatePropertyId(candidate) {
  const listing = getCandidateListing(candidate);
  return String(listing?._idproperty || listing?.property?._id || listing?.propertyId || listing?.condominio || '');
}

function getCandidateNumber(candidate, keys) {
  const listing = getCandidateListing(candidate);
  for (const key of keys) {
    const canonical = key === '_i_maxGuests' ? 'capacidade'
      : key === '_i_rooms' ? 'quartos'
        : key === '_i_beds' ? 'camas'
          : key;
    const number = Number(listing?.[key] ?? listing?.[canonical]);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function getCandidateAmenities(candidate) {
  const listing = getCandidateListing(candidate);
  return new Set((listing?.amenities || []).map((amenity) => {
    if (typeof amenity === 'string') return amenity;
    return amenity?._id || amenity?.id || translated(amenity?._mstitle);
  }).filter(Boolean).map(String));
}

function getCandidatePrice(candidate) {
  const listing = getCandidateListing(candidate);
  const price = listing?.bookingPrice || {};
  const total = Number(price?._mctotal?.BRL ?? price?._mctotal?.[price?.mainCurrency] ?? listing?.valor_total);
  return Number.isFinite(total) && total > 0 ? total : Infinity;
}

function candidateProfileDistance(candidate, other) {
  const capacityDelta = Math.abs(
    getCandidateNumber(candidate, ['_i_maxGuests']) - getCandidateNumber(other, ['_i_maxGuests'])
  );
  const roomsDelta = Math.abs(
    getCandidateNumber(candidate, ['_i_rooms']) - getCandidateNumber(other, ['_i_rooms'])
  );
  const bedsDelta = Math.abs(
    getCandidateNumber(candidate, ['_i_beds']) - getCandidateNumber(other, ['_i_beds'])
  );
  const amenities = getCandidateAmenities(candidate);
  const otherAmenities = getCandidateAmenities(other);
  const union = new Set([...amenities, ...otherAmenities]);
  const intersection = [...amenities].filter((amenity) => otherAmenities.has(amenity)).length;
  const amenityDistance = union.size ? 1 - intersection / union.size : 0;
  const candidatePrice = getCandidatePrice(candidate);
  const otherPrice = getCandidatePrice(other);
  const priceDistance = Number.isFinite(candidatePrice) && Number.isFinite(otherPrice)
    ? Math.min(5, Math.abs(candidatePrice - otherPrice) / Math.max(1, Math.min(candidatePrice, otherPrice)))
    : 0;

  return capacityDelta * 4 + roomsDelta * 3 + bedsDelta + amenityDistance * 4 + priceDistance * 3;
}

/**
 * Select a small portfolio of options instead of three adjacent low-price units.
 * Broad searches prefer different properties; searches already filtered to one
 * property diversify by capacity, rooms, beds, amenities, and price bands.
 */
function selectDiverseListings(listings, limit = 3, { preferDifferentProperties = true } = {}) {
  const sorted = [...listings].sort((a, b) => getCandidatePrice(a) - getCandidatePrice(b));
  const target = Math.min(sorted.length, Math.max(0, Number.parseInt(limit, 10) || 0));
  if (target === 0) return [];

  const selected = [sorted[0]];
  while (selected.length < target) {
    const selectedIds = new Set(selected.map((item) => {
      const listing = getCandidateListing(item);
      return String(listing.id || listing._id || '');
    }));
    const remaining = sorted.filter((item) => {
      const listing = getCandidateListing(item);
      const id = String(listing.id || listing._id || '');
      return !selected.includes(item) && (!id || !selectedIds.has(id));
    });
    if (!remaining.length) break;

    const selectedProperties = new Set(selected.map(getCandidatePropertyId).filter(Boolean));
    const otherProperties = preferDifferentProperties
      ? remaining.filter((item) => {
        const propertyId = getCandidatePropertyId(item);
        return propertyId && !selectedProperties.has(propertyId);
      })
      : [];

    if (otherProperties.length) {
      // Among unseen properties, take the least expensive available option.
      selected.push(otherProperties[0]);
      continue;
    }

    const ranked = remaining.map((candidate) => {
      const nearestProfileDistance = Math.min(
        ...selected.map((item) => candidateProfileDistance(candidate, item))
      );
      return { candidate, score: nearestProfileDistance };
    }).sort((a, b) => b.score - a.score || getCandidatePrice(a.candidate) - getCandidatePrice(b.candidate));
    selected.push(ranked[0].candidate);
  }

  return selected;
}

function getSuggestedTag(item, index, options, firstPage) {
  if (index === 0 && firstPage) return 'Mais econômica';
  if (index === 0 && !firstPage) return 'Opção adicional';
  const previousProperties = new Set(options.slice(0, index).map((option) => option.condominio).filter(Boolean));
  if (item.condominio && !previousProperties.has(item.condominio)) return 'Outro condomínio';

  const cheapest = options[0];
  if ((item.capacidade || 0) > (cheapest.capacidade || 0)) return 'Maior capacidade';
  if ((item.quartos || 0) > (cheapest.quartos || 0)) return 'Mais quartos';
  if ((item.camas || 0) > (cheapest.camas || 0)) return 'Mais camas';
  if (item.destaques?.some((highlight) => !cheapest.destaques?.includes(highlight))) return 'Diferenciais distintos';
  return 'Outra acomodação';
}

function processAndRankResults(listings, criteria) {
  const normalized = listings.map((listing) => normalizeApartment({
    ...listing,
    amenityCatalog: listing.amenityCatalog || criteria.amenityCatalog || []
  }, criteria));
  normalized.sort((a, b) => (a.valor_total ?? Infinity) - (b.valor_total ?? Infinity));
  return assignSuggestedTags(normalized, criteria.page === 1);
}

function assignSuggestedTags(options, firstPage = true) {
  options.forEach((item, index) => {
    item.tag_sugerida = getSuggestedTag(item, index, options, firstPage);
  });
  return options;
}

function normalizeProperty(property, { amenityCatalog = [] } = {}) {
  const address = property?.address || {};
  return {
    id: property?.id || property?._id || null,
    stays_id: property?._id || null,
    nome: cleanText(translated(property?._mstitle) || property?.internalName || property?.id),
    descricao: cleanText(translated(property?._msdesc)).slice(0, 500),
    cidade: cleanText(address.city),
    regiao: cleanText(address.region),
    comodidades: getAmenityNames(property, amenityCatalog),
    imagens: (property?._t_imagesMeta || property?.images || []).map((image) => image?.url).filter(Boolean).slice(0, 3)
  };
}

module.exports = {
  cleanText,
  imageUrls,
  getTitle,
  getAmenityNames,
  buildBookingLink,
  normalizeApartment,
  normalizeProperty,
  selectDiverseListings,
  processAndRankResults,
  assignSuggestedTags
};
