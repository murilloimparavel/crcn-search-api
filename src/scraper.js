const puppeteer = require('puppeteer');
const fs = require('fs');

let browserInstance = null;

async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  const launchOptions = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-extensions'
    ]
  };

  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  } else if (process.platform === 'darwin') {
    const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (fs.existsSync(macChrome)) {
      launchOptions.executablePath = macChrome;
    }
  }

  browserInstance = await puppeteer.launch(launchOptions);
  return browserInstance;
}

async function scrapeCRCN(from, to, persons = 2) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Bloquear apenas mídias e analytics pesados para não quebrar scripts da Stays
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      const url = req.url();

      if (
        ['image', 'media', 'font'].includes(resourceType) ||
        url.includes('google-analytics') ||
        url.includes('googletagmanager') ||
        url.includes('facebook') ||
        url.includes('doubleclick')
      ) {
        req.abort();
      } else {
        req.continue();
      }
    });

    const searchUrl = `https://www.centraldereservascaldas.com.br/pt/search?from=${from}&to=${to}&persons=${persons}`;
    console.log(`[Scraper] Buscando: ${searchUrl}`);

    await page.goto(searchUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Aguardar até que os cards de apartamentos com preço estejam no DOM
    try {
      await page.waitForFunction(
        () => {
          const text = document.body.innerText || '';
          return text.includes('por noite') || text.includes('Nenhum imóvel disponível') || text.includes('Imóveis disponíveis');
        },
        { timeout: 10000 }
      );
    } catch (waitErr) {
      console.warn('[Scraper] Timeout aguardando renderização completa, extraindo dados disponíveis...');
    }

    // Pequena pausa para garantir que o DOM finalizou as mutações do jQuery/RequireJS
    await new Promise(r => setTimeout(r, 1500));

    const rawApartments = await page.evaluate(() => {
      // Buscar todos os links de apartamentos
      const links = Array.from(document.querySelectorAll('a[href*="/apartment/"]'));
      const seen = new Set();
      const results = [];

      for (const link of links) {
        const href = link.href;
        if (!href || seen.has(href)) continue;

        // Pegar o container do card
        const card = link.closest('.appThumb, .col-xs-12, .col-sm-6, .col-md-4, [class*="col-"]');
        const text = card ? card.innerText : link.innerText;

        if (text && text.includes('R$')) {
          seen.add(href);
          const dataId = card ? card.getAttribute('data-id') : null;
          results.push({
            id: dataId,
            link: href,
            text: text
          });
        }
      }

      return results;
    });

    return rawApartments;
  } finally {
    await page.close().catch(() => {});
  }
}

process.on('exit', async () => {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
  }
});

module.exports = {
  scrapeCRCN
};
