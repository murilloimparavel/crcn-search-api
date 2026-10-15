#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env'), override: false });
const { StaysClient } = require('../src/stays-client');
const { PROPERTY_CATALOG_PATH } = require('../src/property-catalog');
const { createImobCatalogFetcher, normalizeStaysProperty, reconcileCatalog } = require('../src/property-identity');

const ROOT = path.join(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'data', 'property-catalog-sync-report.json');
const apply = process.argv.includes('--apply');

async function writeJsonAtomically(filePath, value) {
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temporaryPath, filePath);
}

async function main() {
  const fetchImob = createImobCatalogFetcher({ baseUrl: process.env.IMOB_PUBLIC_BASE_URL || 'https://reservascrcn.com.br' });
  const staysClient = new StaysClient();
  const [imob, staysPayload, catalogText] = await Promise.all([
    fetchImob(),
    staysClient.getSearchFilters(),
    fs.readFile(PROPERTY_CATALOG_PATH, 'utf8').catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
  ]);
  const stays = (Array.isArray(staysPayload?.properties) ? staysPayload.properties : []).map(normalizeStaysProperty).filter(Boolean);
  if (!stays.length) throw new Error('A Stays não retornou propriedades reconhecíveis; catálogo não alterado.');
  const existing = catalogText ? JSON.parse(catalogText) : {
    schema_version: 1,
    description: 'Identidades internas CRCN com IDs e proveniência por provedor.',
    properties: [],
    last_sync: null
  };
  const previousImobCount = existing.properties.filter((item) => item.sources?.imob?.status === 'active').length;
  const previousStaysCount = existing.properties.filter((item) => item.sources?.stays?.status === 'active').length;
  const minimumImobCount = Math.max(20, Math.ceil(previousImobCount * 0.95));
  const minimumStaysCount = Math.max(10, Math.ceil(previousStaysCount * 0.95));
  if (imob.length < minimumImobCount) throw new Error(`Catálogo Imob incompleto (${imob.length}; mínimo seguro ${minimumImobCount}); catálogo não alterado.`);
  if (stays.length < minimumStaysCount) throw new Error(`Catálogo Stays incompleto (${stays.length}; mínimo seguro ${minimumStaysCount}); catálogo não alterado.`);
  const { catalog, report } = reconcileCatalog(existing, { imob, stays });
  await fs.mkdir(path.dirname(PROPERTY_CATALOG_PATH), { recursive: true });
  await writeJsonAtomically(REPORT_PATH, report);
  if (apply) await writeJsonAtomically(PROPERTY_CATALOG_PATH, catalog);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', catalog_path: PROPERTY_CATALOG_PATH, report_path: REPORT_PATH, report }, null, 2));
  if (!apply) console.log('Simulação: use --apply para gravar o catálogo reconciliado.');
}

main().catch((error) => {
  console.error(`Falha ao sincronizar catálogo de propriedades: ${error.message}`);
  process.exitCode = 1;
});
