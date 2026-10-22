const assert = require('node:assert/strict');
const { resolveFeature, evidenceForFeature } = require('../src/property-feature-search');
const { PropertyCatalog } = require('../src/property-catalog');

async function main() {
  assert.equal(resolveFeature('bar molhado'), 'bar_molhado');
  assert.equal(resolveFeature('Bar'), null);
  assert.equal(resolveFeature('aceita pets'), 'aceita_pets');
  assert.match(evidenceForFeature('Piscinas com bar molhado.', 'bar_molhado'), /bar molhado/);
  assert.equal(evidenceForFeature('Não possui bar molhado.', 'bar_molhado'), null);
  assert.equal(evidenceForFeature('Sem bar molhado.', 'bar_molhado'), null);
  assert.equal(evidenceForFeature('Bar molhado em reforma.', 'bar_molhado'), null);
  assert.match(evidenceForFeature('Não possui sauna, mas tem bar molhado.', 'bar_molhado'), /bar molhado/);
  assert.match(evidenceForFeature('Não possui sauna mas tem bar molhado.', 'bar_molhado'), /bar molhado/);
  assert.equal(evidenceForFeature('Possui bar e piscinas.', 'bar_molhado'), null);
  assert.match(evidenceForFeature('✓ Permite animais de pequeno porte.', 'aceita_pets'), /pequeno porte/);
  assert.equal(evidenceForFeature('✗ Não permite animais no imóvel.', 'aceita_pets'), null);

  let detailCalls = 0;
  const catalog = new PropertyCatalog({
    staysClient: {
      getProperty: async (id) => {
        detailCalls += 1;
        return { _msdesc: { pt_BR: id === 'B' ? 'Não possui bar molhado. Não permite animais.' : 'Piscina com bar molhado. Permite pets.' } };
      }
    },
    imobCatalog: [
      { id: 1, nome: 'IMOB COM BAR', descricao: 'Piscina com bar molhado.', comodidades: [] },
      { id: 2, nome: 'VINCULO PENDENTE', descricao: 'Piscina com bar molhado.', comodidades: [] }
    ],
    identityCatalog: { properties: [
      { property_key: 'crcn:com-bar', canonical_name: 'COM BAR', status: 'active', sources: { stays: { id: 'A', status: 'active' } } },
      { property_key: 'crcn:sem-bar', canonical_name: 'SEM BAR', status: 'active', sources: { stays: { id: 'B', status: 'active' } } },
      { property_key: 'crcn:imob-bar', canonical_name: 'IMOB COM BAR', status: 'active', sources: { imob: { id: 1, status: 'active' } } },
      { property_key: 'crcn:pending', canonical_name: 'VINCULO PENDENTE', status: 'active', match_status: 'pending_review', sources: { stays: { id: 'C', status: 'active' }, imob: { id: 2, status: 'active' } } }
    ] }
  });
  const first = await catalog.searchPropertiesByFeature('bar molhado');
  assert.equal(first.total, 2);
  assert.equal(first.properties[0].property_key, 'crcn:com-bar');
  assert.equal(first.properties[1].provedor, 'imob');
  assert.equal(first.coverage.descriptions_available, 4);
  assert.equal(first.coverage.complete, true);
  assert.deepEqual(first.coverage.properties_not_searchable, ['crcn:pending']);
  const pets = await catalog.searchPropertiesByFeature('pet');
  assert.equal(pets.total, 1);
  assert.equal(pets.properties[0].requer_confirmacao_unidade, true);
  assert.equal(detailCalls, 3, 'consecutive feature searches share the description snapshot');
  console.log('property-feature-search: all tests passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
