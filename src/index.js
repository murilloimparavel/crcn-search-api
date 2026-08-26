require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { scrapeCRCN } = require('./scraper');
const { processAndRankResults } = require('./normalizer');
const { fetchWithDeduplication, clearCache } = require('./cache');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Validador estrito de data YYYY-MM-DD
function parseAndValidateDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  const dateObj = new Date(Date.UTC(year, month - 1, day));
  if (
    dateObj.getUTCFullYear() !== year ||
    dateObj.getUTCMonth() !== month - 1 ||
    dateObj.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day, dateObj, str: dateStr };
}

// Obter hoje 00:00:00 UTC
function getTodayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

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

  // 1. Validação de presença
  if (!from || !to) {
    return res.status(400).json({
      sucesso: false,
      erro: 'Parâmetros "from" e "to" são obrigatórios no formato YYYY-MM-DD.'
    });
  }

  // 2. Validação estrita de calendário
  const validFrom = parseAndValidateDate(from);
  const validTo = parseAndValidateDate(to);

  if (!validFrom || !validTo) {
    return res.status(400).json({
      sucesso: false,
      erro: 'Data inválida no calendário. Use o formato YYYY-MM-DD (ex: 2026-09-10).'
    });
  }

  // 3. Validação de data no passado
  const todayUTC = getTodayUTC();
  if (validFrom.dateObj < todayUTC) {
    return res.status(400).json({
      sucesso: false,
      erro: 'A data de check-in (from) não pode ser anterior à data de hoje.'
    });
  }

  // 4. Validação de período
  const diffTime = validTo.dateObj.getTime() - validFrom.dateObj.getTime();
  const nights = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (nights <= 0) {
    return res.status(400).json({
      sucesso: false,
      erro: 'A data de check-out (to) deve ser posterior à data de check-in (from) em pelo menos 1 noite.'
    });
  }

  if (nights > 60) {
    return res.status(400).json({
      sucesso: false,
      erro: 'O período máximo permitido para pesquisa online é de 60 noites.'
    });
  }

  // 5. Validação de hóspedes
  const numPersons = parseInt(persons, 10);
  if (isNaN(numPersons) || numPersons < 1 || numPersons > 30) {
    return res.status(400).json({
      sucesso: false,
      erro: 'O parâmetro "persons" deve ser um número inteiro entre 1 e 30 hóspedes.'
    });
  }

  const limitResults = Math.min(Math.max(parseInt(max_results, 10) || 10, 1), 50);

  try {
    const startTime = Date.now();

    // 6. Busca com cache e prevenção de Cache Stampede (Thundering Herd)
    const { data: responseData, isHit } = await fetchWithDeduplication(
      validFrom.str,
      validTo.str,
      numPersons,
      async () => {
        // Scraper real no site da CRCN
        const rawApartments = await scrapeCRCN(validFrom.str, validTo.str, numPersons);
        
        // Normalização e ranqueamento
        const allOptions = processAndRankResults(rawApartments, validFrom.str, validTo.str, nights, numPersons);

        return {
          sucesso: true,
          total_encontrados: allOptions.length,
          periodo: {
            check_in: validFrom.str,
            check_out: validTo.str,
            noites: nights,
            hospedes: numPersons
          },
          opcoes: allOptions
        };
      }
    );

    // Ajustar opções conforme limitResults solicitado e tempo de resposta
    const finalOptions = responseData.opcoes.slice(0, limitResults);
    
    res.setHeader('X-Cache', isHit ? 'HIT' : 'MISS');
    return res.json({
      ...responseData,
      tempo_resposta_ms: isHit ? 5 : (Date.now() - startTime),
      opcoes: finalOptions
    });
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
