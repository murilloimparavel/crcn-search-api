require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { scrapeCRCN } = require('./scraper');
const { processAndRankResults } = require('./normalizer');
const { getCachedSearch, setCachedSearch, clearCache } = require('./cache');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Healthcheck
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'crcn-search-api',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Limpar cache manual
app.post('/api/v1/cache/clear', (req, res) => {
  clearCache();
  res.json({ success: true, message: 'Cache de pesquisas limpo com sucesso.' });
});

// Endpoint principal de pesquisa
app.get('/api/v1/search', async (req, res) => {
  const { from, to, persons = 2, max_results = 10 } = req.query;

  // Validação básica de parâmetros
  if (!from || !to) {
    return res.status(400).json({
      sucesso: false,
      erro: 'Parâmetros "from" e "to" são obrigatórios no formato YYYY-MM-DD.'
    });
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(from) || !dateRegex.test(to)) {
    return res.status(400).json({
      sucesso: false,
      erro: 'Formato de data inválido. Use YYYY-MM-DD (ex: 2026-09-10).'
    });
  }

  const startDate = new Date(from);
  const endDate = new Date(to);
  const diffTime = endDate.getTime() - startDate.getTime();
  const nights = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (nights <= 0) {
    return res.status(400).json({
      sucesso: false,
      erro: 'A data de check-out (to) deve ser posterior à data de check-in (from).'
    });
  }

  const numPersons = parseInt(persons, 10) || 2;
  const limitResults = parseInt(max_results, 10) || 10;

  // 1. Verificar Cache
  const cached = getCachedSearch(from, to, numPersons);
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached);
  }

  try {
    const startTime = Date.now();
    
    // 2. Extrair do site da CRCN
    const rawApartments = await scrapeCRCN(from, to, numPersons);
    
    // 3. Normalizar e ranquear opções
    const allOptions = processAndRankResults(rawApartments, from, to, nights, numPersons);
    const selectedOptions = allOptions.slice(0, limitResults);

    const responsePayload = {
      sucesso: true,
      total_encontrados: allOptions.length,
      periodo: {
        check_in: from,
        check_out: to,
        noites: nights,
        hospedes: numPersons
      },
      tempo_resposta_ms: Date.now() - startTime,
      opcoes: selectedOptions
    };

    // 4. Salvar no cache
    setCachedSearch(from, to, numPersons, responsePayload);

    res.setHeader('X-Cache', 'MISS');
    res.json(responsePayload);
  } catch (error) {
    console.error('[API Error]', error);
    res.status(500).json({
      sucesso: false,
      erro: 'Falha ao consultar disponibilidade na Central de Reservas Caldas.',
      detalhes: error.message
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[crcn-search-api] Servidor rodando na porta ${PORT}`);
  console.log(`[crcn-search-api] Healthcheck: http://0.0.0.0:${PORT}/health`);
  console.log(`[crcn-search-api] Busca: http://0.0.0.0:${PORT}/api/v1/search?from=YYYY-MM-DD&to=YYYY-MM-DD&persons=2`);
});
