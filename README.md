# CRCN Search API 🏨

Micro-API de busca ao vivo de disponibilidade, flats, diárias e capacidades na Central de Reservas Caldas Novas (https://www.centraldereservascaldas.com.br/).

## Endpoints

### 1. Healthcheck
GET /health

### 2. Busca de Disponibilidade
GET /api/v1/search?from=YYYY-MM-DD&to=YYYY-MM-DD&persons=2&max_results=10

### 3. Limpeza de Cache
POST /api/v1/cache/clear
