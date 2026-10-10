const assert = require('node:assert/strict');
const { buildBookingLink, processAndRankResults, normalizeProperty } = require('../src/normalizer');

const link = buildBookingLink({
  apartment: { id: 'LG03J' }, from: '2026-10-06', to: '2026-10-08', persons: 1
});
assert.equal(link, 'https://www.centraldereservascaldas.com.br/pt/apartment/LG03J?from=2026-10-06&to=2026-10-08&persons=1');

const options = processAndRankResults([
  { listing: { id: 'B', bookingPrice: { _mctotal: { BRL: 700 }, mainCurrency: 'BRL' }, _i_maxGuests: 4, amenities: [{ _id: 'pool' }] }, details: { _mstitle: { pt_BR: 'Flat Azul' }, _i_rooms: 2, _i_beds: 3, _f_bathrooms: 1, amenities: [{ _id: 'pool' }] } },
  { listing: { id: 'A', bookingPrice: { _mctotal: { BRL: 500 }, mainCurrency: 'BRL' }, _i_maxGuests: 2 }, details: { _mstitle: { pt_BR: 'Flat Verde' } } }
], { from: '2026-10-06', to: '2026-10-08', persons: 2, nights: 2, amenityCatalog: [{ _id: 'pool', _mstitle: { pt_BR: 'Piscina' } }] });
assert.equal(options.length, 2);
assert.equal(options[0].id, 'A');
assert.equal(options[0].valor_total, 500);
assert.equal(options[0].valor_diaria, 250);
assert.equal(options[1].nome, 'Flat Azul');
assert.equal(options[1].capacidade, 4);
assert.deepEqual(options[1].destaques, ['Piscina']);

const withImages = processAndRankResults([{
  listing: { id: 'IMG', bookingPrice: { _mctotal: { BRL: 500 } } },
  details: {
    _mstitle: { pt_BR: 'Flat com fotos' },
    _t_mainImageMeta: { url: 'https://images.example.test/main.jpg' },
    _t_imagesMeta: [{ url: 'https://images.example.test/main.jpg' }, { url: 'https://images.example.test/room.jpg' }, { url: 'http://insecure.example.test/image.jpg' }]
  }
}], { from: '2026-10-06', to: '2026-10-08', persons: 2, nights: 2 })[0];
assert.equal(withImages.image, 'https://images.example.test/main.jpg');
assert.deepEqual(withImages.images, ['https://images.example.test/main.jpg', 'https://images.example.test/room.jpg']);

const property = normalizeProperty({ id: 'condo-1', _mstitle: { pt_BR: 'Condomínio Central' }, address: { city: 'Caldas Novas' } });
assert.equal(property.nome, 'Condomínio Central');
assert.equal(property.cidade, 'Caldas Novas');

console.log('normalizer: all tests passed');
