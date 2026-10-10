# Plano de implementação — Assistente Comercial

Objetivo: integrar o painel React do Sofia Central à Search API CRCN, preservando os endpoints atuais usados por agentes e custom tools, com autenticação CRM e credenciais de provedores somente no servidor.

## Sprint 1 — Contrato e segurança da API

- [x] Criar endpoints separados de disponibilidade, reserva e alternativas.
- [x] Validar Bearer com Evo Auth, falhar fechado e limitar a 30 consultas por usuário/minuto.
- [x] Retornar somente campos permitidos da reserva; somar créditos/débitos concluídos e não afirmar pagamento quando a consulta de pagamentos falhar.
- [x] Mapear apenas filtros confirmados; filtrar alternativas por comodidades Stays e rejeitar datas, hóspedes ou filtros fora do contrato.
- [x] Documentar configuração de `EVO_AUTH_SERVICE_URL` e `CORS_ORIGINS`.

Critérios de aceite: token ausente/inválido não acessa provedores; indisponibilidade de Evo Auth retorna 503; dados pessoais e notas internas nunca aparecem na resposta; `/api/v1/search` mantém seu contrato anterior.

## Sprint 2 — Conexão do frontend e microtestes

- [x] Apontar o assistente a `VITE_SEARCH_API_URL` com o cliente Axios autenticado do CRM.
- [x] Configurar injeção do endereço em runtime no container Nginx, sem segredo no bundle.
- [x] Alinhar a UI aos filtros suportados e à ocupação máxima da API.
- [x] Testar autenticação, validação, pagamentos, privacidade, disponibilidade, alternativas, rate limit e compatibilidade do endpoint legado com respostas mockadas.
- [x] Corrigir as vulnerabilidades auditadas nas dependências de produção.
- [x] Adicionar CI para executar testes/auditoria em PR e exigir essa etapa antes da publicação da imagem.

Critérios de aceite: lint dos arquivos tocados e build do frontend passam; `npm test` passa sem chamar provedores; `npm audit --omit=dev` não aponta vulnerabilidades.

## Sprint 3 — Revisão final e preparação de publicação

- [ ] Revisar os diffs completos e as alterações preexistentes do PR #8 sem descartá-las.
- [ ] Abrir PR da Search API a partir de `feat/commercial-assistant-api`; atualizar o PR #8 do frontend e confirmar o contrato direto com a Search API.
- [ ] Validar todos os checks dos dois PRs antes do merge.
- [ ] Confirmar origem, branch, SHA, imagem GHCR imutável, recurso Coolify, variáveis runtime, rede/CORS e rollback.
- [ ] Migrar o Coolify de `STAYS_LOGIN`/`STAYS_PASSWORD` para `STAYS_CLIENT_ID`/`STAYS_CLIENT_SECRET` pelo secret store; rotacionar as credenciais do painel compartilhadas anteriormente.
- [ ] Apresentar o plano exato de publicação e aguardar aprovação explícita antes de merge, push para produção ou deploy.

Critérios de aceite: PR frontend aprovado pelos checks; imagem imutável identificada pelo SHA do commit; variáveis de auth/CORS revisadas sem revelar valores sensíveis; procedimento de rollback preparado.

## Sprint 4 — Deploy da Search API e verificação

- [ ] Fazer merge primeiro da Search API e acompanhar workflow, testes e criação da imagem imutável.
- [ ] Configurar o serviço Coolify com as credenciais oficiais Stays, `EVO_AUTH_SERVICE_URL` e origem CORS `https://crm.caldasindica.com`.
- [ ] Fixar a imagem da Search API pelo SHA no serviço Coolify e implantar pelo endpoint de deploy documentado.
- [ ] Validar `/health`, CORS/preflight, rejeição sem token, rejeição com token inválido e disponibilidade de Evo Auth.
- [ ] Confirmar que a rota legada `/api/v1/search` segue intacta; só então fazer merge do PR #8 e atualizar o container frontend com `VITE_SEARCH_API_URL`.
- [ ] Executar uma busca autenticada de disponibilidade pela UI e confirmar as três classes de resposta no cliente (disponibilidade, reserva e alternativas) com um código de teste autorizado, se disponível.

Critérios de aceite: container saudável, HTTPS ativo, fluxo da UI retorna as três classes de consulta esperadas e não há segredo no bundle/logs; rota IA preservada.

## Sprint 5 — Fechamento operacional

- [ ] Observar logs e saúde após o deploy, sem registrar tokens, códigos de reserva ou PII.
- [ ] Registrar SHA/tag ativa, checks de produção, limitações dos filtros e resultado dos smoke tests.
- [ ] Manter tag anterior e passos de rollback documentados até confirmar estabilidade.

Critérios de aceite: relatório final inclui mudanças, validações, limitações, imagem ativa e rollback verificado; goal só é concluída após todos os critérios de publicação confirmados.
