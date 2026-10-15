const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  internalKey, normalizeName, normalizeComparableName, normalizeStaysProperty, reconcileCatalog, validateCatalog, validateSourceSnapshots, createImobCatalogFetcher
} = require('../src/property-identity');

async function main() {
  assert.equal(internalKey('CRCN - Piazza diRoma'), 'crcn:piazza-diroma');
  assert.equal(normalizeName('PRIVÉ DAS THERMAS II'), 'prive das thermas ii');
  assert.equal(normalizeComparableName('PRIVÉ DAS THERMAS II'), normalizeComparableName('PRIVE DAS THERMAS 2'));
  assert.deepEqual(normalizeStaysProperty({ _id: 'stays-1', _mstitle: { pt_BR: 'CRCN - Piazza diRoma' } }), {
    id: 'stays-1', alternate_ids: [], name: 'CRCN - Piazza diRoma', alternate_names: []
  });
  const boulevard = normalizeStaysProperty({
    _id: 'stays-boulevard',
    _mstitle: { pt_BR: 'CRCN - Boulevard Súite' },
    internalName: 'CRCN - Boulevard Súite Hotel'
  });
  assert.deepEqual(boulevard.alternate_names, ['CRCN - Boulevard Súite Hotel']);
  const fetchImobCatalog = createImobCatalogFetcher({
    baseUrl: 'https://reservascrcn.test',
    fetchImpl: async () => ({ ok: true, text: async () => '<a href="/condominio/84">PIAZZA DIROMA</a><a href="/condominio/102">PRIVE DAS THERMAS 2</a>' })
  });
  assert.deepEqual(await fetchImobCatalog(), [
    { id: 84, name: 'PIAZZA DIROMA' },
    { id: 102, name: 'PRIVE DAS THERMAS 2' }
  ]);
  assert.throws(() => validateSourceSnapshots({ imob: [{ id: 84, name: 'Piazza' }, { id: 84, name: 'Other' }], stays: [] }), /ID duplicado/);
  assert.throws(() => validateSourceSnapshots({ imob: [], stays: [{ id: 'one', alternate_ids: ['shared'], name: 'A' }, { id: 'two', alternate_ids: ['shared'], name: 'B' }] }), /alias duplicado/);
  await assert.rejects(createImobCatalogFetcher({
    baseUrl: 'https://reservascrcn.test',
    fetchImpl: async () => ({ ok: true, text: async () => '<html>layout inesperado</html>' })
  })(), /não continha condomínios reconhecidos/);

  const initial = { schema_version: 1, properties: [], last_sync: null };
  const synced = reconcileCatalog(initial, {
    imob: [
      { id: 16, name: 'BOULEVARD SUITE HOTEL' }, { id: 84, name: 'PIAZZA DIROMA' },
      { id: 102, name: 'PRIVE DAS THERMAS 2' }, { id: 89, name: 'GOLDEN DOLPHIN G HOTEL' },
      { id: 91, name: 'GOLDEN DOLPHIN SUPREME' }
    ],
    stays: [
      boulevard,
      { id: 'LH23J', name: 'CRCN - Piazza diRoma' },
      { id: 'LH25J', name: 'CRCN - Privé das Thermas II' },
      { id: 'LH14J', name: 'CRCN - Golden Dolphin Grand Hotel' },
      { id: 'NEW01', name: 'Novo Condomínio' }
    ],
    syncedAt: '2026-10-15T00:00:00.000Z'
  });
  const piazza = synced.catalog.properties.find((item) => item.property_key === 'crcn:piazza-diroma');
  assert.equal(piazza.sources.imob.id, 84);
  assert.equal(piazza.sources.stays.id, 'LH23J');
  assert.deepEqual(piazza.sources.stays.alternate_ids, []);
  assert.equal(piazza.match_status, 'verified_exact_name');
  const linkedBoulevard = synced.catalog.properties.find((item) => item.sources?.stays?.id === 'stays-boulevard');
  assert.equal(linkedBoulevard.sources.imob.id, 16);
  assert.equal(linkedBoulevard.sources.stays.matched_name, 'CRCN - Boulevard Súite Hotel');

  const prive = synced.catalog.properties.find((item) => item.sources?.stays?.id === 'LH25J');
  assert.equal(prive.sources.imob.id, 102);
  assert.equal(prive.match_status, 'verified_normalized_name');

  // A fuzzy or semantically ambiguous pair is not promoted automatically.
  const grand = synced.catalog.properties.find((item) => item.sources?.stays?.id === 'LH14J');
  assert.equal(grand.sources.imob, null);
  assert.equal(grand.match_status, 'pending_review');
  assert.ok(synced.report.pending.some((item) => item.id === 'LH14J'));

  const repeatedSync = reconcileCatalog(synced.catalog, {
    imob: [
      { id: 16, name: 'BOULEVARD SUITE HOTEL' }, { id: 84, name: 'PIAZZA DIROMA' },
      { id: 102, name: 'PRIVE DAS THERMAS 2' }, { id: 89, name: 'GOLDEN DOLPHIN G HOTEL' },
      { id: 91, name: 'GOLDEN DOLPHIN SUPREME' }
    ],
    stays: [
      boulevard,
      { id: 'LH23J', name: 'CRCN - Piazza diRoma' },
      { id: 'LH25J', name: 'CRCN - Privé das Thermas II' },
      { id: 'LH14J', name: 'CRCN - Golden Dolphin Grand Hotel' },
      { id: 'NEW01', name: 'Novo Condomínio' }
    ]
  });
  assert.equal(repeatedSync.catalog.properties.find((item) => item.sources?.stays?.id === 'LH14J').match_status, 'pending_review');
  assert.ok(repeatedSync.report.pending.some((item) => item.id === 'LH14J'));
  assert.equal(repeatedSync.catalog.properties.find((item) => item.sources?.stays?.id === 'stays-boulevard').sources.stays.matched_name, 'CRCN - Boulevard Súite Hotel');

  const duplicateImob = structuredClone(synced.catalog);
  duplicateImob.properties.find((item) => item.sources?.imob?.id === 16).sources.imob.id = 84;
  assert.throws(() => validateCatalog(duplicateImob), /ID Imob duplicado/);
  const duplicateKey = structuredClone(synced.catalog);
  duplicateKey.properties[1].property_key = duplicateKey.properties[0].property_key;
  assert.throws(() => validateCatalog(duplicateKey), /property_key duplicada/);

  const staysFirst = reconcileCatalog({ schema_version: 1, properties: [], last_sync: null }, {
    imob: [], stays: [{ id: 'LATE-ID', name: 'Novo Condominio Exato' }]
  });
  const imobLater = reconcileCatalog(staysFirst.catalog, {
    imob: [{ id: 777, name: 'NOVO CONDOMINIO EXATO' }],
    stays: [{ id: 'LATE-ID', name: 'Novo Condominio Exato' }]
  });
  const lateLinked = imobLater.catalog.properties.find((item) => item.sources?.stays?.id === 'LATE-ID');
  assert.equal(lateLinked.sources.imob.id, 777);
  assert.equal(lateLinked.match_status, 'verified_exact_name');

  const removed = reconcileCatalog(synced.catalog, {
    imob: [{ id: 84, name: 'PIAZZA DIROMA' }],
    stays: [{ id: 'LH23J', name: 'CRCN - Piazza diRoma' }]
  });
  assert.equal(removed.catalog.properties.find((item) => item.sources?.imob?.id === 102).sources.imob.status, 'not_seen');

  const storedCatalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/property-catalog.json'), 'utf8'));
  validateCatalog(storedCatalog);
  const imobCount = storedCatalog.properties.filter((item) => item.sources?.imob?.id != null).length;
  const staysCount = storedCatalog.properties.filter((item) => item.sources?.stays?.id != null).length;
  assert.ok(imobCount >= 37);
  assert.ok(staysCount >= 26);
  const expectedLinks = new Map([
    ['LH23J', '84'], ['LH25J', '102'], ['LG04J', '16'], ['LG15J', '12'],
    ['LH14J', '89'], ['LG01J', '74'], ['OB01J', '90']
  ]);
  for (const [staysAlias, imobId] of expectedLinks) {
    const row = storedCatalog.properties.find((item) => item.sources?.stays?.alternate_ids?.includes(staysAlias));
    assert.equal(String(row?.sources?.imob?.id), imobId, `missing verified mapping ${staysAlias} -> ${imobId}`);
    assert.ok(row.match_status.startsWith('verified'));
  }
  console.log('property-identity: reconciliation, stable IDs, pending matches, duplicate guards and removals passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
