# Stays External API — documentação de referência

Fonte oficial: <https://stays.net/external-api/>
Escopo: documentação pública disponível em 2026-09-24. Este arquivo resume e indexa a referência oficial para apoiar a integração da CRCN Search API; não é uma cópia byte a byte do site.

## Acesso e autenticação

- A documentação diz que as credenciais (`client_id`, `client_secret`) devem ser solicitadas ao suporte Stays.
- A autenticação documentada usa HTTP Basic com `base64(client_id:client_secret)` e `Content-Type: application/json`.
- A documentação informa que cada conta tem documentação Swagger em `/external/v1/docs/` no domínio real daquela conta. O Swagger específico da conta CRCN ainda precisa ser obtido por canal autorizado.
- Os snippets públicos contêm um valor Basic de demonstração repetido. Esse valor foi deliberadamente omitido daqui.
- Usar o domínio real da conta Stays (a documentação usa `play.stays.net` como exemplo), não assumir que o host de exemplo é o host de produção CRCN.

## Integração de disponibilidade da CRCN

O fluxo candidato para substituir o scraping do site público, preservando o contrato atual do EvoCRM (`/api/v1/search`), é:

1. `GET /external/v1/booking/searchfilter` — retorna valores de filtro usados também pela busca do frontend Stays.
2. `POST /external/v1/booking/search-listings` — encontra listings reserváveis no período; recebe `from`, `to`, `guests` e filtros opcionais. Suporta `skip` e `limit`, com máximo documentado de 20 por página.
3. `POST /external/v1/booking/calculate-price` — calcula preço detalhado por listing e período; aceita identificador curto ou longo, datas e hóspedes; resposta inclui `_mctotal`, moeda principal, taxas e indicador `feesIncluded`.

Mapeamento inicial de contrato:

| CRCN Search API | Stays External API |
| --- | --- |
| `from` | `from` (`YYYY-MM-DD`) |
| `to` | `to` (`YYYY-MM-DD`) |
| `persons` | `guests` |
| opção/listing | `id` curto ou `_id` longo; confirmar qual enviar no `listingIds` |
| preço total | `_mctotal.BRL` em `calculate-price` |
| capacidade | `_i_maxGuests` em resultados de listings |
| limite/paginação | `limit` (máximo 20), `skip` |

Pontos a validar com credenciais e Swagger da conta CRCN:

- host de produção, autorização habilitada e permissões do usuário API;
- filtros para limitar a busca aos imóveis/propriedades da CRCN e cidade de Caldas Novas;
- se `search-listings` já filtra disponibilidade e capacidade de modo suficiente;
- semântica de `listingIds` (códigos curtos versus IDs internos) e limites por lote;
- preço final, taxas, política de cancelamento, restrições e mínimo de noites;
- como produzir o link de reserva direta usado hoje pelo bot;
- paginação para catálogo com mais de 20 resultados;
- limites de taxa, timeouts, erros e comportamento de indisponibilidade.

## Catálogo de endpoints observados na referência pública

Todos os caminhos abaixo são relativos a `/external/v1`. Os métodos e paths são transcritos do site; parâmetros completos devem ser conferidos no Swagger da conta. Operações `POST`, `PATCH` e `DELETE` podem alterar dados. Esta lista é inventário documental, não autorização para executá-las.

### Checkout

| Método | Path | Finalidade |
| --- | --- | --- |
| POST | `/book-request` | Verifica possibilidade de reserva e devolve URL para finalizar checkout |

### Booking

| Método | Path | Finalidade |
| --- | --- | --- |
| GET | `/booking/searchfilter` | Valores disponíveis para montar filtros |
| POST | `/booking/search-listings` | Busca acomodações reserváveis |
| POST | `/booking/calculate-price` | Calcula preço para listings e período |
| POST | `/booking/reservations` | Cria bloqueio ou reserva |
| PATCH | `/booking/reservations/{reservationId}` | Modifica reserva/bloqueio |
| DELETE | `/booking/reservations/{reservationId}` | Exclui reserva/bloqueio |
| POST | `/booking/reservations/{reservationId}/...` | Operações de extras e pagamentos; confirmar os paths completos no Swagger |
| GET | `/booking/reservations/{reservationId}` | Consulta reserva |
| GET | `/booking/reservations/active` | Busca reservas ativas |
| GET | `/booking/reservations/report` | Relatório (XLSX/JSON, conforme operação) |
| GET | `/booking/reservations/{reservationId}/payments` | Consulta pagamentos da reserva |
| POST/PATCH/DELETE | `/booking/reservations/{reservationId}/payments` | Cria, modifica ou exclui pagamento de reserva |
| GET/POST/PATCH/DELETE | `/booking/extra-services...` | Catálogo e serviços extras de reserva |
| GET/POST/PATCH | `/booking/clients...` | Consulta e gestão de clientes |

### Promo codes

| Método | Path | Finalidade |
| --- | --- | --- |
| POST | `/booking/promo-codes` | Cria código promocional |
| GET | `/booking/promo-codes/{_id}` | Consulta código |
| PATCH | `/booking/promo-codes/{_id}` | Modifica código |
| DELETE | `/booking/promo-codes/{_id}` | Exclui código |
| GET | `/booking/promo-codes` | Pesquisa códigos |

### Finance

- `/finance/payment-providers`: operações de criação, consulta, alteração e listagem.
- `/finance/owners`: consulta de titulares/responsáveis financeiros; a referência lista variantes por ID e listing.

### Listing calendar

- `/calendar/listing-calendar`: consulta de calendário.
- `/calendar/listing-calendar`: atualização de calendário.
- `/calendar/rates`: atualização de tarifas.
- `/calendar/restrictions`: atualização de restrições.

### Prices

- `/parr/price-regions`: consulta, criação, alteração e exclusão de regiões de preço.
- `/parr/seasons-sell`: consulta, criação, alteração e exclusão de regras de preço de temporada.
- `/parr/listing-rates-sell`: consulta de tarifas de listing e alteração de tarifa.

### Content

- `/content/properties`: criar, consultar, atualizar e listar propriedades.
- `/content/listings`: criar, consultar, atualizar e listar anúncios/listings.
- `/content/groups`: criar, consultar, atualizar, excluir e listar grupos.
- `/content/rooms`: consulta e operações de criação, atualização e exclusão de cômodos.
- `/content/images`: upload de imagem.
- `/content/clone-groups` e `/content/clone-groups/{id}/items`: gestão de grupos clonados e itens.
- `/content/price-groups` e `/content/price-groups/{id}/items`: gestão de grupos de preço e itens.

### Settings

- `/settings/global/listing-custom-fields`: consulta e gestão de campos globais.
- `/settings/app/listing-custom-fields`: consulta e gestão de campos customizados por app.
- `/settings/listing/...`: configurações de venda, reserva e regras do listing.

### Translation / dicionários

Rotas `GET /translation/...` documentadas para tipos de propriedade/listing/cômodo/quarto/banheiro/cama, comodidades, inventário, unidades de medida, bairros e serviços extras. A referência inclui `searchString` opcional em várias dessas rotas.

### Webhooks

A Stays documenta notificações de reserva, calendário, região de preço, temporada, clientes, promo codes, listings e tarifas de listing. Para habilitar, o texto orienta contatar o suporte e fornecer uma URL receptora. A confirmação esperada é JSON `{ "succeed": true }`; são mencionadas até três tentativas. Os cabeçalhos descritos são `x-stays-client-id` e `x-stays-signature`; o suporte deve fornecer a chave pública necessária para verificar assinatura.

## Integração local em implementação

O código local mantém `/api/v1/search` compatível com a custom tool atual do EvoCRM e usa `POST /booking/search-listings` na API oficial. Ele lê preço de `bookingPrice._mctotal`, avalia até 60 candidatos em páginas de no máximo 20, seleciona até três opções diversificadas e enriquece somente as escolhidas com detalhes e comodidades. Em busca ampla, prioriza propriedades/condomínios ainda não representados; se não houver diversidade de propriedades no conjunto avaliado, compara capacidade, quartos, camas e comodidades. Em busca filtrada por propriedade, compara unidades do mesmo empreendimento. A opção de menor preço fica em primeiro lugar, e `tag_sugerida` descreve o perfil de cada alternativa. O tamanho do conjunto pode ser ajustado por `STAYS_SEARCH_CANDIDATE_LIMIT` (mínimo 20, máximo 120). A integração requer `STAYS_BASE_URL`, `STAYS_LOGIN` e `STAYS_PASSWORD` no ambiente de execução.

Rotas locais adicionais preparadas para futuras custom tools de leitura:

- `GET /api/v1/searchfilters` — catálogos normalizados de propriedades, comodidades, inventário, cidades, regiões, quartos e hóspedes.
- `GET /api/v1/properties?q=...` — pesquisa de propriedades e detalhes resumidos.
- `GET /api/v1/listings/{id}` — capacidade, descrição, regras, comodidades e imagens de um anúncio.

Essas novas rotas não estão cadastradas como custom tools no EvoCRM. A custom tool de busca existente ainda aceita somente `from`, `to` e `persons`; filtros opcionais ou chamadas a detalhes exigem atualizar/cadastrar tools no CRM. Nenhum endpoint de criação de reserva ou checkout é chamado pela implementação de leitura.

## Fonte e limitações

- Referência: <https://stays.net/external-api/> (acessada em 2026-09-24).
- O site público contém cerca de 9.389 linhas renderizadas, mas o navegador de pesquisa não fornece um download integral bruto.
- A documentação específica da conta, indicada em `/external/v1/docs/`, requer o domínio e acesso autorizados da CRCN. As chamadas autenticadas de leitura a `searchfilter`, `search-listings` e `content/listings/{id}` foram verificadas separadamente; o Swagger da conta ainda não foi coletado.
- Alguns paths no site têm nomes inconsistentes entre exemplos e tabelas. Usar o Swagger da conta como fonte final antes de implementar.
