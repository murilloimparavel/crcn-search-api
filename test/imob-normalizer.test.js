const assert = require('node:assert/strict');
const { normalizeImobListing, buildImobBookingLink, imageUrls, priceNumber } = require('../src/imob-normalizer');
const { selectDiverseListings } = require('../src/normalizer');

const criteria = { from: '2026-10-16', to: '2026-10-19', persons: 8, nights: 3 };
const raw = {
  id: 1086,
  unidade: 'B0802',
  nomeCond: 'Golden Dolphin Supreme',
  quartos: 3,
  maxOcupantes: 8,
  valorTotal: 'R$ 1.130,00',
  fotos: [{ url: 'https://images.example.test/imob.jpg' }],
  linkParceiro: 'https://reservascrcn.com.br/parceiro/1/1086?16-10-2026,19-10-2026?s1,,'
};
const option = normalizeImobListing(raw, criteria);
assert.equal(option.id, '1086');
assert.equal(option.nome, 'B0802');
assert.equal(option.condominio, 'Golden Dolphin Supreme');
assert.equal(option.capacidade, 8);
assert.equal(option.valor_total, 1130);
assert.equal(option.valor_diaria, 376.67);
assert.equal(option.link_reserva, raw.linkParceiro);
assert.equal(option.image, 'https://images.example.test/imob.jpg');
assert.deepEqual(option.images, ['https://images.example.test/imob.jpg']);
assert.deepEqual(imageUrls({
  fotoPrincipal: { original: { src: '//cdn.example.test/main.jpg' } },
  imagens: [{ url: 'https://cdn.example.test/room.jpg' }, { url: 'http://insecure.example.test/blocked.jpg' }]
}), ['https://cdn.example.test/main.jpg', 'https://cdn.example.test/room.jpg']);
assert.deepEqual(Object.keys(option), [
  'id', 'nome', 'condominio', 'cidade', 'quartos', 'camas', 'banheiros', 'capacidade',
  'valor_diaria', 'valor_total', 'moeda', 'noites', 'destaques', 'diferenciais', 'image', 'images', 'link_reserva'
]);

const noPrice = normalizeImobListing({ id: 9, nomeCond: 'Everest', titulo: 'Apto 2' }, criteria);
assert.equal(noPrice.valor_total, null);
assert.equal(noPrice.valor_diaria, null);
assert.match(noPrice.link_reserva, /reservascrcn\.com\.br\/parceiro\/1\/9/);
const noBookingLink = normalizeImobListing({ unidade: 'B0802', titulo: 'Flat B0802' }, criteria);
assert.equal(noBookingLink.link_reserva, null);
assert.equal(noBookingLink.id, 'B0802');
assert.equal(priceNumber('1.250,50'), 1250.5);
assert.equal(buildImobBookingLink({ id: 10 }, criteria), 'https://reservascrcn.com.br/parceiro/1/10?16-10-2026,19-10-2026?s8,,');

const diverse = selectDiverseListings([
  { id: 'a', condominio: 'Lagoa Quente', valor_total: 500, capacidade: 4, quartos: 1 },
  { id: 'b', condominio: 'Lagoa Quente', valor_total: 800, capacidade: 6, quartos: 2 },
  { id: 'c', condominio: 'Everest', valor_total: 600, capacidade: 4, quartos: 1 }
], 3);
assert.equal(diverse.length, 3);
assert.equal(diverse[1].id, 'c');

const priceAlternatives = selectDiverseListings([
  { id: 'budget', condominio: 'Mesmo condomínio', valor_total: 500, capacidade: 4, quartos: 1 },
  { id: 'similar', condominio: 'Mesmo condomínio', valor_total: 510, capacidade: 4, quartos: 1 },
  { id: 'premium', condominio: 'Mesmo condomínio', valor_total: 900, capacidade: 4, quartos: 1 }
], 3, { preferDifferentProperties: false });
assert.equal(priceAlternatives[0].id, 'budget');
assert.equal(priceAlternatives[1].id, 'premium');

console.log('imob-normalizer: all tests passed');
