# CRCN Search API 🏨

Micro-API de busca ao vivo de disponibilidade, flats, diárias, totais e capacidades na Central de Reservas Caldas Novas (https://www.centraldereservascaldas.com.br/).

## Como a cotação é obtida

A API consulta a **Stays External API** com autenticação Basic, usando `POST /booking/search-listings`. O preço oficial vem em `bookingPrice._mctotal`. Para buscas gerais, a Search API avalia até 60 candidatos, paginações de até 20 por chamada, e devolve no máximo três opções diversificadas: prioriza condomínios diferentes e, quando isso não é possível, diferenças de capacidade, quartos, camas e comodidades. A opção mais econômica continua em primeiro lugar; cada opção recebe `tag_sugerida` para orientar a apresentação da Sofia. Em buscas filtradas por propriedade, a diversidade é buscada entre as unidades desse empreendimento.

O endpoint público da Search API continua o mesmo (`POST /api/v1/search`). As credenciais devem ser injetadas pelo ambiente de execução: `STAYS_BASE_URL` (padrão `https://crcn.stays.net/external/v1`), `STAYS_CLIENT_ID` e `STAYS_CLIENT_SECRET`. Login e senha do painel Stays não substituem essas credenciais. Nunca grave segredos em arquivos versionados. `STAYS_REQUEST_TIMEOUT_MS` controla timeout por chamada (padrão 8 s). O resultado é uma cotação atual e deve ser confirmada no link de reserva.

### Fonte complementar Imob

Opcionalmente, configure `IMOB_AUTHORIZATION` com o valor completo do cabeçalho de autorização fornecido para a API Imob (ex.: esquema `Basic`, sem colocar a credencial no código). `IMOB_BASE_URL` é `https://api.cnsp.app/crcn` por padrão e `IMOB_REQUEST_TIMEOUT_MS` controla o timeout. Sem essa variável, a API continua operando somente com Stays.

A Stays é consultada primeiro. Se a quantidade de opções elegíveis for menor que `max_results`, a API consulta o Imob para preencher o limite. A consulta ao Imob não envia `maxOcupantes`: o endpoint interpreta esse campo como capacidade da unidade, não como tamanho do grupo. A Search API filtra o inventário recebido para capacidades entre o número de hóspedes e esse número mais duas vagas (`IMOB_MAX_EXTRA_OCCUPANTS`, padrão 2). Se essa faixa não tiver opções, amplia a busca para unidades maiores que acomodem o grupo e instrui a Sofia a informar a capacidade e confirmar se o cliente aceita. Opções Imob são convertidas para os mesmos campos das opções Stays e preservam o `linkParceiro`.

O catálogo público da CRCN (`https://reservascrcn.com.br/condominio/{id}`) fornece os nomes canônicos e IDs numéricos de condomínio usados no filtro `condominio` do Imob. A busca aceita nomes exatos, parciais e pequenas variações de escrita quando há uma correspondência única; o ID resolvido é enviado ao Imob e o nome canônico do catálogo é devolvido no campo `condominio`. Consultas parciais que possam corresponder a mais de um condomínio não escolhem um ID arbitrariamente.

### Identidade interna e sincronização de condomínios

`data/property-catalog.json` mantém uma identidade CRCN estável (`property_key`) e os IDs independentes de cada provedor. O catálogo inicial reúne os condomínios do portal Imob e as propriedades da Stays observadas em 15/10/2026. A API só traduz um ID Stays para um ID Imob quando o registro está marcado `verified_exact_name`, `verified_normalized_name` ou `verified_manual`; sugestões fuzzy ficam como `pending_review` e nunca alteram o filtro de disponibilidade.

Para conferir alterações sem gravá-las, execute `npm run catalog:sync`. Para aplicar uma sincronização após revisar o resumo, execute `npm run catalog:sync -- --apply`. O processo busca o catálogo público do Imob e `/booking/searchfilter` da Stays, preserva identidades existentes, registra novos condomínios, marca IDs que deixaram de aparecer e grava `data/property-catalog-sync-report.json`. Ele interrompe sem gravar se uma origem falhar, retornar catálogo vazio/inesperadamente reduzido ou apresentar IDs duplicados. As credenciais Stays ficam no ambiente (`STAYS_CLIENT_ID`/`STAYS_CLIENT_SECRET`) e nunca são gravadas no JSON.

A rotina está preparada para rodar diariamente no GitHub Actions e abrir/atualizar um PR quando o catálogo mudar. Configure os secrets `STAYS_CLIENT_ID` e `STAYS_CLIENT_SECRET` no repositório; `STAYS_BASE_URL` é opcional. Novos pares com nome exato e único ou normalização segura do numeral romano I/II podem ser vinculados automaticamente; associações fuzzy/ambíguas aparecem em `pending_matches` e exigem revisão antes de mudar o `match_status` para `verified_manual`, registrando também a justificativa em `review`. No snapshot de 15/10/2026, foram conferidos 37 IDs Imob e 26 propriedades Stays: 20 pares foram verificados, 6 propriedades Stays ficaram sem vínculo confirmado e 17 condomínios aparecem apenas no Imob. Esse fluxo não cria um banco SQL remoto: o JSON versionado é a base interna auditável e a saída pode migrar para PostgreSQL depois, sem mudar os IDs internos.

O retorno de `listOrcamento` pode não conter preço. Nessa situação, a API usa a chamada de cotação pública observada no próprio site para obter o valor de PIX e preencher `valor_total`/`valor_diaria`; não estima nem inventa preço. `IMOB_PUBLIC_BASE_URL` e `IMOB_PRICE_CANDIDATE_LIMIT` configuram essa etapa. O cache de preço PIX dura 60 segundos por padrão (`IMOB_PRICE_CACHE_TTL_MS`). Se a cotação do site falhar, o preço permanece `null` e o erro é registrado sem interromper opções Stays.

Cada busca de disponibilidade consulta dados atuais dos provedores; resultados de disponibilidade não ficam em cache persistente. Chamadas idênticas simultâneas ainda são deduplicadas enquanto estão em andamento. Falhas transitórias do Imob (timeout, rede, HTTP 408/425/429/5xx, resposta inválida ou erro de aplicação não classificado) recebem até duas tentativas no total, configuráveis por `IMOB_SEARCH_MAX_ATTEMPTS` (máximo 3) e `IMOB_RETRY_DELAY_MS`. Eventos `provider.request`, `provider.success` e `provider.failure` registram request ID, tentativa, duração, status e categoria sem registrar credenciais; mensagens curtas da origem são sanitizadas.

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

O filtro `amenities` é aplicado somente na Stays; o endpoint de disponibilidade do Imob não permite confirmar comodidades. Por isso, a API não usa opções do Imob para completar uma busca filtrada por comodidade. A resposta informa `cobertura_filtros.amenities`; se a Stays não encontrar opções e o Imob seria uma fonte aplicável, a instrução pede autorização para tentar outras datas, mantendo condomínio, comodidade e demais filtros. Para uma propriedade disponível somente no Imob, a busca com comodidade é interrompida com `AMENITY_FILTER_UNSUPPORTED_BY_PROVIDER`.

A resposta de `/api/v1/search` inclui até três opções com `tag_sugerida`, `nome`, `condominio`, `valor_total`, `valor_diaria`, `noites`, `capacidade`, quartos, camas, banheiros, destaques/comodidades e `link_reserva`. `page` é opcional e começa em `1`; quando `mais_opcoes_disponiveis` for `true`, solicite a próxima página incrementando `page` e mantenha datas, hóspedes e filtros.

Quando o Imob rejeitar a estadia por quantidade mínima de noites, a API identifica o mínimo, consulta novamente mantendo check-in e hóspedes e devolve as opções em `alternativa_estadia_minima`, com período, quantidade de noites e instrução para o agente explicar a alternativa e confirmar se o cliente aceita. Essas opções ficam separadas de `opcoes`, que continuam vinculadas ao período original solicitado.

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
