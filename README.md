# CRCN Search API 🏨

Micro-API de busca ao vivo de disponibilidade, flats, diárias, totais e capacidades na Central de Reservas Caldas Novas (https://www.centraldereservascaldas.com.br/).

## Como a cotação é obtida

A API usa o mesmo fluxo HTTP público do frontend Stays: cria uma sessão anônima, lê a lista JSON de apartamentos e consulta `helpers._correctApartPrice` para cada opção retornada. `valor_total` vem do campo oficial `_t_mctotal.BRL`; ele não é calculado a partir de texto do HTML.

O resultado é uma consulta atual, sujeita à confirmação no link de reserva. A API mantém cache por três minutos para reduzir chamadas repetidas.

## Endpoints

### 1. Healthcheck
GET /health

### 2. Busca de Disponibilidade
GET /api/v1/search?from=YYYY-MM-DD&to=YYYY-MM-DD&persons=2&max_results=10

Para integrações e agentes de IA, envie sempre datas concretas no formato canônico `YYYY-MM-DD`, sem texto explicativo dentro dos parâmetros:

```text
/api/v1/search?from=2026-09-05&to=2026-09-07&persons=4
```

Quando a API receber formato inválido, ela retorna HTTP `400` com `codigo`, `parametro`, `valor_recebido`, `formato_aceito` e um exemplo utilizável. Os logs registram cada consulta com `request_id`, resultado da validação, cache, duração e total de opções retornadas.

### 3. Calculadora de Datas (BRT)
GET /api/v1/date/calculate?expression=proxima%20sexta-feira

Resolve expressões relativas no fuso `America/Sao_Paulo`. Aceita `hoje`, `amanhã`, `depois de amanhã`, `próxima semana`, `este fim de semana`, `próxima sexta-feira` e `em N dias`. Use `reference_date=YYYY-MM-DD` apenas para testes determinísticos.

### 4. Limpeza de Cache
POST /api/v1/cache/clear
