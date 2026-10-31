# Prompt de implementação: Setup Wizard e Engine Manager sem aplicativos Desktop

## Como utilizar este prompt

Este documento é uma tarefa completa para uma futura implementação na extensão **Docker and Podman Studio**. Criar ou ler este arquivo não executa instalações, desinstalações, elevações ou alterações do sistema.

Quando receber este prompt como tarefa de implementação, implemente o produto de ponta a ponta: descoberta do ambiente, onboarding, instalação, configuração, gerenciamento, atualização, recuperação e testes práticos. Não entregue somente uma proposta, protótipos com dados simulados ou botões desconectados do backend.

Respeite as permissões e os limites do ambiente em que estiver trabalhando. A abrangência deste documento não autoriza contornar políticas corporativas, UAC, restrições do agente, permissões de hosts remotos ou confirmações do usuário.

**Base de referência:** repositório `italoalmeida0/docker-and-podman-studio-vscode`, versão `1.4.3` na elaboração deste documento, em 30/10/2026. Confirme a versão, o estado do worktree e as instruções do repositório ao começar: esses dados podem mudar.

## 1. Missão e resultado esperado

Transforme a extensão em uma experiência autossuficiente para preparar e administrar ambientes Docker e Podman, sem exigir **Docker Desktop** nem **Podman Desktop**.

Uma pessoa que instalou a extensão em uma máquina sem engine deve conseguir, pela interface do Studio:

1. Entender o que já existe e o que falta no computador.
2. Escolher Docker, Podman ou uma conexão existente.
3. Revisar um plano claro de instalação, privilégios, downloads, recursos e possíveis reinicializações.
4. Autorizar apenas as mudanças necessárias.
5. Instalar e configurar os componentes de uma solução funcional.
6. Acompanhar downloads, instalação e inicialização sem interpretar logs técnicos.
7. Retomar uma preparação interrompida, inclusive após reiniciar o computador.
8. Executar containers e projetos Compose reais.
9. Gerenciar máquinas, serviços, conexões e versões da engine.
10. Reparar, atualizar ou desinstalar componentes com controle sobre os dados.

Uma pessoa que já tem um ambiente funcionando deve continuar usando-o **sem reinstalação, alteração de preferência ou migração silenciosa**.

O padrão de qualidade é de produto profissional: comportamento previsível, segurança, observabilidade, acessibilidade, documentação e evidências de funcionamento. Não declare perfeição absoluta, certificação empresarial ou suporte a uma plataforma que não foi realmente validada.

## 2. Contexto do projeto e integrações obrigatórias

Antes de editar, examine as implementações existentes e reutilize o que já funciona:

| Superfície existente | Papel na implementação |
| --- | --- |
| `src/extension.ts` | Ativação, comandos nativos, roteamento de mensagens e coordenação das operações. |
| `src/config.ts` | Preferências `dockerPodmanStudio.*`, paths, engine, Compose, idioma e limites de operação. |
| `src/types.ts` | Contratos tipados entre Extension Host e webview. |
| `src/services/podmanService.ts` | Execução atual de Docker/Podman, invocações, Compose, máquinas, recursos e timeouts. Apesar do nome, atende ambas as engines. |
| `src/services/operationProgress.ts` | Progresso, saída incremental, snapshots e integração com o Output Channel. |
| `src/services/refreshCoordinator.ts` | Coordenação de refresh, evitando trabalho e indicadores duplicados. |
| Serviços de feedback, snapshots e erros em `src/services/` | Identidade das tentativas, recuperação contextual e proteção contra respostas antigas. |
| `src/shared/operationFeedback.ts` e helpers de mensagens | Contratos e apresentação de feedback já utilizados no produto. |
| `src/ui/webviewProvider.ts` | Ciclo de vida dos painéis e comunicação com o Studio. |
| `src/wizards/nativeWizards.ts` | Fluxos acessíveis pela Command Palette. |
| `webview-ui/src/store.ts` e `webview-ui/src/vscode.ts` | Estado React/Zustand e comunicação com o host. |
| `webview-ui/src/pages/DashboardPage.tsx` | Página atualmente apresentada como **System & Engine**. |
| `webview-ui/src/pages/SettingsPage.tsx` | Configuração dos caminhos e preferências atuais. |
| `webview-ui/src/components/Shared.tsx` | Componentes visuais, botões, dialogs e comportamento responsivo compartilhados. |
| `src/i18n.ts`, `webview-ui/src/i18n/` e `package.nls*.json` | Localização do backend, interface e comandos contribuídos. |
| `tests/`, `CONTRIBUTING.md` e workflows existentes | Regressões, testes práticos e instruções de validação. |

Regras de integração:

- Preserve a página inicial **System & Engine** e o identificador interno `dashboard`, salvo necessidade comprovada. Renomear identificadores internos não é um objetivo.
- Não quebre configurações antigas, comandos personalizados, projetos Compose, logs, multisseleção, limpeza segura ou feedback contextual.
- Separe a execução de provisionamento das operações normais de containers. Não transforme o serviço atual em um executador privilegiado genérico.
- Use APIs, helpers e padrões existentes; extraia algo compartilhado apenas quando houver uma necessidade real.
- Toda ação oferecida no Studio deve chegar a uma operação real do Extension Host. A webview não instala software nem determina comandos privilegiados.
- Exponha também comandos nativos para abrir o setup, redetectar o ambiente, verificar atualizações e acessar diagnósticos.
- Considere como executar Docker dentro de WSL ou outro backend afeta **todas** as operações existentes: Compose, build, logs, terminal, mounts, paths e credenciais. Instalar uma engine que o Studio não consegue usar não atende à tarefa.
- Instale dependências de desenvolvimento somente quando necessárias à implementação e conforme os manifests. Não acrescente tooling redundante.
- Preserve compatibilidade com a versão mínima de VS Code declarada, ou apresente e documente uma mudança necessária.

## 3. Limites reais das plataformas

Não confunda instalar uma CLI com disponibilizar uma engine.

### 3.1 Matriz de arquitetura mínima

| Plataforma | Podman sem Desktop | Docker sem Desktop | Condição de aceite |
| --- | --- | --- | --- |
| Windows compatível | CLI Podman e Podman Machine em provider suportado, normalmente WSL2; Hyper-V somente quando disponível e validado. | Engine Linux em WSL2 ou outro backend Linux explicitamente suportado, com transporte funcional para o Studio. | Containers Linux e Compose funcionam pela extensão, sem processos ou dependências dos aplicativos Desktop. |
| macOS compatível | CLI Podman e Podman Machine com provider compatível com o host e a versão instalada. | Docker CLI e backend Linux gerenciado, como Colima/Lima com runtime Docker. | VM, Docker Engine, cliente, Compose e compartilhamento de arquivos funcionam de ponta a ponta. |
| Linux compatível | Podman nativo, preferencialmente rootless; Machine não é um requisito para o uso nativo. | Docker Engine/CLI e plugin Compose, com modo rootless quando suportado e escolhido. | Engine operacional e gerenciamento do serviço adequado ao sistema real. |

Estas são arquiteturas de referência, não autorização para usar flags, pacotes ou providers sem verificar sua documentação e sua disponibilidade.

### 3.2 Restrições que precisam aparecer no produto

- Docker Engine Linux não roda diretamente no kernel Windows ou macOS. Explique WSL/VM em linguagem simples.
- Docker CLI no Windows ou macOS, sozinho, não permite rodar containers.
- Compatibilidade com a API Docker não transforma Podman em Docker. Não apresente um backend Podman como instalação Docker.
- Docker Engine nativo para containers Windows é um cenário separado, com restrições de edição e suporte. Não o use como substituto implícito da solução de containers Linux.
- Virtualização desabilitada no firmware não pode ser corrigida com uma instalação de pacote. Identifique o bloqueio e explique a ação externa necessária.
- UAC, autenticação do sistema, reinicializações, políticas de administrador e certos requisitos de firmware são exceções inevitáveis à experiência dentro do Studio.
- Um dispositivo gerenciado por TI pode proibir instalação, virtualização ou atualização. Não contorne essas políticas.
- Não instale Docker Desktop por conveniência quando o objetivo for um backend sem Desktop. Verifique a identidade do pacote: alguns resultados de pesquisa oferecem o aplicativo completo, não só a CLI.
- Não remova Desktop já instalado nem invalide seus contextos para provar independência. Use ambientes de teste separados para esse requisito.
- Declare uma matriz de suporte por SO, versão, arquitetura e provider. Não confunda "Linux" com suporte comprovado a qualquer distribuição.
- Pacotes oficiais, pacotes de distribuição e ferramentas comunitárias devem ser identificados como tal. Não atribua suporte comercial inexistente à solução.

### 3.3 Cobertura inicial exigida

Implemente adapters para Windows, macOS e Linux. Defina e valide pelo menos:

- Windows atual suportado pelo provider escolhido, inicialmente x64.
- macOS atual suportado, inicialmente Apple Silicon, com tratamento explícito de Intel.
- Ubuntu/Debian com instalação por pacotes suportados.
- Fedora ou distribuição RPM suportada, especialmente para Podman.

Outras arquiteturas/providers só podem aparecer como "suportados" após verificação dos artefatos, comportamento e testes correspondentes. Se um host de teste não estiver disponível, registre a lacuna como bloqueio de validação; não simule evidência de teste real.

## 4. Descoberta do ambiente e primeira utilização

### 4.1 Identifique o host correto

Determine primeiro onde a extensão e os comandos realmente executam:

- VS Code local.
- Extension Host remoto por SSH.
- Extension Host dentro de WSL.
- Dev Container ou ambiente provisionado.
- VS Code Web sem acesso à execução local.

Mostre o alvo da operação. Não use o SO da interface para decidir como instalar no Extension Host remoto.

Instalação local não pode modificar automaticamente o host remoto, e instalação remota não pode modificar automaticamente o computador da interface. Provisionar hosts compartilhados ou gerenciados exige autorização específica.

Em VS Code Web ou ambientes sem capacidades necessárias, apresente um estado honesto e opções compatíveis. Não mostre um wizard que promete uma instalação impossível.

### 4.2 Inventário somente leitura

Colete, com concorrência limitada, cancelamento e timeouts:

- SO, distribuição, versão, arquitetura e identificação do host de execução.
- Escopo das configurações: default, usuário, workspace e remoto.
- Paths configurados, resolução no PATH e candidatos conhecidos em locais documentados.
- CLI Docker, CLI Podman e providers Compose encontrados, com origem e versão.
- Diferença entre versões do cliente, daemon/server e guest da VM.
- Contextos Docker, conexões Podman, endpoint efetivo e variáveis relevantes, como `DOCKER_HOST` e `DOCKER_CONTEXT`.
- Disponibilidade da engine: ausente, instalada, parada, inacessível, incompatível, sem permissão, saudável ou desconhecida.
- Máquinas/VMs/distros existentes, estado, provider e titularidade quando possível.
- Gerenciadores de pacotes existentes e mecanismo que instalou cada componente.
- Pré-requisitos de virtualização, WSL, kernel, recursos opcionais, storage e espaço disponível.
- Privilégios realmente disponíveis; pertencer a um grupo administrativo não é igual a estar elevado.
- Capacidades de rootless e limitações relevantes.
- Requisitos de proxy, certificados corporativos e acesso às origens de download.
- Necessidade conhecida de reinicialização ou nova sessão.

Regras:

- Não execute binários arbitrários descobertos em diretórios de um workspace não confiável.
- Respeite Workspace Trust antes de executar comandos configurados pelo projeto ou aplicar mudanças.
- Não percorra recursivamente todo o disco procurando executáveis.
- Um probe que falha não prova ausência do software.
- Diferencie CLI ausente, path errado, daemon parado, permissão negada e versão incompatível.
- Não envie credenciais de registros, proxy ou contextos para logs, telemetria ou webview.
- Preserve os resultados independentes: falha de Docker não deve apagar um Podman saudável.
- Distingua instalação local e conexão remota. Uma conexão remota válida não exige instalar uma engine local.
- Faça revalidação antes de aplicar qualquer plano: o inventário pode ter mudado.

### 4.3 Comportamento de primeira abertura

Use a primeira abertura do Studio e verificações leves em background, sem bloquear a ativação normal.

| Ambiente encontrado | Comportamento obrigatório |
| --- | --- |
| Preferência explícita válida e engine saudável | Usar a configuração existente; não abrir setup. |
| Uma engine saudável e nenhuma preferência explícita | Sugerir utilização da engine encontrada, mostrando a escolha antes de persistir mudanças. |
| Ambas saudáveis e nenhuma preferência explícita | Permitir escolher; não decidir arbitrariamente nem alternar durante operações. |
| CLI presente, engine parada | Oferecer iniciar/conectar; não recomendar reinstalação como primeira solução. |
| Engine funcional, Compose ausente/incompatível | Oferecer instalar ou reparar somente o componente necessário. |
| Path customizado inválido | Mostrar o problema e permitir corrigir, sem apagar o valor silenciosamente. |
| Nada utilizável encontrado | Oferecer o Setup Wizard com escolhas e requisitos claros. |
| Conexão remota utilizável | Permitir usá-la sem provisionar uma engine local desnecessária. |
| Plataforma/política sem suporte | Explicar o bloqueio e não executar tentativas destrutivas ou fallbacks inseguros. |

Não confunda a configuração default `docker` com uma preferência deliberada do usuário.

O usuário deve poder escolher "Agora não", continuar vendo o estado do sistema e reabrir o setup quando quiser. Não repita modais de onboarding em cada refresh, reabertura do painel ou atualização da extensão.

## 5. Setup Wizard: fluxo completo

O fluxo deve ser curto no caso simples e progressivo no caso avançado.

### 5.1 Etapas visíveis

1. **Ambiente:** mostrar o que existe, o que funciona e o que falta.
2. **Escolha:** Docker, Podman, conexão existente ou configurar mais tarde.
3. **Modo:** backend local/VM/WSL compatível, rootless/rootful quando aplicável e política de inicialização.
4. **Recursos:** nome da máquina/instância, CPU, memória, disco e locais de dados.
5. **Plano:** componentes, versões, fontes, privilégios, mudanças e reinicializações.
6. **Execução:** progresso por etapa, download quando mensurável, logs opcionais e cancelamento seguro.
7. **Validação:** cliente, engine, Compose e teste funcional autorizado.
8. **Conclusão:** configuração aplicada, resultado concreto e acesso ao System & Engine.

Não obrigue pessoas leigas a escolher uma CLI de baixo nível, um socket, uma distro ou flags sem explicação. Ofereça uma recomendação fundamentada e opções avançadas recolhidas.

### 5.2 Plano de instalação

Gere um plano estruturado, imutável depois da aprovação, contendo:

- Host, engine, provider, modo e recursos selecionados.
- Componentes presentes que serão reutilizados.
- Pacotes que serão instalados, atualizados ou removidos.
- Versões exatas resolvidas e origem de cada artefato.
- Estimativa de download/disco quando disponível, sem números inventados.
- Operações que exigem elevação e justificativa.
- Arquivos de configuração, serviços, contextos e instâncias que serão criados ou alterados.
- Efeitos em PATH, sessão, boot e cargas em execução.
- Etapas reversíveis, pontos sem rollback automático e plano de recuperação.
- Dados que ficam preservados e dados potencialmente afetados.

A aprovação deve corresponder a esse plano. Se versão, destino, privilégio ou impacto mudar, invalide a aprovação e solicite nova revisão.

### 5.3 Idempotência

- Rodar o setup novamente deve detectar componentes já presentes.
- Retomar não pode recriar máquinas, distros, contextos ou serviços duplicados.
- Não instale outro Python, Docker, Podman ou gerenciador de pacotes quando o existente é compatível.
- Não crie duplicatas do PATH nem altere a preferência de engine de outros workspaces.
- O caso "instalado, mas não encontrado pela sessão atual" deve oferecer redetecção/recarregamento, não nova instalação.
- Se uma operação muda o contexto externo, registre e confirme o impacto. Prefira invocações com contexto explícito quando possível.

## 6. Instalação por plataforma

### 6.1 Windows e Podman

- Detecte WSL2 ou Hyper-V de acordo com provider, edição, versão e arquitetura.
- Não altere BIOS, desligue segurança do host ou habilite recursos globais sem aprovação.
- Quando necessário, habilite apenas os recursos previstos no plano, com UAC e indicação de reboot.
- Instale Podman por fonte oficial/verificada ou reutilize um pacote compatível existente.
- Crie/inicialize e inicie uma Podman Machine identificada, somente se necessário.
- Gerencie máquinas do usuário no contexto do usuário original. Não crie a máquina em outro perfil por executar tudo como administrador.
- Configure a conexão correta e valide cliente, server e Compose.
- Detecte providers Compose reais; `podman compose` é uma interface para provider externo, não evidência suficiente de que esse provider está instalado.
- Se `podman-compose` exigir Python, use pacote de distribuição ou ambiente isolado apropriado. Não faça `pip` global como root, não viole ambientes Python gerenciados e não sobrescreva outras instalações.
- Preserve máquinas e conexões preexistentes.

### 6.2 Windows e Docker sem Desktop

- Prepare uma instância Linux WSL2 ou outro backend aprovado, com identidade e dados próprios.
- Não use uma distribuição pessoal existente como laboratório de instalação/removal sem autorização específica.
- Instale Docker Engine, cliente e Compose no ambiente adequado, com Buildx quando exigido pelos builds suportados.
- Faça o Studio executar Docker contra esse backend corretamente, usando um transporte implementado e validado.
- Não crie aliases que apontem Docker para Podman e depois alegue que Docker foi instalado.
- Não dependa de executáveis, sockets, distros ou serviços internos de Docker Desktop.
- Implemente lifecycle da instância e do serviço sem exigir abrir um terminal externo para cada operação.
- Preserve o usuário alvo, permissões de arquivos, autenticação e variáveis necessárias ao runtime.
- Teste paths Windows com espaços/acentos, bind mounts, diretório de trabalho, arquivos Compose, env files e logs.
- Um wrapper de comandos, se necessário, deve ser tipado, controlado pela extensão e usar argumentos literais. Não aceite scripts arbitrários da webview.
- Não exponha daemon TCP sem TLS/autenticação para tornar a conexão "mais fácil".

### 6.3 macOS e Podman

- Detecte arquitetura, versão de macOS e provider realmente suportado.
- Priorize a instalação recomendada na documentação atual do Podman. Homebrew não deve ser apresentado como instalação oficial se a documentação não o recomenda.
- Se já instalado por um gerenciador compatível, respeite sua origem e seu mecanismo de atualização.
- Crie e gerencie Podman Machine no usuário correto, sem elevar operações rootless sem necessidade.
- Valide VM, rede, mounts, forwarding, engine e provider Compose.
- Trate macOS Intel e Apple Silicon explicitamente; não baixe artefato da arquitetura errada.
- Verifique assinatura/notarização dos artefatos que a exigem e trate aprovação do sistema sem desabilitar Gatekeeper.

### 6.4 macOS e Docker sem Desktop

- Integre um backend Linux conhecido e sustentável, como Colima/Lima com runtime Docker.
- Identifique o backend comunitário e documente suas dependências/licenças.
- Instale/reutilize Docker CLI, Compose e Buildx conforme necessário e compatível.
- Crie um perfil/VM próprio quando o usuário escolher uma instalação gerenciada.
- Ofereça lifecycle, recursos e atualização da solução através do Studio.
- Não sobrescreva perfis Colima/Lima do usuário.
- Não use uma configuração interativa em editor externo como única forma de gerir recursos.
- Valide sockets, contextos, compartilhamento de diretórios, permissões e containers de ambas as arquiteturas que declarar suportadas.
- Emulação, quando oferecida, deve ter limites e implicações de desempenho explícitos.

### 6.5 Linux

- Identifique distribuição, release, arquitetura e init/service manager.
- Use fontes e pacotes apropriados à distribuição. Não trate todas as distros como Ubuntu.
- Diferencie serviços systemd do sistema, serviços do usuário e sistemas sem systemd.
- Rootless é preferível quando viável, mas requer validação de UID/GID, subuids/subgids, namespaces, rede, cgroups e storage.
- Não inicie um segundo daemon rootful para contornar uma configuração rootless com problema.
- Se rootful for escolhido, explique a consequência. Acesso ao grupo/socket Docker pode equivaler a privilégios elevados; não o descreva como isolamento seguro.
- Configure somente os serviços e permissões necessários ao plano aprovado.
- Não aplique `chmod 666` em sockets, não configure `NOPASSWD` e não desative SELinux/AppArmor para fazer o setup passar.
- Detecte políticas de sistema e installations gerenciadas por pacotes; não sobrescreva binários manualmente.
- Considere versões estáveis com patches de distribuição: não conclua que uma versão é insegura somente por parecer antiga.

## 7. Estado durável, execução e recuperação

Modele explicitamente uma operação longa com etapas e resultados verificáveis.

### 7.1 Estados mínimos

Considere estados equivalentes a:

`idle`, `detecting`, `needs-setup`, `planning`, `awaiting-approval`, `awaiting-elevation`, `downloading`, `installing`, `configuring`, `starting`, `validating`, `ready`, `needs-restart`, `cancelled`, `failed`, `partially-completed` e `unknown`.

Adapte nomes ao projeto; o essencial é não representar todos os casos como loading/success/error.

### 7.2 Contratos e identidade

As operações precisam carregar:

- Identificador único, resistente a reativação e múltiplas janelas.
- Identidade do host, engine, provider e recurso alvo.
- Identificador da tentativa e versão do plano aprovado.
- Etapa, estado, timestamps, bytes ou contadores reais quando disponíveis.
- Estado de cancelamento e resultado final.
- Efeitos aplicados e checkpoints confirmados.
- Erros estruturados/localizáveis com detalhes técnicos separados.

Não use um contador reiniciado como única identidade para conciliar eventos persistidos.

A forma concreta dos tipos e módulos é decisão de implementação. Prefira tipos discriminados e schemas simples; evite uma plataforma genérica de orquestração maior do que a necessidade.

### 7.3 Persistência

- Guarde o journal em storage apropriado ao host, com versão de schema, escrita atômica, limites e controle de acesso.
- Não use o workspace do usuário para guardar senhas, instaladores privilegiados ou estado sensível.
- Distingua preferências globais, contexto remoto, estado de onboarding e operação em curso.
- Não marque instalação concluída só porque existe um arquivo de checkpoint.
- Após reload, crash ou reboot, reinspecione processos, pacotes, máquinas e serviços.
- Processe migrations e journals incompletos/corrompidos sem esconder o problema nem repetir mutações automaticamente.
- Retome somente quando o estado real for conhecido e o plano ainda válido.
- Não suponha que o processo elevado sobreviva ao Extension Host; defina supervisão e recuperação verificáveis.
- Não deixe helper privilegiado persistente rodando sem uma necessidade demonstrada, controle e cleanup.

### 7.4 Concorrência

- Duas janelas VS Code não podem instalar/atualizar a mesma engine ao mesmo tempo.
- Use lock no host/recurso que cubra processos diferentes, não apenas mutex JavaScript.
- Locks vencidos precisam de verificação; PID sozinho pode ser reutilizado.
- Preserve leituras úteis e bloqueie somente mutações conflitantes.
- Atualização/reparo não pode correr em paralelo com setup ou remoção do mesmo backend.
- Trocar engine, host ou workspace não redireciona uma operação já aprovada.
- Eventos tardios de uma tentativa não podem sobrescrever o estado de outra.
- Fechar/reabrir o Studio não duplica processos, subscriptions, loading ou mensagens.

### 7.5 Timeout e cancelamento

- Preserve o limite atual de 30 segundos para consultas curtas quando adequado; não aplique esse limite a instalação inteira.
- Use budgets apropriados para download, extração, installer, VM e validação.
- Diferencie ausência de saída, etapa lenta, processo encerrado e timeout real.
- Mostre tempo decorrido e etapa corrente. Informe quando o sistema/installer não fornece percentual.
- Não invente ETA ou uma barra que avança para 99% sem medição.
- Um timeout de mutação não autoriza retry ou troca automática de provider.
- Cancelamento deve parar novas etapas e terminar downloads/processos apenas quando seguro.
- Não mate MSI, dpkg/rpm ou um update de VM no meio de uma transação sem respeitar o mecanismo suportado.
- Se uma etapa não pode ser cancelada com segurança, explique e permita solicitar parada após ela.
- Depois de cancelamento/timeout, verifique os efeitos reais. Não declare rollback, interrupção ou ausência de mudanças sem comprovação.
- Reboot deve ser solicitado, nunca iniciado automaticamente.

## 8. Fontes de instalação, integridade e cadeia de confiança

Implemente um catálogo pequeno de receitas específicas, com capabilities e origem verificável.

- Resolva versão estável compatível antes da aprovação; não execute um `latest` mutável depois da revisão.
- Registre o package ID real, origem, arquitetura, versão e método de instalação.
- Não adivinhe IDs de winget, nomes de pacotes ou flags de installers.
- Prefira o mecanismo confiável que já gerencia o componente.
- Instale apenas os pré-requisitos necessários. Habilitar Kubernetes, cloud SDKs, GPU tooling ou registries privados não faz parte do setup básico.
- Se precisar instalar um gerenciador de pacotes ou Python, isso é uma etapa separada do plano, com consentimento e validação.
- Não execute `curl | sh`, `curl | sudo bash` nem scripts remotos arbitrários.
- Use HTTPS, validação de certificado e redirects controlados. Não implemente bypass de TLS como recuperação.
- Verifique assinatura/chain, package manager trust e integridade conforme a fonte.
- Um checksum recebido pelo mesmo canal não confiável não é uma raiz de confiança independente.
- No Windows, valide identidade/assinatura do publisher quando aplicável; não confie apenas no nome do `.exe`.
- No macOS, respeite assinatura, notarização e quarantine. Não remova atributos de segurança para acelerar o teste.
- No Linux, use chaves e repositórios apropriados; alterações de fontes/chaves precisam ser explícitas.
- Downloads incompletos devem ficar separados de artefatos válidos e jamais ser executados.
- Cache precisa de origem/versionamento, verificação na reutilização, limites e arquivos em diretórios protegidos.
- Extração de arquivos deve recusar traversal e destinos fora do escopo; symlinks/reparse points exigem tratamento seguro.
- Offline só pode instalar artefatos previamente confiáveis e compatíveis. Não alegue sucesso com uma cache incompleta.
- Trate proxy, rede limitada, certificado corporativo, autenticação, redirect negado e falta de espaço.
- Retry automático pode ser usado para leituras/downloads idempotentes, com limite e backoff. Não replique essa lógica em installers/mutações.
- Não guarde tokens/senhas de proxy em argumentos de processo, relatórios ou armazenamento em texto claro.

## 9. Elevação de privilégio

O VS Code e a extensão devem continuar no contexto normal do usuário. Eleve apenas operações que realmente exigem privilégio.

### 9.1 Broker/helper

Caso necessário, implemente um broker pequeno, específico e auditável:

- Ações permitidas são enumeradas; não existe ação "executar qualquer shell".
- O broker deriva comandos de uma receita confiável, não de texto enviado pela webview.
- Valide novamente parâmetros, paths, host, plano, origem e identidade do chamador.
- IPC local deve ter autenticação, permissões, escopo por operação e proteção contra replay.
- Não use um servidor TCP privilegiado acessível por outras aplicações.
- Preserve e valide a identidade do usuário original, principalmente quando a autenticação ocorre com outra conta administrativa.
- Escolha executáveis por path absoluto e fontes verificadas; não deixe PATH/cwd/variáveis injetáveis escolherem o programa elevado.
- Proteja helper, configuração, arquivos temporários e payloads contra alteração antes ou durante execução.
- Não execute script privilegiado editável no workspace ou em diretório compartilhado.
- Capture saída e códigos de retorno de forma controlada. Proteja logs e elimine segredos antes de distribuí-los.
- Não instale serviço permanente com privilégios apenas para evitar futuras solicitações de autenticação.
- A revogação/cancelamento de autorização deve ser um resultado normal e recuperável.
- Documente o modelo de ameaças: quem pode emitir pedidos, o que pode executar, quais recursos pode mudar e como termina.

### 9.2 Windows e UAC

- Use um fluxo legítimo de elevação do Windows, como um launcher com `ShellExecuteEx`/verbo `runas`, adequado ao helper escolhido.
- Solicite UAC somente após o usuário aprovar o plano, não durante probes de instalação.
- Diferencie permissão negada, UAC cancelado, autenticação com outra conta, timeout e execução elevada que falhou.
- Não desabilite UAC, não capture senha administrativa na webview e não reinicie o VS Code inteiro como administrador.
- Verifique a elevação efetiva e a identidade do token, não apenas pertença ao grupo Administradores.
- Assinatura de código e publisher reconhecível devem fazer parte do plano de distribuição de produção.
- Um helper de desenvolvimento não assinado deve ser identificado como tal; não alegue que a versão de produção foi validada/assinada sem artefatos e credenciais reais.
- Habilitar recursos do host pode precisar de admin; criar/iniciar Podman Machine e distros do usuário não deve acontecer automaticamente sob a conta errada.

### 9.3 `suwin` exclusivamente no desenvolvimento

O proprietário informa que a ferramenta `suwin` está disponível nesta máquina e permite invocar comandos como administrador. O exemplo fornecido foi:

```powershell
suwin whoami /priv
```

Para futuros testes:

- Verifique a presença, a sintaxe e o comportamento da instalação real antes de usá-la.
- Use-a somente para operações administrativas de desenvolvimento já autorizadas e com escopo conhecido.
- A saída de `whoami /priv` ajuda a diagnosticar privilégios, mas não substitui todas as verificações de identidade/elevação.
- Não trate sua existência como autorização para qualquer comando privilegiado.
- Não registre credenciais, não altere políticas para eliminar UAC e não implemente bypass.
- `suwin` não pode ser dependência da extensão, do pacote VSIX ou do fluxo de produção.
- Os testes finais devem exercer o elevator/broker real com UAC aceito **e cancelado**, partindo de um VS Code não elevado.
- Validar somente "funciona com suwin" não satisfaz o aceite.

### 9.4 macOS

- Use autenticação legítima do sistema e mecanismos apropriados ao deployment suportado.
- Avalie APIs atuais de autorização/Service Management e installers assinados quando necessários.
- Não baseie a solução em APIs deprecated de execução privilegiada sem um motivo e uma estratégia compatível.
- Não armazene senha, não execute Homebrew como root e não desabilite SIP/Gatekeeper.
- Instalações por usuário e lifecycle rootless de VM não devem solicitar admin sem necessidade.
- Defina assinatura, notarização, instalação e remoção do helper quando utilizado.
- Teste sucesso, recusa de autenticação, falta de permissões e identidade do usuário.

### 9.5 Linux

- Considere Polkit/`pkexec` com ação limitada e agente de autenticação disponível.
- Se usar `sudo` como fallback suportado, faça autenticação em terminal integrado controlado; não peça nem armazene senha no Studio.
- Polkit não valida automaticamente os argumentos do programa: o helper continua responsável por validá-los.
- Não escreva regras permissivas de Polkit, sudoers sem senha ou permissões globais de sockets.
- Trate hosts sem agente gráfico, TTY indisponível, recusa, política corporativa e sessões remotas.
- Não eleve operações rootless nem altere o owner dos dados do usuário para root.

## 10. Engine Manager dentro de System & Engine

O setup não deve ser uma ilha. Integre o gerenciamento ao System & Engine.

### 10.1 Informações e status

Mostre separadamente:

- Engine selecionada e host alvo.
- Cliente, backend/server, provider/VM e Compose.
- Versões, origem da instalação e disponibilidade de atualização.
- Estado da CLI, serviço, máquina, conexão e saúde funcional.
- CPU, memória e disco quando o provider consegue fornecer dados corretos.
- Modo rootless/rootful, endpoint e permissões relevantes.
- Titularidade: gerenciado pelo Studio, instalação existente ou host remoto.

Ausência de métrica não é zero. Estado desconhecido não é saudável.

### 10.2 Ações obrigatórias quando suportadas

- Detectar novamente e corrigir paths.
- Iniciar/parar/reiniciar o backend correto.
- Criar/configurar uma máquina ou instância gerenciada.
- Selecionar e validar contextos/conexões.
- Configurar CPU, memória e disco dentro das capacidades reais.
- Consultar logs do serviço/VM e executar diagnósticos.
- Verificar atualizações e aplicar atualização aprovada.
- Reparar uma instalação/configuração específica.
- Desinstalar componentes ou remover uma instância com opções explícitas de dados.
- Definir inicialização automática quando o backend/SO suportar, com seu impacto explicado.

Não mostre a mesma capacidade para todos os providers:

- Podman Linux nativo não precisa de "Iniciar VM".
- Mudar CPU/memória pode exigir parada/restart e não ser aplicável ao daemon nativo.
- Reduzir disco pode ser impossível/arriscado; não ofereça uma operação fictícia.
- Alguns providers não conseguem atualizar o guest OS da mesma forma. Consulte a capacidade, não apenas o nome do subcomando.
- Parar WSL globalmente pode afetar distribuições de outras pessoas/projetos. Prefira agir só na instância selecionada.
- Gerenciar serviço remoto é diferente de usar uma conexão remota; não obtenha acesso administrativo automaticamente.

Antes de parar, reiniciar, atualizar ou remover, apresente os workloads conhecidos afetados. Preserve a validação de identidade entre confirmação e execução.

## 11. Atualização, reparo, rollback e preservação de dados

### 11.1 Atualizações

- Ofereça verificação manual; consultas automáticas de versões devem ser configuráveis e respeitar rede/política.
- Não faça auto-upgrade, migração de dados ou reboot por padrão.
- Separe update de CLI, Compose, provider, kernel/WSL e guest OS.
- Siga o gerenciador/origem que instalou o componente.
- Mostre versão atual, versão proposta, compatibilidade, fonte, impactos e release notes pertinentes.
- Não escolha prerelease silenciosamente.
- Verifique compatibilidade cliente/server, Compose e storage antes da mudança.
- Se o update exigir pausa, preserve apenas o conjunto de workloads autorizado para retomada.
- Após atualização, revalide engine, Compose, conexões, recursos e dados; não basta comparar `--version`.
- Não sobrescreva binários abertos nem ignore falhas de package manager.
- Uma tentativa parcialmente aplicada precisa de diagnóstico e recuperação, não de mensagem verde.

### 11.2 Dados e backups

Inventarie containers, images, volumes, redes, máquinas, distros, perfis e configurações relevantes antes de mutações destrutivas.

- Preservação é o padrão para atualização/reparo/desinstalação de ferramentas.
- Faça backup consistente quando o procedimento exigir: quiesce de workloads e formato suportado.
- Exportar uma image/container não faz backup de todos os volumes.
- Exporte/copie volumes com uma estratégia explícita, respeitando estado e permissões.
- WSL/VM exportada também tem limites; valide o método de restore.
- Backup precisa de verificação e, em ambiente de teste, restore exercitado.
- Credenciais exigem tratamento separado; não as coloque em um bundle de suporte em texto claro.
- O usuário escolhe destino, custo de disco e política de retenção.
- Não apague um backup para "limpar o teste" antes de provar a recuperação e seu escopo.

### 11.3 Rollback e reparo

- Registre alterações aplicadas e diferencie rollback de configuração, pacote e formato de dados.
- Rollback automático só é permitido quando comprovadamente seguro e suportado.
- Não prometa downgrade de engine/guest/storage que o fornecedor não suporta.
- Nunca recrie uma VM vazia para esconder falha de upgrade.
- O fluxo "Reparar" deve começar por diagnóstico e um plano específico.
- Não use reset global, force remove, purge indiscriminado ou remoção de distribuições como reparo genérico.
- Se rollback seguro não existir, informe isso antes da aprovação e ofereça backup/restore e passos claros.

## 12. Desinstalação e ciclos de reinstalação

O proprietário autorizou testes repetidos de desinstalação/reinstalação de Podman, providers Compose, Docker e componentes necessários neste computador. Essa autorização deve ser aplicada com inventário, controle de dados e respeito ao ambiente compartilhado.

### 12.1 Antes de remover qualquer coisa

1. Identifique instalações, origens, versões, escopo de usuário/sistema e uso por outros programas.
2. Inventarie recursos existentes e distinga dados pessoais dos fixtures do teste.
3. Defina exatamente pacotes, serviços, máquinas, distros, arquivos e diretórios a remover.
4. Faça backup/restore quando dados reais possam ser afetados.
5. Obtenha decisão específica se houver workloads reais, dados sem backup, componentes compartilhados ou risco não coberto.
6. Prefira VM/host descartável, perfil isolado ou backend próprio para os testes destrutivos.

Se não for possível separar ou proteger recursos, interrompa a parte destrutiva e apresente o bloqueio. A autorização para testar não autoriza apagar dados de terceiros.

### 12.2 Opções do produto

- **Remover ferramentas e manter dados:** preserva recursos/configurações que não precisam ser apagados.
- **Remover instância gerenciada:** explica que apagar VM/distro pode remover todos os seus recursos e dados.
- **Remover também dados:** confirmação separada, inventário explícito e prova de titularidade/destino.

Desinstalar a extensão não deve automaticamente desinstalar engines nem apagar dados.

### 12.3 Limpeza permitida nos testes

- Use prefixos/labels únicos e um registro de titularidade de cada fixture.
- Remova recursos pelo ID/nome exato depois de reconfirmar identidade e dependências.
- Preserve images e pacotes existentes reutilizados como base.
- Trate infra containers, pods e dependências na ordem correta.
- Não execute prune/reset global do usuário.
- Não use `wsl --unregister` em distribuições não destinadas ao teste.
- Não remova WSL/Hyper-V global se outros backends dependem deles.
- Não remova diretórios de dados por wildcard, inferência de nome ou path não resolvido.
- Não encerre processos por nome. Use apenas IDs comprovadamente pertencentes ao teste.
- Falhas de cleanup precisam ficar visíveis no relatório, nunca escondidas em um `catch`.

## 13. UX/UI obrigatória

O foco é a pessoa que não conhece engines, VMs, Compose nem privilégios.

### 13.1 Linguagem e orientação

- Explique "instalar ferramenta", "preparar máquina" e "iniciar engine" como etapas diferentes.
- Exemplo de resumo: "O Podman já está instalado. Falta preparar a máquina que executa seus containers."
- Explique por que a etapa demora e o que está sendo aguardado.
- Reserve logs técnicos para expansão, cópia e diagnóstico.
- Use erros específicos: download bloqueado, falta de espaço, WSL pendente de reboot, provider Compose ausente, UAC cancelado, política corporativa, etc.
- Uma operação lenta ou autorização recusada não deve parecer corrupção grave do aplicativo.
- Erros significativos precisam permanecer identificáveis; não suavize perda de dados ou falha de integridade.

### 13.2 Progresso e mensagens

- Use etapa, tempo decorrido, contador real e progresso de download quando mensurável.
- Não deixe somente botões desabilitados sem uma indicação do que está acontecendo.
- Atualize o último sinal de atividade quando houver logs/heartbeat reais.
- Mensagens de sucesso desaparecem de acordo com o padrão existente; histórico fica consultável.
- Quando uma operação se recupera, remova somente o aviso associado à tentativa/contexto correspondente.
- Troca de engine/host não deve carregar avisos irrelevantes do contexto anterior.
- Reabrir painel não duplica loading nem recria a operação.
- Retry deve explicar o que será repetido e o que já está pronto.
- Mostre resultado parcial quando apropriado: "CLI instalada; a máquina ainda precisa reiniciar".
- Não abra vários prompts de UAC iguais por concorrência ou retries.
- Não bloqueie toda a aplicação se só um recurso está ocupado.

### 13.3 Acessibilidade, idioma e responsividade

- Preserve os 16 idiomas: `en`, `pt-BR`, `es`, `fr`, `de`, `it`, `ru`, `uk`, `pl`, `tr`, `nl`, `ja`, `ko`, `zh-CN`, `zh-TW`, `hi`.
- Localize também backend, dialogs nativos, comandos, severidades, etapas e recomendações.
- Detalhes técnicos permanecem na língua original da ferramenta; o resumo deve estar localizado.
- Trocar idioma durante uma tarefa deve atualizar rótulos, não reiniciar a operação.
- Teclado, foco, fechamento/retorno de dialogs e leitores de tela devem funcionar.
- Use regiões de status acessíveis sem anunciar cada linha de log como alerta.
- Preserve contraste e comportamento dos temas claro, escuro e alto contraste.
- Teste webview extremamente estreito, até 200 px de área útil, usando o padrão responsivo existente.
- Teste janela baixa, textos longos, Unicode e zoom de pelo menos 120%.
- Não crie barras de ações duplicadas/contraditórias; deixe claro qual engine/máquina a ação afeta.

## 14. Diagnóstico, logs e privacidade

- Registre etapas, host/contexto não sensível, versões, operação, timing, código de saída e efeitos aplicados.
- Limite buffers e retenção. Logs de várias instalações não podem crescer indefinidamente.
- Mantenha stdout/stderr separados ou claramente identificados.
- Preserve UTF-8 e remova sequências de controle sem destruir a informação útil.
- Não registre senhas, tokens, registry auth, chaves privadas, credenciais de proxy ou comandos secretos.
- Paths e hostname podem conter dados pessoais; a exportação precisa de preview/redação.
- O suporte exportado deve ser opt-in, sanitizado e acessível antes de compartilhar.
- Não envie código, logs, diagnóstico ou inventário a terceiros automaticamente.
- Não inclua capturas de UAC/credenciais ou secrets nos artefatos de testes.
- Um bundle de diagnóstico deve mostrar os limites: o que foi observado, o que falhou e o que ficou desconhecido.
- Erros de integridade/autenticação não podem ser convertidos em falhas genéricas que incentivem "tentar sem segurança".

## 15. Testes obrigatórios: estratégia e separação

Não confunda teste mockado, teste em navegador e instalação real.

### 15.1 Unitários e contratos

Cubra parsers, detecção, escolha de receita, compatibilidade, origem, aprovação, capabilities, journals, locks, validação de argumentos, redaction e todos os estados.

- Fixtures para installed/missing/stopped/permission-denied/incompatible/unknown.
- Identidade da engine e do host preservada em todos os passos.
- Custom paths, espaços, aspas, Unicode e entradas malformadas.
- Plano alterado após aprovação.
- Eventos duplicados/tardios, cancelamento, corrupt journal e lock vencido.
- Falhas específicas de cada package manager/provider.
- Recusa de elevação e helper não autenticado.
- Download truncado/corrompido e assinatura inválida.
- Nenhum comando inesperado executado ao receber uma mensagem malformada.

### 15.2 Integração e interface

- UI com dados simulados testa estados, acessibilidade e responsividade, mas não prova instalação.
- Testes de instalação/mutações devem ser opt-in, com alvo e impacto explícitos.
- CI normal não pode desinstalar engines do runner como efeito colateral.
- CI destrutiva precisa de runner/VM dedicada, inventário e cleanup próprio.
- Execute o fluxo no VS Code real em perfil separado.
- Teste abertura inicial, escolha, revisão, execução, cancelamento, reboot/retomada, gerenciamento e reparo pela interface.
- Não use apenas uma sequência de comandos no terminal como substituto da validação dos botões.
- No Windows, execute pelo menos uma validação completa da produção sem `suwin`, partindo de VS Code não elevado.
- Documente quais etapas exigiram interação manual com UAC/autenticação.

### 15.3 Repetição mínima

Para cada backend principal declarado suportado em cada plataforma:

- Execute pelo menos **dois ciclos completos** de ambiente limpo → setup → teste funcional → desinstalação do alvo de teste → novo setup.
- No Windows desta tarefa, exija pelo menos **três ciclos por engine**: fluxo normal, interrupção/recuperação e reinstalação final limpa.
- Exercite update e preservação de dados em um ciclo separado quando depender de versões específicas.
- Repita após qualquer correção que afete o caminho exercitado.
- Não use número de ciclos como prova de ausência total de bugs; use cenários e evidências.

Se arquitetura, SO ou provider não tiver cobertura real, mantenha esse ponto identificado como não validado. Não marque a tarefa integralmente concluída sem a cobertura mínima acordada.

## 16. Matriz de cenários obrigatórios

Cada caso aplicável precisa de resultado, ambiente, evidência e observação de dados/cleanup.

| ID | Cenário | Resultado exigido |
| --- | --- | --- |
| T01 | Primeira abertura sem nenhuma ferramenta | Oferta de setup, sem instalação automática. |
| T02 | Podman saudável e nenhuma preferência explícita | Reutilização sugerida, sem pedir Docker desnecessariamente. |
| T03 | Docker saudável e preferência explícita | Configuração preservada; onboarding não interrompe uso. |
| T04 | Docker e Podman coexistindo | Seleção clara, contextos e operações isolados. |
| T05 | CLI instalada e engine parada | Oferece iniciar; não força reinstalação. |
| T06 | CLI/provider Compose ausente ou incompatível | Instala/repara somente o necessário e revalida o provider real. |
| T07 | Custom path inválido ou PATH da sessão desatualizado | Diagnóstico correto, sem apagar configuração nem instalar duplicata. |
| T08 | WSL/virtualização ausente ou requisito de firmware bloqueado | Preflight correto, aprovação e indicação honesta de ações externas. |
| T09 | Reboot necessário | Journal durável; não reinicia automaticamente; retomada sem duplicatas. |
| T10 | UAC aceito em VS Code não elevado | Somente ações administrativas previstas executam elevadas. |
| T11 | UAC cancelado/credenciais recusadas | Estado normal recuperável; zero sucesso falso. |
| T12 | Elevação com outra conta administrativa | Dados/VM continuam pertencendo ao usuário alvo correto. |
| T13 | Autenticação macOS aceita/recusada | Helper/lifecycle correto; sem senha armazenada. |
| T14 | Linux sem Polkit gráfico ou sem TTY | Capacidade detectada; fallback explícito ou bloqueio útil. |
| T15 | Rede offline/proxy/certificado corporativo | Orientação específica; nenhum bypass de TLS. |
| T16 | Download truncado, checksum/assinatura inválida | Artefato rejeitado, sem execução. |
| T17 | Cache de instalador íntegra/corrompida | Reutilização segura ou descarte explícito. |
| T18 | Falta de disco ou instalação bloqueada por outro package manager | Erro claro; sem loop de retries/mutações sobrepostas. |
| T19 | Installer falha após parte do plano | Efeitos reais apresentados; reparo/retomada segura. |
| T20 | Cancelar download, instalação ou inicialização | Sem etapas novas; transação em curso tratada com segurança. |
| T21 | Timeout e processo com estado ainda incerto | Reinspeção; nenhuma repetição automática destrutiva. |
| T22 | Fechar/reabrir painel durante operação | Mesmo job, logs e progresso; sem loading duplicado. |
| T23 | Reload/crash do Extension Host | Estado reconciliado; checkpoints não tratados como prova de sucesso. |
| T24 | Duas janelas VS Code fazendo setup/update | Lock efetivo entre processos; segunda janela não duplica mutação. |
| T25 | Trocar engine/host durante operação | Alvo original preservado; feedback contextual correto. |
| T26 | Windows Docker em WSL e Podman em Machine | Ambos operacionais e sem dependências de Desktop. |
| T27 | macOS Docker em backend gerenciado e Podman em Machine | Lifecycle, sockets, mounts e Compose reais. |
| T28 | Linux rootless e rootful escolhido | Privilégios/configurações corretos e dados separados. |
| T29 | Arquitetura errada ou versão de SO não suportada | Instalação recusada antes de executar artefato. |
| T30 | Rootless sem pré-requisito ou permissão de socket | Diagnóstico e correção limitada; sem `chmod 666`. |
| T31 | Update cliente/server/provider/Compose | Compatibilidade e saúde revalidadas. |
| T32 | Update falha ou rollback não suportado | Dados preservados; limites explicados, sem VM vazia de fallback. |
| T33 | Backup e restore de dados de teste | Dados verificados após restore, não somente arquivo criado. |
| T34 | Uninstall preservando dados seguido de reinstall | Dados sentinela e configurações recuperáveis. |
| T35 | Uninstall com exclusão explícita dos dados de teste | Só alvos autorizados removidos; nenhum recurso pessoal afetado. |
| T36 | Mudar CPU/memória/disco e iniciar/parar/reiniciar | Capabilities corretas; impacto e sucesso verificados. |
| T37 | Workspace não confiável ou mensagem adulterada | Sem execução de binário/script arbitrário nem pedido privilegiado aceito. |
| T38 | Remote SSH/WSL/Dev Container/VS Code Web | Alvo identificado; sem provisionar o computador errado. |
| T39 | Setup adiado e segunda abertura | Não insiste em modal; setup continua acessível. |
| T40 | Máquina lenta e ferramenta sem output por um período | Etapa/tempo visíveis; sem percentual inventado ou erro grave prematuro. |
| T41 | Aviso seguido de recuperação | Aviso correspondente removido; erros de outros contextos preservados. |
| T42 | 16 idiomas, janela estreita/baixa, zoom e teclado | Conteúdo utilizável, rótulos localizados e foco correto. |
| T43 | Desktop ausente e depois preexistente em outro cenário | Independência comprovada e coexistência sem alterações indevidas. |
| T44 | Desinstalar somente a extensão | Nenhuma engine ou dado removido como efeito colateral. |

Para casos não aplicáveis, explique por que são realmente N/A. Host indisponível não é N/A: é teste pendente/bloqueado.

## 17. Teste funcional de cada engine instalada

O estado **Pronto** exige verificação real do caminho que o Studio usa.

Depois de setup/reinstall/update, em fixture isolado e autorizado:

1. Resolver o executável/transporte recém-configurado na mesma sessão da extensão.
2. Verificar versão do cliente e alcançar o backend/server correto.
3. Verificar o provider Compose efetivamente invocado.
4. Criar e iniciar container de uma image pequena e confiável, com versão/digest documentados.
5. Executar comando e ler logs pela extensão.
6. Acessar uma porta publicada em loopback e verificar a resposta esperada.
7. Criar rede própria e testar conectividade/DNS conforme a capacidade do backend.
8. Criar volume nomeado próprio, escrever um dado sentinela, parar/recriar container e confirmar persistência.
9. Verificar proteção de volumes/redes referenciados por containers parados.
10. Fazer build real de uma image de teste, incluindo um projeto com build pelo Compose.
11. Executar um projeto Compose pequeno com pelo menos dois serviços e uma dependência.
12. Exercitar os fluxos existentes de override/profile/env file e paths com espaços.
13. Testar start/stop/restart, logs, execução e ações relevantes pela interface.
14. Parar/remover somente os fixtures e verificar inventário final.
15. Executar update/reinstall com preservação de dados e confirmar o sentinela quando aplicável.

Regras:

- Não substitua falha real por mocks para concluir o cenário.
- Uma image/volume de teste deve ter identidade própria; não use workloads pessoais.
- Um container "exited" não prova serviço saudável.
- Publicar uma porta não prova forwarding: faça a requisição.
- `compose version` não prova `compose up/build`: exercite ambos.
- Um volume existente não prova seus dados preservados: leia o sentinela.
- Listar recursos pelo CLI não prova integração com os botões do Studio.
- Execute sem aplicativos Desktop instalados/rodando no cenário de independência, em host isolado adequado.
- Smoke test que precisa baixar image ou modificar recursos exige consentimento dentro do produto; ofereça validação não mutante quando o usuário recusar.
- Se a validação mutante foi recusada, apresente claramente o nível de verificação atingido, sem declarar esse teste concluído.

## 18. Qualidade de engenharia e critérios mensuráveis

### 18.1 Implementação

- Contratos tipados, sem `as any` para mascarar incompatibilidades.
- Erros estruturados com contexto e detalhes, sem catches amplos que retornam sucesso/estado vazio.
- Módulos pequenos e específicos; evite um framework genérico de installers sem consumidores reais.
- Helpers de execução e streams reaproveitados onde seguros, sem duplicar parsers/timeouts/redaction.
- Código de elevação isolado do código de runtime e de YAML/Compose.
- Timers, processos, watchers e handlers com lifecycle e cleanup explícitos.
- Instalação não pode bloquear o event loop ou congelar o VS Code.
- Estado e logs devem ser limitados; documente limites e comportamento de truncamento.
- Dependências nativas, se necessárias, precisam de justificativa, manutenção, build e artefatos por plataforma/arquitetura.
- Fontes, licenças, assinatura e requisitos de distribuição devem ser documentados.

### 18.2 Medições mínimas

- Probes individuais não podem exceder seu budget sem estado de timeout/cancelamento.
- A UI deve reconhecer imediatamente uma ação longa antes de iniciar trabalho externo.
- Download com tamanho conhecido deve mostrar bytes medidos; sem tamanho conhecido, etapa e atividade.
- Reabrir o painel deve manter exatamente uma representação ativa de cada job.
- Não pode haver mais de uma mutação conflitante por host/engine/recurso, mesmo em duas janelas.
- Cancelamento, reload e término devem deixar zero helper/processo de teste órfão, ou uma falha de cleanup explicitamente registrada.
- Nenhum segredo nos logs/diagnósticos/snapshots/artefatos de teste.
- Zero aviso de sucesso antes das pós-condições verdadeiras.
- Registre timings reais de setup, update e recuperação na máquina lenta, identificando hardware/backend e limites.
- Não reduza arbitrariamente um timeout só para acelerar testes, nem aumente indefinidamente para esconder deadlock.

### 18.3 Validação do repositório

Use os comandos existentes e acrescente somente os testes relacionados:

```powershell
npx --no-install tsc --noEmit
npm test
npm run build:all
git diff --check
```

Para a UI responsiva no Windows, conforme `CONTRIBUTING.md`:

```powershell
$env:STUDIO_BROWSER_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node --test tests\responsive-layout.test.cjs
```

O Chrome nesse comando é apenas o exemplo do ambiente atual. Escolha um Chromium existente e documentado em outros hosts.

Rode os testes opt-in de Podman já existentes e acrescente equivalentes reais para os fluxos Docker/setup/update quando necessários. O suite normal não cobre reinstalação de ferramentas por si só.

Faça build e teste do VSIX instalado em um perfil isolado. Verifique que o pacote contém os helpers/artefatos corretos e não depende de código-fonte ou ferramentas do computador de desenvolvimento.

## 19. Entregáveis obrigatórios

| Entregável | Conteúdo mínimo |
| --- | --- |
| Descoberta de ambiente | Inventário tipado, host correto, capacidades, versões, origem e diagnósticos específicos. |
| Setup Wizard | Fluxo funcional completo, revisão de plano, consentimento, progresso, cancelamento e validação real. |
| Adapters de plataforma | Windows, macOS e Linux com receitas verificadas e capacidades explícitas. |
| Integração de runtime | Docker/Podman instalados realmente utilizáveis por todos os fluxos principais do Studio. |
| Elevação | Broker/helper mínimo e autenticação legítima por plataforma, sem dependência de `suwin`. |
| Operações duráveis | Journal, retomada, locks entre janelas, checkpoints e reconciliação de estado. |
| Engine Manager | Lifecycle, conexão, recursos, diagnóstico, updates, repair e uninstall conforme suporte real. |
| Preservação de dados | Inventário, backups necessários, restore exercitado e destruição explicitamente autorizada. |
| Feedback e localização | Resumos úteis, logs separados, recuperação contextual e todos os 16 idiomas. |
| Testes | Unitários, contratos, UI, VS Code real e ciclos de instalação/update/reinstall em hosts apropriados. |
| Evidências | Matriz preenchida, versões/ambientes, logs sanitizados, capturas reais e resultados reproduzíveis. |
| Documentação | README, CONTRIBUTING, changelog e documentação do setup/suporte/limitações/segurança relacionada. |
| Distribuição | VSIX verificado, artefatos corretos, plano de assinatura/notarização e licenças pertinentes. |
| Handoff final | Implementado, testado, não testado, bloqueios, recursos restantes e riscos conhecidos. |

Não torne o prompt interno ou os artefatos de testes uma dependência runtime. Evidências privadas/sanitizadas podem ficar na área de artefatos da sessão; não publique dados pessoais no repositório.

O objetivo não inclui publicar uma release, abrir PR, fazer commit/push ou escolher uma nova versão automaticamente. Essas operações exigem autorização específica para a implementação correspondente. Preserve a autoria configurada e não acrescente coautoria não solicitada.

## 20. Plano de execução da futura implementação

### Fase 1: investigação e desenho verificável

- Inspecione o código existente, os providers e o ambiente sem mutações.
- Liste lacunas, integrações afetadas e decisões necessárias.
- Verifique documentação atual e versões/receitas suportadas.
- Apresente a matriz de plataforma, o fluxo de elevação, o transporte Docker Windows/macOS e o plano de dados/testes.
- Solicite apenas decisões que alteram materialmente segurança, backend, dados, suporte ou privilégio.
- Não reinstale ferramentas enquanto inventário e limites não estiverem estabelecidos.

### Fase 2: descoberta e onboarding sem mutações

- Implemente estados, deteção e primeira abertura.
- Preserve configuração existente, workspace trust, hosts e engines independentes.
- Adicione unitários, contratos e UI para os cenários de descoberta.

### Fase 3: plano, execução segura e elevação

- Implemente plano imutável, aprovação, journal e locks.
- Implemente download/integridade e as ações privilegiadas mínimas.
- Teste cancelamento, recusa, entrada malformada e recuperação antes de instalações reais.

### Fase 4: setup funcional por plataforma

- Termine uma cadeia de instalação utilizável por vez.
- Valide pelo VS Code real e pelos testes funcionais da seção 17.
- Implemente os demais adapters sem mascarar limitações.
- Não marque uma plataforma concluída porque o código compila em outro SO.

### Fase 5: gerenciamento e manutenção

- Integre lifecycle, recursos, update, repair e uninstall ao System & Engine.
- Teste compatibilidade, preservação, rollback suportado e coexistência.
- Garanta paridade com as ações atuais de runtime e Compose.

### Fase 6: repetição, falhas e polimento

- Execute os ciclos e a matriz de testes.
- Teste máquina lenta, UAC/autenticação real, reload, reboot, duas janelas e feedback recuperado.
- Complete acessibilidade, idiomas, responsividade e temas.
- Corrija a causa dos problemas e repita os cenários afetados.

### Fase 7: distribuição e handoff

- Verifique builds/testes, VSIX, helpers, documentação e limpeza dos fixtures.
- Entregue evidências e limites honestos.
- Liste bloqueios de hosts/assinatura/testes sem declarar suporte definitivo ou publicação.

## 21. Checklist de aceite final

Marque cada item apenas com evidência suficiente:

- [ ] A primeira abertura diferencia configuração existente, engine parada, componente ausente e ambiente não suportado.
- [ ] Setup pode ser adiado e reaberto; não reinstala nem insiste em cada abertura.
- [ ] O plano de instalação é revisável, identifica o host e exige consentimento antes das mutações.
- [ ] Docker e Podman funcionam sem depender dos aplicativos Desktop nos cenários declarados.
- [ ] Windows, macOS e Linux têm adapters reais e a matriz de suporte/validação está explícita.
- [ ] A engine recém-instalada é utilizável pelo Studio, incluindo Compose, builds, logs, mounts e terminal.
- [ ] UAC/autenticação legítima é exercitada com sucesso e recusa; `suwin` não é uma dependência de produção.
- [ ] Nenhuma senha/secret é capturada ou armazenada indevidamente.
- [ ] Download e execução de artefatos possuem cadeia de confiança e validação apropriada.
- [ ] Reinicialização, reload, cancelamento, timeout e estados parciais têm recuperação comprovada.
- [ ] Duas janelas não executam mutações conflitantes nem duplicam jobs.
- [ ] Engine Manager administra somente recursos/capacidades que consegue suportar de verdade.
- [ ] Updates preservam dados e verificam compatibilidade e saúde após aplicação.
- [ ] Backup e restore são testados quando necessários ao procedimento.
- [ ] Desinstalação é explícita, respeita titularidade e não remove dados por padrão.
- [ ] Ciclos repetidos de instalação/reinstalação foram executados com inventário e cleanup.
- [ ] A matriz T01–T44 está preenchida com evidências ou bloqueios honestos.
- [ ] Testes normais, responsivos e VS Code real passaram nas superfícies modificadas.
- [ ] Todos os 16 idiomas, teclado, temas e janelas estreitas/baixas permanecem utilizáveis.
- [ ] Sucesso, erro, aviso e progresso refletem o estado real; recuperação não deixa avisos obsoletos.
- [ ] Nenhum recurso pessoal foi removido ou afetado como consequência dos testes.
- [ ] O VSIX instalado funciona sem depender do ambiente de desenvolvimento.
- [ ] Limitações de plataforma, políticas, assinaturas e suporte estão documentadas.
- [ ] Não existe publicação, commit/push ou alegação de validação além do que foi autorizado e comprovado.

Se um requisito obrigatório ficar bloqueado, entregue a parte implementada com o bloqueio explícito. Não marque a tarefa como integralmente concluída e não use "100%" como substituto de evidência.

## 22. Formato do relatório final

Ao terminar a implementação, responda em português com:

1. O que agora funciona de ponta a ponta.
2. Quais engines, hosts, SOs, arquiteturas, providers e versões foram testados **na prática**.
3. Matriz dos testes, incluindo aprovação, falha, bloqueio e N/A justificado.
4. Resultados dos ciclos de reinstall/update/restore e comportamento de dados sentinela.
5. Resultados de UAC/autenticação real, distinguindo testes com `suwin`.
6. Evidências consultáveis e comandos de validação reproduzíveis.
7. Limitações, pendências, assinatura/notarização e plataformas ainda não verificadas.
8. Recursos/processos/arquivos temporários que permaneceram, se houver, e motivo.
9. Estado real da distribuição: apenas build, VSIX instalado, testes concluídos ou release autorizada.

Não alegue que todos os sistemas operacionais foram testados se só Windows estava disponível. Não esconda testes pulados nem fallbacks. Não use capturas de uma UI com dados simulados como prova de instalação real.

## 23. Fontes primárias e verificação de atualidade

As referências abaixo foram consultadas na elaboração deste prompt. Revalide-as antes de definir receitas, flags, versões e providers: documentação `latest` e métodos de instalação mudam.

- [Instalação de Docker Engine](https://docs.docker.com/engine/install/) — distinguir engine Linux, pacotes de distribuição e alternativas com backend Linux.
- [Instalação do plugin Docker Compose](https://docs.docker.com/compose/install/linux/) — Compose é um componente separado, com origem e atualização próprias.
- [Instalação do Podman](https://podman.io/docs/installation) — recomendações por plataforma e uso de uma guest Linux em Windows/macOS.
- [Podman Machine](https://docs.podman.io/en/latest/markdown/podman-machine.1.html) — providers, lifecycle e limites das máquinas.
- [WSL: instalação e pré-requisitos](https://learn.microsoft.com/en-us/windows/wsl/install) — recursos, versões de Windows e necessidade de restart.
- [Colima: projeto e runtime Docker](https://github.com/abiosoft/colima) — opção de backend Linux sem Docker Desktop no macOS.
- [ShellExecute/ShellExecuteEx](https://learn.microsoft.com/en-us/windows/win32/shell/launch) — referência Win32 para lançamento; consulte também a API específica de elevação.
- [Authorization Services da Apple](https://developer.apple.com/library/archive/documentation/Security/Conceptual/authorization_concepts/01introduction/introduction.html) — referência conceitual arquivada; valide mecanismos atuais de deployment e APIs antes de implementar.
- [Polkit/`pkexec`](https://www.freedesktop.org/software/polkit/docs/latest/pkexec.1.html) — autenticação, ambiente e necessidade de validação dos argumentos.

Estas referências ajudam a fundamentar o desenho; não provam que uma combinação foi testada ou que um produto possui certificação/suporte empresarial.

**Inicie pela investigação e pelo inventário somente leitura. Implemente com limites claros, teste o resultado exato e preserve os dados. A entrega é uma solução operacional verificável, não a aparência de um setup bem-sucedido.**
