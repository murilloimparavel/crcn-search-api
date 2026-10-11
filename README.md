# CRCN Search API 🏨

Micro-API de busca ao vivo de disponibilidade, flats, diárias, totais e capacidades na Central de Reservas Caldas Novas (https://www.centraldereservascaldas.com.br/).

## Como a cotação é obtida

A API consulta a **Stays External API** com autenticação Basic, usando `POST /booking/search-listings`. O preço oficial vem em `bookingPrice._mctotal`. Para buscas gerais, a Search API avalia até 60 candidatos, paginações de até 20 por chamada, e devolve no máximo três opções diversificadas: prioriza condomínios diferentes e, quando isso não é possível, diferenças de capacidade, quartos, camas e comodidades. A opção mais econômica continua em primeiro lugar; cada opção recebe `tag_sugerida` para orientar a apresentação da Sofia. Em buscas filtradas por propriedade, a diversidade é buscada entre as unidades desse empreendimento.

O endpoint público da Search API continua o mesmo (`POST /api/v1/search`). As credenciais da External API devem ser injetadas pelo ambiente de execução: `STAYS_BASE_URL` (padrão `https://crcn.stays.net/external/v1`), `STAYS_CLIENT_ID` e `STAYS_CLIENT_SECRET`. Login e senha do painel Stays não substituem essas credenciais. Nunca grave segredos em arquivos versionados. `STAYS_REQUEST_TIMEOUT_MS` controla timeout por chamada (padrão 8 s). O resultado é uma cotação atual e deve ser confirmada no link de reserva.

### Fonte complementar Imob

Opcionalmente, configure `IMOB_AUTHORIZATION` com o valor completo do cabeçalho de autorização fornecido para a API Imob (ex.: esquema `Basic`, sem colocar a credencial no código). `IMOB_BASE_URL` é `https://api.cnsp.app/crcn` por padrão e `IMOB_REQUEST_TIMEOUT_MS` controla o timeout. Sem essa variável, a API continua operando somente com Stays.

A Stays é consultada primeiro. Se a quantidade de opções elegíveis for menor que `max_results`, a API consulta o Imob para preencher o limite. Em uma busca ampla o Imob pede uma opção por condomínio; numa busca de condomínio, o proxy usa os nomes encontrados nos resultados disponíveis para resolver o ID do Imob e repete a consulta filtrada. Opções Imob são convertidas para os mesmos campos das opções Stays e preservam o `linkParceiro`.

O retorno de `listOrcamento` pode não conter preço. Nessa situação, a API usa a chamada de cotação pública observada no próprio site para obter o valor de PIX e preencher `valor_total`/`valor_diaria`; não estima nem inventa preço. `IMOB_PUBLIC_BASE_URL` e `IMOB_PRICE_CANDIDATE_LIMIT` configuram essa etapa. Se a cotação do site falhar, o preço permanece `null` e o erro é registrado sem interromper opções Stays.

Para executar localmente, copie `.env.example` para `.env`, preencha as credenciais localmente e use `npm ci && npm start`. O arquivo `.env` é ignorado pelo Git. O teste de integração `npm test` inicia um servidor temporário em loopback e usa respostas simuladas; não consulta a VPS nem cria reservas.

Detalhes da API e limitações observadas: [`docs/stays-external-api.md`](./docs/stays-external-api.md).

## Endpoints

### 1. Healthcheck
GET /health

### 2. Busca de Disponibilidade
POST /api/v1/search

Para integrações e agentes de IA, envie sempre datas concretas no formato canônico `YYYY-MM-DD`, sem texto explicativo dentro dos parâmetros:

```text
{"from":"2026-09-05","to":"2026-09-07","persons":4,"page":1}
```

Opcionalmente, a busca aceita filtros `amenities`/`comodidades`, `inventory`/`inventario`, `properties`/`propriedades`, `cities`/`cidades` e `rooms`/`quartos`. Valores de texto são resolvidos pelo catálogo da conta Stays.

A resposta de `/api/v1/search` inclui até três opções com `tag_sugerida`, `nome`, `condominio`, `valor_total`, `valor_diaria`, `noites`, `capacidade`, quartos, camas, banheiros, destaques/comodidades e `link_reserva`. `page` é opcional e começa em `1`; quando `mais_opcoes_disponiveis` for `true`, solicite a próxima página incrementando `page` e mantenha datas, hóspedes e filtros.

### Ferramentas complementares de leitura

- `GET /api/v1/searchfilters`: catálogo de comodidades, propriedades, cidades, quartos e inventário.
- `GET /api/v1/properties?q=Thermas`: pesquisa empreendimentos pelo nome.
- `GET /api/v1/listings/{id}`: detalhes, regras, comodidades e imagens de um anúncio.

### Consulta de reserva pelo código da plataforma

- `GET /api/v1/reservations/{partnerCode}` busca a reserva pelo código informado na plataforma e devolve uma estrutura amigável para IA com status da reserva, canal, datas/horários, quantidade de hóspedes, nomes do apartamento/condomínio, descrição do imóvel e situação de pagamento.
- A rota consulta a reserva, os pagamentos e o imóvel no Stays. Não devolve nome/telefone do titular, documentos, endereço, dados de cartão, notas internas, comissão ou IDs internos.
- Configure `RESERVATION_LOOKUP_TOKEN` no ambiente da API. Envie o mesmo segredo no cabeçalho `x-reservation-lookup-token`; a rota responde `503` se o token não estiver configurado e `401` se estiver ausente/incorreto. Configure esse cabeçalho na custom tool do EvoCRM.
- O status de pagamento separa total da reserva, total pago informado nas estatísticas e créditos concluídos/pendentes. A rota só sinaliza `pago` quando créditos concluídos cobrem o total e não há créditos pendentes; divergências permanecem explícitas e não liberam o fluxo do voucher.
- `reserva.status.pode_seguir_para_voucher` só é `true` quando a reserva está `booked`, o pagamento é comprovadamente `pago` e os dados necessários da hospedagem estão completos. Para demais estados, divergências ou dados incompletos, siga `orientacao_para_ia` e encaminhe para conferência humana/financeira.
- Códigos não encontrados respondem HTTP `404` com `encontrada: false`; códigos ambíguos respondem HTTP `409` sem revelar registros.

Exemplo de chamada:

```http
GET /api/v1/reservations/ABC123
x-reservation-lookup-token: <segredo-configurado-no-servidor-e-na-tool>
```

O segredo não deve ser incluído em prompts, parâmetros de query, logs ou respostas ao hóspede. A decisão atual de manter as demais rotas públicas não remove a autenticação obrigatória desta rota de consulta de reserva.

`buscar_propriedade_crcn` já está cadastrada para chamar `/api/v1/properties` antes da busca de disponibilidade por hotel. As rotas de catálogo geral (`/api/v1/searchfilters`) e detalhes de anúncio (`/api/v1/listings/{id}`) ainda não estão cadastradas como custom tools. Veja os contratos e o fluxo em [`docs/evocrm-custom-tools.md`](./docs/evocrm-custom-tools.md).

Quando a API receber formato inválido, ela retorna HTTP `400` com `codigo`, `parametro`, `valor_recebido`, `formato_aceito` e um exemplo utilizável. Os logs registram cada consulta com `request_id`, resultado da validação, cache, duração e total de opções retornadas.

### 3. Calculadora de Datas (BRT)
GET /api/v1/date/calculate?expression=proxima%20sexta-feira

Resolve expressões relativas no fuso `America/Sao_Paulo`. Aceita `hoje`, `amanhã`, `depois de amanhã`, `próxima semana`, `este fim de semana`, `próxima sexta-feira` e `em N dias`. Use `reference_date=YYYY-MM-DD` apenas para testes determinísticos.

### 4. Limpeza de Cache
POST /api/v1/cache/clear

### 5. Consultas do Assistente Comercial do CRM

As rotas abaixo são separadas do contrato público usado pelos agentes em `/api/v1/search`. O frontend envia o Bearer de sessão do CRM; a Search API valida esse token via `POST {EVO_AUTH_SERVICE_URL}/api/v1/auth/validate`. Sem URL configurada ou quando Evo Auth não responde, as rotas falham fechadas. Configure também `CORS_ORIGINS` com a origem exata do CRM e `EVO_AUTH_SERVICE_URL` com um endereço de rede alcançável pelo container da Search API. Não configure credenciais de provedor no frontend.

- `POST /api/v1/commercial-assistant/availability`: `{ from, to, adults, children, source: "stays" | "imobsys", inventory?, filters? }`. Stays recebe o total de hóspedes e filtro de inventário; Imob recebe total, condomínio opcional e `umCada`.
- `POST /api/v1/commercial-assistant/reservation`: `{ reservationCode }`. Consulta Stays e devolve uma lista permitida de campos; pagamentos pendentes não contam como pagos e débitos completados reduzem o total pago.
- `POST /api/v1/commercial-assistant/alternative`: `{ reservationCode, amenity? }`. Usa período/hóspedes da reserva, filtra pela comodidade Stays indicada e exclui a unidade atual.

Todas as rotas exigem token válido do CRM. Não registram código da reserva, token, nomes de hóspedes, notas internas ou payload bruto do provedor. A API Imob atual não filtra id individual, unidade, quartos, check-in/out flexível, piscina ou bebidas; esses filtros não fazem parte da interface até existir contrato documentado. Idades de crianças são informadas na tela, mas os provedores recebem somente o total de hóspedes.
