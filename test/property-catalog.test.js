const assert = require('node:assert/strict');
const { PropertyCatalog, normalizeLookupKey } = require('../src/property-catalog');

async function testPropertyCatalog() {
  const mockStays = {
    searchProperties: async (query) => {
      if (/thermas/i.test(query)) {
        return [{ _id: '6a3560da78b17e1b6cffee9b', id: 'LI15J', _mstitle: { pt_BR: 'CRCN - Thermas Place' }, address: { city: 'Caldas Novas' } }];
      }
      if (/piazza/i.test(query)) {
        return [{ _id: '6a3499da086cdffd520549e8', id: 'LH23J', _mstitle: { pt_BR: 'CRCN - Piazza diRoma' }, address: { city: 'Caldas Novas' } }];
      }
      if (/golden dolphin grand/i.test(query)) {
        return [{ _id: '6a343986e8b091c491d6591d', id: 'GDGH', _mstitle: { pt_BR: 'CRCN - Golden Dolphin Grand Hotel' }, address: { city: 'Caldas Novas' } }];
      }
      if (/diroma internacional/i.test(query)) {
        return [{ _id: '6a735481250ea6a4196062dc', id: 'ND03J', _mstitle: { pt_BR: 'CRCN - DiRoma Internacional Resorts' }, address: { city: 'Caldas Novas' } }];
      }
      return [];
    },
    getSearchFilters: async () => ({
      properties: [
        { _id: '6a3560da78b17e1b6cffee9b', id: 'LI15J', _mstitle: { pt_BR: 'CRCN - Thermas Place' } },
        { _id: '6a3499da086cdffd520549e8', id: 'LH23J', _mstitle: { pt_BR: 'CRCN - Piazza diRoma' } },
        { _id: '6a343986e8b091c491d6591d', id: 'GDGH', _mstitle: { pt_BR: 'CRCN - Golden Dolphin Grand Hotel' } },
        { _id: '6a735481250ea6a4196062dc', id: 'ND03J', _mstitle: { pt_BR: 'CRCN - DiRoma Internacional Resorts' } }
      ],
      amenities: []
    }),
    getProperty: async (id) => id === '6a3499da086cdffd520549e8'
      ? {
          _id: id,
          id: 'LH23J',
          _mstitle: { pt_BR: 'CRCN - Piazza diRoma' },
          _msdesc: { pt_BR: 'Condomínio Piazza diRoma.' },
          address: { city: 'Caldas Novas', region: 'Solar de Caldas' },
          amenities: []
        }
      : id === '6a343986e8b091c491d6591d'
        ? { _id: id, id: 'GDGH', _mstitle: { pt_BR: 'CRCN - Golden Dolphin Grand Hotel' }, address: { city: 'Caldas Novas' } }
        : id === '6a735481250ea6a4196062dc'
          ? { _id: id, id: 'ND03J', _mstitle: { pt_BR: 'CRCN - DiRoma Internacional Resorts' }, address: { city: 'Caldas Novas' } }
        : {
          _id: id,
          _mstitle: { pt_BR: 'Thermas Place' },
          _msdesc: { pt_BR: 'Condomínio Thermas Place com 7 piscinas termais e sauna.' },
          address: { city: 'Caldas Novas', region: 'Turista 1' },
          amenities: ['Piscina aquecida (Compartilhada)', 'Sauna']
        }
  };

  const catalog = new PropertyCatalog({ staysClient: mockStays });

  // 1. Testa busca de propriedade que está no Stays
  const staysResults = await catalog.searchProperties('Thermas');
  const thermasOption = staysResults.find((item) => item.stays_id === '6a3560da78b17e1b6cffee9b');
  assert.ok(thermasOption);
  assert.equal(thermasOption.nome, 'THERMAS PLACE');
  assert.equal(thermasOption.provedor, 'both');
  assert.match(thermasOption.descricao, /7 piscinas termais/);

  // 2. Testa busca de propriedade exclusiva do Imob (ex: Golden Dolphin)
  const imobResults = await catalog.searchProperties('Golden Dolphin');
  assert.ok(imobResults.length >= 1);
  const goldenSupreme = imobResults.find((item) => item.imob_id === 91);
  assert.ok(goldenSupreme);
  assert.equal(goldenSupreme.nome, 'GOLDEN DOLPHIN SUPREME');
  assert.equal(goldenSupreme.provedor, 'imob');
  assert.equal(goldenSupreme.cidade, 'Caldas Novas');
  assert.ok(goldenSupreme.comodidades.length > 0);

  // 3. Testa resolução de propriedade por nome
  const resolvedGolden = await catalog.resolvePropertyFilter('Golden Dolphin Supreme');
  assert.equal(resolvedGolden.type, 'imob_only');
  assert.equal(resolvedGolden.imobId, '91');

  const resolvedThermas = await catalog.resolvePropertyFilter('Thermas Place');
  assert.equal(resolvedThermas.type, 'hybrid');
  assert.equal(resolvedThermas.staysId, '6a3560da78b17e1b6cffee9b');
  assert.equal(resolvedThermas.imobId, '94');

  // 3b. O alias do catálogo Stays deve resolver ao condomínio canônico no Imob.
  const piazzaResults = await catalog.searchProperties('Piazza diRoma');
  assert.equal(piazzaResults.length, 1);
  assert.equal(piazzaResults[0].nome, 'PIAZZA DIROMA');
  assert.equal(piazzaResults[0].stays_id, '6a3499da086cdffd520549e8');
  assert.equal(piazzaResults[0].imob_id, 84);
  assert.equal(piazzaResults[0].provedor, 'both');
  assert.equal(piazzaResults[0].property_key, 'crcn:piazza-diroma');
  assert.equal(piazzaResults[0].mapping_status, 'verified_exact_name');

  const resolvedPiazzaAlias = await catalog.resolvePropertyFilter('LH23J');
  assert.equal(resolvedPiazzaAlias.type, 'hybrid');
  assert.equal(resolvedPiazzaAlias.staysId, '6a3499da086cdffd520549e8');
  assert.equal(resolvedPiazzaAlias.imobId, '84');
  assert.equal(resolvedPiazzaAlias.propertyKey, 'crcn:piazza-diroma');

  const goldenGrand = await catalog.resolvePropertyFilter('Golden Dolphin Grand Hotel');
  assert.equal(goldenGrand.type, 'hybrid');
  assert.equal(goldenGrand.imobId, '89');

  // Não envia uma variante possivelmente relacionada ao Imob até revisão explícita.
  const diromaInternational = await catalog.resolvePropertyFilter('DiRoma Internacional Resorts');
  assert.equal(diromaInternational.type, 'stays_only');
  assert.equal(diromaInternational.imobId, null);
  assert.equal(diromaInternational.propertyKey, 'crcn:diroma-internacional-resorts');

  // 4. Testa resolução por ID numérico puro (Imob)
  const resolvedNumeric = await catalog.resolvePropertyFilter('135');
  assert.equal(resolvedNumeric.type, 'imob_only');
  assert.equal(resolvedNumeric.imobId, '135');

  // 5. Normalização de chave e score de similaridade
  assert.equal(normalizeLookupKey('CRCN - Eldorado Thermas Park!'), 'crcn eldorado thermas park');
  const { calculateMatchScore } = require('../src/property-catalog');
  assert.ok(calculateMatchScore('Golden Dolphin Supreme', 'Golden Dolphin Supreme') > 0.9);
  assert.ok(calculateMatchScore('Golden Dolphin Supreme', 'Golden Dolphin Grand Hotel') < 0.6); // Diferencia hotéis distintos
  assert.ok(calculateMatchScore('Thermas Place', 'Thermas Place Flat') > 0.6);

  console.log('property-catalog: all tests passed');
}

testPropertyCatalog().catch((err) => {
  console.error(err);
  process.exit(1);
});
