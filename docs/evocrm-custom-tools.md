# Custom tools EvoCRM para a Search API

As tools ativas do `subagent_reservas_crcn` usam a rede interna do Docker. A busca de disponibilidade continua em `POST /api/v1/search` e retorna até três acomodações normalizadas.

## Busca por hotel/propriedade

A tool `buscar_propriedade_crcn` recebe o trecho do nome que o cliente mencionou; a Sofia não precisa conhecer previamente os rótulos do catálogo Stays.

- Método: `GET`
- Endpoint: `http://search_api-dwixf32tdj4e7pa04zniwmsk:3000/api/v1/properties`
- Parâmetro tipado: `q` (string, obrigatório)
- Limite: até cinco correspondências, com nome e ID do catálogo.

Exemplo: para “Quero um hotel no Eldorado”, chamar a tool com `q="Eldorado"`. Se houver várias correspondências, perguntar qual empreendimento a pessoa prefere. Não escolher uma propriedade aleatoriamente.

## Busca de disponibilidade

A tool `buscar_disponibilidade_crcn` aceita estes campos tipados no `body_params`:

```json
{
  "from": {"type": "string", "required": true, "description": "Check-in exato em YYYY-MM-DD."},
  "to": {"type": "string", "required": true, "description": "Check-out exato em YYYY-MM-DD."},
  "persons": {"type": "integer", "required": true, "description": "Total de adultos e crianças."},
  "property": {"type": "string", "required": false, "description": "ID retornado por buscar_propriedade_crcn ou nome exato do catálogo."},
  "amenities": {"type": "string", "required": false, "description": "Comodidades do catálogo, separadas por vírgulas."},
  "page": {"type": "integer", "required": false, "description": "Página de resultados. Omita ou use 1 na primeira busca. Para trazer mais opções, envie o valor proxima_pagina da resposta anterior e mantenha datas, hóspedes e filtros."}
}
```

Exemplo: depois de a pessoa escolher uma das propriedades encontradas, enviar o ID retornado em `property`, junto com `from`, `to` e `persons`. O campo `property` é opcional para buscas sem preferência por empreendimento.

Quando o cliente pedir mais opções e `mais_opcoes_disponiveis` for `true`, chame novamente `buscar_disponibilidade_crcn` com `page` incrementado em um. Preserve `from`, `to`, `persons` e os mesmos filtros; não repita opções que já foram mostradas.

## Fluxo recomendado para a Sofia

1. Resolva datas relativas com `calcular_data_brt` e confirme o período com o cliente.
2. Se o cliente pedir um hotel específico, chame `buscar_propriedade_crcn` com o nome ou trecho dito pelo cliente.
3. Se vier mais de uma opção, mostre no máximo cinco correspondências e pergunte qual prefere. Se vier uma opção clara, use o ID dela.
4. Chame `buscar_disponibilidade_crcn` com o ID escolhido, as datas exatas e a quantidade informada de hóspedes.
5. Apresente somente as acomodações e valores retornados pela API.
6. Se a pessoa pedir outras opções, use `proxima_pagina` na mesma tool, sem pedir novamente as datas ou hóspedes.

## Detalhes de uma acomodação

A rota existente para consulta de um apartamento específico é `GET /api/v1/listings/{id}`. Uma tool `consultar_acomodacao_crcn` pode usar `id` como parâmetro de caminho para recuperar descrição, capacidade, quartos, camas, banheiros, regras, comodidades e imagens.

## Consulta de reserva para o pós-vendas

Configure uma tool somente de leitura para `GET https://search-api.caldasindica.com/api/v1/reservations/{partnerCode}`. O parâmetro `partnerCode` é o código da reserva informado pelo hóspede. A tool deve enviar o cabeçalho secreto `x-reservation-lookup-token`, com valor guardado na configuração segura do EvoCRM e igual a `RESERVATION_LOOKUP_TOKEN` configurado no ambiente da Search API. Não envie esse segredo em query params, no body ou no prompt.

A resposta já apresenta campos normalizados para a IA: situação da reserva, canal, entrada/saída com horários, hóspedes, apartamento, condomínio, descrição, pagamentos e `orientacao_para_ia`. A rota não expõe dados pessoais do titular. Trate HTTP 404 como código não localizado e HTTP 409 como código ambíguo; não tente enumerar códigos. Só prossiga para dados de voucher quando `reserva.status.pode_seguir_para_voucher` for `true` e depois da confirmação dos detalhes pelo hóspede. Pendências ou divergências financeiras devem ser encaminhadas para conferência humana/financeira.

## Registro no EvoCRM

Os registros ativos estão em `evo_core_custom_tools` e nas entradas correspondentes de `evo_core_agents.config.custom_tools.http_tools` do `subagent_reservas_crcn`. A ferramenta de busca de propriedade tem UUID `584dd0b6-a136-4eb8-bfc1-698f7ade0aa1`; a busca de disponibilidade mantém UUID `f25b1f02-9950-4db8-a213-2345678901bc`.
