const assert = require('node:assert/strict');
const { buildBookingLink, slugify } = require('../src/normalizer');

assert.equal(slugify('Aquarius Flat - Apto D 704'), 'aquarius-flat-apto-d-704');
assert.equal(
  buildBookingLink({
    apartment: { id: 'LG03J', avatar: 'Aquarius Flat - Apto D 704' },
    from: '2026-09-08',
    to: '2026-09-11',
    persons: 3,
    title: 'CRCN - Aquarius Flat'
  }),
  'https://www.centraldereservascaldas.com.br/pt/apartment/LG03J/aquarius-flat-apto-d-704?from=2026-09-08&to=2026-09-11&persons=3'
);

console.log('normalizer: all tests passed');
