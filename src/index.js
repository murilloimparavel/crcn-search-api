require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { scrapeCRCN, closeBrowser } = require('./scraper');
const { processAndRankResults } = require('./normalizer');
const { fetchWithDeduplication, clearCache } = require('./cache');
const { calculateDate } = require('./date-calculator');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origem não permitida por CORS.'));
  }
}));
app.use(express.json());

// Validador e normalizador flexível de datas
function parseAndValidateDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const cleanStr = dateStr.trim();

  let year, month, day;

  // 1. Formato ISO: YYYY-MM-DD ou YYYY/MM/DD
  const isoMatch = cleanStr.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoMatch) {
    year = parseInt(isoMatch[1], 10);
    const p2 = parseInt(isoMatch[2], 10);
    const p3 = parseInt(isoMatch[3], 10);

    // Se p2 > 12 e p3 <= 12, foram passados invertidos (YYYY-DD-MM)
    if (p2 > 12 && p3 <= 12) {
      day = p2;
      month = p3;
    } else {
      month = p2;
      day = p3;
    }
  } else {
    // 2. Formato Brasileiro: DD/MM/YYYY ou DD-MM-YYYY ou DD.MM.YYYY
    const brMatch = cleanStr.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (brMatch) {
      day = parseInt(brMatch[1], 10);
      month = parseInt(brMatch[2], 10);
      year = parseInt(brMatch[3], 10);
    } else {
      // 3. Formato sem ano: DD/MM ou DD-MM
      const shortMatch = cleanStr.match(/^(\d{1,2})[-/.](\d{1,2})$/);
      if (shortMatch) {
        day = parseInt(shortMatch[1], 10);
        month = parseInt(shortMatch[2], 10);
        const currentYear = new Date().getFullYear();
        year = currentYear;
      } else {
        return null;
      }
    }
  }

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

  // Formato canônico YYYY-MM-DD
  const formattedStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { year, month, day, dateObj, str: formattedStr };
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

// Resolve expressões relativas de data no fuso de São Paulo para uso por agentes.
app.get('/api/v1/date/calculate', (req, res) => {
  const result = calculateDate(req.query.expression, req.query.reference_date);
  return res.status(result.sucesso ? 200 : 400).json(result);
});

// Limpar cache manual
app.post('/api/v1/cache/clear', (req, res) => {
  const token = process.env.CACHE_CLEAR_TOKEN;
  if (isProduction && !token) {
    return res.status(503).json({ sucesso: false, erro: 'Limpeza manual de cache não configurada.' });
  }
  if (token && req.get('x-cache-clear-token') !== token) {
    return res.status(401).json({ sucesso: false, erro: 'Não autorizado.' });
  }
  clearCache();
  res.json({ success: true, message: 'Cache de pesquisas limpo com sucesso.' });
});

// Endpoint principal de pesquisa
app.get('/api/v1/search', async (req, res) => {
  console.log('[API Incoming Request]', req.method, req.url, 'Query:', JSON.stringify(req.query));
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
      erro: error.code === 'SCRAPER_TIMEOUT'
        ? 'A consulta de disponibilidade excedeu o tempo limite. Tente novamente em instantes.'
        : 'Falha ao consultar disponibilidade na Central de Reservas Caldas.',
      ...(isProduction ? {} : { detalhes: error.message })
    });
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[crcn-search-api] Servidor rodando na porta ${PORT}`);
  console.log(`[crcn-search-api] Healthcheck: http://0.0.0.0:${PORT}/health`);
  console.log(`[crcn-search-api] Busca: http://0.0.0.0:${PORT}/api/v1/search?from=YYYY-MM-DD&to=YYYY-MM-DD&persons=2`);
});

function shutdown(signal) {
  console.log(`[crcn-search-api] ${signal} recebido; encerrando HTTP server.`);
  server.close(async () => {
    await closeBrowser();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
