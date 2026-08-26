const { scrapeCRCN } = require('../src/scraper');
const { processAndRankResults } = require('../src/normalizer');

async function test() {
  console.log('--- Iniciando Teste de Busca Local (CRCN) ---');
  const from = '2026-09-10';
  const to = '2026-09-12';
  const persons = 2;
  const nights = 2;

  const start = Date.now();
  const raw = await scrapeCRCN(from, to, persons);
  const duration = Date.now() - start;

  console.log(`Extração finalizada em ${duration}ms. Total de itens brutos: ${raw.length}`);

  const processed = processAndRankResults(raw, from, to, nights, persons);
  console.log(`Itens processados e ranqueados: ${processed.length}`);

  console.log('\nTop 3 Melhores Opções para a IA:');
  console.log(JSON.stringify(processed.slice(0, 3), null, 2));

  process.exit(0);
}

test().catch(err => {
  console.error('Erro no teste:', err);
  process.exit(1);
});
