const { cleanText } = require('./normalizer');

function firstValue(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function priceNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^\d,.-]/g, '');
  if (!cleaned) return null;
  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isAllowedBookingHost(urlString) {
  try {
    const parsed = new URL(urlString);
    return ['reservascrcn.com.br', 'www.reservascrcn.com.br', 'centraldereservascaldas.com.br', 'www.centraldereservascaldas.com.br'].includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function buildImobBookingLink(record, { from, to, persons }) {
  const provided = firstValue(record, ['linkParceiro', 'link_parceiro', 'linkReserva', 'link_reserva']);
  if (typeof provided === 'string' && isAllowedBookingHost(provided)) return provided;
  const id = firstValue(record, ['id', 'idImovel', 'id_imovel']);
  if (!id) return null;
  const format = (date) => {
    const [year, month, day] = date.split('-');
    return `${day}-${month}-${year}`;
  };
  return `https://reservascrcn.com.br/parceiro/1/${encodeURIComponent(id)}?${format(from)},${format(to)}?s${encodeURIComponent(String(persons))},,`;
}

function normalizeImobListing(record, { from, to, persons, nights }) {
  const total = priceNumber(firstValue(record, [
    'valorTotal', 'valor_total', 'precoTotal', 'preco_total', 'total', 'valorPix', 'valor_pix', 'valor'
  ]));
  const nightly = priceNumber(firstValue(record, ['valorDiaria', 'valor_diaria', 'precoDiaria', 'preco_diaria']));
  const name = cleanText(firstValue(record, ['titulo', 'nomeUnidade', 'nome_unidade', 'unidade', 'referencia']) || 'Apartamento parceiro');
  const property = cleanText(firstValue(record, ['nomeCond', 'condominioNome', 'condominio_name', 'condominio_nome']) || 'Condomínio parceiro');
  const capacity = Number(firstValue(record, ['maxOcupantes', 'max_ocupantes', 'capacidade', 'maxPax']));
  const rooms = Number(firstValue(record, ['quartos', 'qtdeQuartos', 'qtdeqrts', 'qtdQuartos']));
  const id = firstValue(record, ['id', 'idImovel', 'id_imovel', 'unidade']);
  const link = buildImobBookingLink(record, { from, to, persons });

  return {
    id: id === null ? null : String(id),
    nome: name,
    condominio: property,
    cidade: cleanText(firstValue(record, ['cidade', 'city']) || 'Caldas Novas'),
    quartos: Number.isFinite(rooms) && rooms > 0 ? rooms : null,
    camas: null,
    banheiros: null,
    capacidade: Number.isFinite(capacity) && capacity > 0 ? capacity : persons,
    valor_diaria: nightly || (total && nights > 0 ? Math.round((total / nights) * 100) / 100 : null),
    valor_total: total || (nightly && nights > 0 ? Math.round((nightly * nights) * 100) / 100 : null),
    moeda: 'BRL',
    noites: nights,
    destaques: [],
    diferenciais: '',
    link_reserva: link
  };
}

module.exports = { normalizeImobListing, buildImobBookingLink, priceNumber };
