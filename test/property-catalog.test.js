const assert = require('node:assert/strict');
const { PropertyCatalog, normalizeLookupKey } = require('../src/property-catalog');

async function testPropertyCatalog() {
  const mockStays = {
    searchProperties: async (query) => {
      if (/thermas/i.test(query)) {
        return [{ _id: 'STAYS-TP-1', id: 'TP01', _mstitle: { pt_BR: 'Thermas Place' }, address: { city: 'Caldas Novas' } }];
      }
      return [];
    },
    getSearchFilters: async () => ({
      properties: [
        { _id: 'STAYS-TP-1', id: 'TP01', _mstitle: { pt_BR: 'Thermas Place' } }
      ],
      amenities: []
    }),
    getProperty: async (id) => ({
      _id: id,
      _mstitle: { pt_BR: 'Thermas Place' },
      _msdesc: { pt_BR: 'Condomínio Thermas Place com 7 piscinas termais e sauna.' },
      address: { city: 'Caldas Novas', region: 'Turista 1' },
      amenities: ['Piscina aquecida (Compartilhada)', 'Sauna']
    })
  };

  const catalog = new PropertyCatalog({ staysClient: mockStays });

  // 1. Testa busca de propriedade que está no Stays
  const staysResults = await catalog.searchProperties('Thermas');
  assert.equal(staysResults.length, 1);
  assert.equal(staysResults[0].nome, 'Thermas Place');
  assert.equal(staysResults[0].provedor, 'stays');
  assert.match(staysResults[0].descricao, /7 piscinas termais/);

  // 2. Testa busca de propriedade exclusiva do Imob (ex: Golden Dolphin)
  const imobResults = await catalog.searchProperties('Golden Dolphin');
  assert.ok(imobResults.length >= 1);
  assert.equal(imobResults[0].nome, 'Golden Dolphin Supreme');
  assert.equal(imobResults[0].provedor, 'imob');
  assert.equal(imobResults[0].cidade, 'Caldas Novas');
  assert.ok(imobResults[0].comodidades.length > 0);

  // 3. Testa resolução de propriedade por nome
  const resolvedGolden = await catalog.resolvePropertyFilter('Golden Dolphin Supreme');
  assert.equal(resolvedGolden.type, 'imob_only');
  assert.equal(resolvedGolden.imobId, '135');

  const resolvedThermas = await catalog.resolvePropertyFilter('Thermas Place');
  assert.equal(resolvedThermas.type, 'stays_only');
  assert.equal(resolvedThermas.staysId, 'STAYS-TP-1');

  // 4. Testa resolução por ID numérico puro (Imob)
  const resolvedNumeric = await catalog.resolvePropertyFilter('135');
  assert.equal(resolvedNumeric.type, 'imob_only');
  assert.equal(resolvedNumeric.imobId, '135');

  // 5. Normalização de chave
  assert.equal(normalizeLookupKey('CRCN - Eldorado Thermas Park!'), 'crcn eldorado thermas park');

  console.log('property-catalog: all tests passed');
}

testPropertyCatalog().catch((err) => {
  console.error(err);
  process.exit(1);
});
