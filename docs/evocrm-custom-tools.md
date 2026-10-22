# Custom tools EvoCRM para a Search API

As ferramentas ativas do EvoCRM acessam a Search API por `https://search-api.caldasindica.com`, publicado via Cloudflare e Traefik. O domínio tem `X-Robots-Tag: noindex, nofollow`; isso reduz a indexação por buscadores, mas não é autenticação. A API continua sem exigir token, conforme a decisão operacional da CRCN. O tráfego entre EvoCRM e Search API não depende de uma rede Docker compartilhada.

## Busca por hotel/propriedade

A tool `buscar_propriedade_crcn` recebe o trecho do nome que o cliente mencionou; a Sofia não precisa conhecer previamente os rótulos do catálogo Stays.

- Método: `GET`
- Endpoint: `https://search-api.caldasindica.com/api/v1/properties`
- Parâmetro tipado: `q` (string, obrigatório)
- Limite: até cinco correspondências, com o `property_key` estável e o nome canônico. A resposta também pode incluir os IDs de origem (`stays_id` e `imob_id`) apenas para diagnóstico; a IA deve usar `property_key` na busca de disponibilidade.
- Descrição da tool deve instruir: escolher a opção por `nome`, confirmar se houver ambiguidade e guardar seu `property_key`; nunca passar `stays_id`, `imob_id` ou ID numérico como propriedade.

Para características textuais do condomínio que não têm filtro exato na Stays, a mesma rota aceita `feature=bar molhado` ou `feature=aceita pets`. Enquanto a tool do EvoCRM tiver apenas o parâmetro obrigatório `q`, envie `q="bar molhado"` ou `q="pet"`: a API reconhece esses termos como busca por característica. O resultado inclui até cinco condomínios por página, `property_key`, trecho de evidência e `proxima_pagina`. Descrições faltantes aparecem em `cobertura.properties_not_checked`; não trate essa cobertura parcial como ausência da característica. `Bar` não equivale a `bar molhado`.

Após receber os candidatos, chame `buscar_disponibilidade_crcn` para cada `property_key`, preservando datas e hóspedes. Continue pelos candidatos ou pela próxima página até reunir opções adequadas ou esgotar os candidatos verificados. Apresente apenas acomodações devolvidas pela busca de disponibilidade. Para pets, a descrição do condomínio é uma pista; confirme as regras da unidade antes de dizer que ela aceita animais. A rota de detalhes de unidade existe, mas precisa ser vinculada como tool para essa confirmação automática.

Exemplo: para “Quero um hotel no Eldorado”, chamar a tool com `q="Eldorado"`. Se houver várias correspondências, perguntar qual empreendimento a pessoa prefere. Não escolher uma propriedade aleatoriamente.

## Busca de disponibilidade

A tool `buscar_disponibilidade_crcn` aceita estes campos tipados no `body_params`:

```json
{
  "from": {"type": "string", "required": true, "description": "Check-in exato em YYYY-MM-DD."},
  "to": {"type": "string", "required": true, "description": "Check-out exato em YYYY-MM-DD."},
  "persons": {"type": "integer", "required": true, "description": "Total de adultos e crianças."},
  "property": {"type": "string", "required": false, "description": "property_key interno (ex.: crcn:piazza-diroma) retornado por buscar_propriedade_crcn. Use este valor; não envie stays_id, imob_id, ID numérico de anúncio ou nome."},
  "amenities": {"type": "string", "required": false, "description": "Comodidades do catálogo, separadas por vírgulas."},
  "page": {"type": "integer", "required": false, "description": "Página de resultados. Omita ou use 1 na primeira busca. Para trazer mais opções, envie o valor proxima_pagina da resposta anterior e mantenha datas, hóspedes e filtros."}
}
```

Exemplo: depois de a pessoa escolher uma das propriedades encontradas, enviar o `property_key` retornado em `property`, junto com `from`, `to` e `persons`. O campo `property` é opcional para buscas sem preferência por empreendimento.

Quando o cliente pedir mais opções e `mais_opcoes_disponiveis` for `true`, chame novamente `buscar_disponibilidade_crcn` com `page` incrementado em um. Preserve `from`, `to`, `persons` e os mesmos filtros; não repita opções que já foram mostradas.

O filtro `amenities` é verificado somente na Stays. O Imob não aplica esse filtro, então a API não usa opções do Imob para completar resultados com comodidade. Confira `cobertura_filtros.amenities` e `provedores_consultados.imob`; quando não houver opções na Stays e o Imob estiver marcado `not_queried` com `AMENITY_FILTER_UNSUPPORTED`, não afirme indisponibilidade geral. Pergunte se a pessoa autoriza tentar outras datas; se autorizar, altere apenas as datas e mantenha o condomínio, a comodidade e os demais filtros. Se a propriedade só existir no Imob, a API interrompe a busca com `AMENITY_FILTER_UNSUPPORTED_BY_PROVIDER`; não apresente opções como se a comodidade tivesse sido confirmada.

## Fluxo recomendado para a Sofia

1. Resolva datas relativas com `calcular_data_brt` e confirme o período com o cliente.
2. Se o cliente pedir um hotel específico, chame `buscar_propriedade_crcn` com o nome ou trecho dito pelo cliente.
3. Se vier mais de uma opção, mostre no máximo cinco correspondências e pergunte qual prefere. Guarde o `property_key` da opção escolhida.
4. Chame `buscar_disponibilidade_crcn` com o `property_key` interno da opção escolhida, as datas exatas e a quantidade informada de hóspedes. Não passe `stays_id` nem `imob_id` em `property`.
5. Confira `provedores_consultados`: em propriedades `both`, Stays e Imob precisam estar como `available` ou `no_availability`. Se houver `error`, `not_queried` ou `not_configured`, não afirme indisponibilidade; siga a instrução de cobertura incompleta. Apresente somente acomodações e valores retornados pela API.
6. Se a pessoa pedir outras opções, use `proxima_pagina` na mesma tool, sem pedir novamente as datas ou hóspedes.

## Detalhes de uma acomodação

A rota existente para consulta de um apartamento específico é `GET /api/v1/listings/{id}`. Uma tool `consultar_acomodacao_crcn` pode usar `id` como parâmetro de caminho para recuperar descrição, capacidade, quartos, camas, banheiros, regras, comodidades e imagens.

## Consulta de reserva para o pós-vendas

Configure uma tool somente de leitura para `GET https://search-api.caldasindica.com/api/v1/reservations/{partnerCode}`. O parâmetro `partnerCode` é o código da reserva informado pelo hóspede. A tool deve enviar o cabeçalho secreto `x-reservation-lookup-token`, com valor guardado na configuração segura do EvoCRM e igual a `RESERVATION_LOOKUP_TOKEN` configurado no ambiente da Search API. Não envie esse segredo em query params, no body ou no prompt.

A resposta já apresenta campos normalizados para a IA: situação da reserva, canal, entrada/saída com horários, hóspedes, apartamento, condomínio, descrição, pagamentos e `orientacao_para_ia`. A rota não expõe dados pessoais do titular. Trate HTTP 404 como código não localizado e HTTP 409 como código ambíguo; não tente enumerar códigos. Só prossiga para dados de voucher quando `reserva.status.pode_seguir_para_voucher` for `true` e depois da confirmação dos detalhes pelo hóspede. Pendências ou divergências financeiras devem ser encaminhadas para conferência humana/financeira.

## Registro no EvoCRM

Os registros ativos estão em `evo_core_custom_tools` e nas entradas correspondentes de `evo_core_agents.config.custom_tools.http_tools` do `subagent_reservas_crcn`. A ferramenta de busca de propriedade tem UUID `584dd0b6-a136-4eb8-bfc1-698f7ade0aa1`; a busca de disponibilidade mantém UUID `f25b1f02-9950-4db8-a213-2345678901bc`.

Os quatro endpoints em produção apontam para o domínio HTTPS: `GET /api/v1/date/now`, `POST /api/v1/date/calculate`, `GET /api/v1/properties` e `POST /api/v1/search`.
