# CRCN Search API 🏨

Micro-API de busca ao vivo de disponibilidade, flats, diárias e capacidades na Central de Reservas Caldas Novas (https://www.centraldereservascaldas.com.br/).

## Endpoints

### 1. Healthcheck
GET /health

### 2. Busca de Disponibilidade
GET /api/v1/search?from=YYYY-MM-DD&to=YYYY-MM-DD&persons=2&max_results=10

### 3. Calculadora de Datas (BRT)
GET /api/v1/date/calculate?expression=proxima%20sexta-feira

Resolve expressões relativas no fuso `America/Sao_Paulo`. Aceita `hoje`, `amanhã`, `depois de amanhã`, `próxima semana`, `este fim de semana`, `próxima sexta-feira` e `em N dias`. Use `reference_date=YYYY-MM-DD` apenas para testes determinísticos.

### 4. Limpeza de Cache
POST /api/v1/cache/clear
