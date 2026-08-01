// Pool de legendas automáticas para postagens — temas livres em PT-BR otimizadas para Instagram.
// Estrutura baseada no padrão mais usado por contas do mesmo nicho: lista numerada (1️⃣2️⃣3️⃣)
// ou gancho/POV + frase + contraste curto, sempre fechando com CTA e hashtags relacionadas ao texto.
// Regras de estilo: sem travessão (—), sem se prender a um único assunto, tom natural.

export type AutoCaptionType =
  | "curiosidades-gerais"
  | "curiosidades-tops"
  | "fatos-complexos"
  | "variado";

// Mantido por compatibilidade com o CHECK constraint das colunas auto_caption_type
// (loops, automations, distribute_campaigns) e com a validação em app/api/campaigns/route.ts.
// Não há mais seleção de categoria na UI — qualquer um desses ids aponta pro mesmo pool.
export const AUTO_CAPTION_TYPES = [
  {
    id: "curiosidades-gerais" as AutoCaptionType,
    label: "Legendas Automáticas",
    emoji: "✨",
    desc: "Temas livres, sorteadas por post",
  },
] as const;

// ---------------------------------------------------------------------------
// Pool único — temas livres, sem categorização
// ---------------------------------------------------------------------------

const CAPTIONS: string[] = [
  // Produtividade / foco
  "3 atitudes de quem tem produtividade real:\n\n1️⃣ Priorizar, não preencher agenda.\n2️⃣ Dormir antes de trabalhar.\n3️⃣ Eliminar antes de delegar.\n\nSalva pra reler quando precisar.\n\n#produtividade #foco #rotina",
  "3 hábitos de quem termina o que começa:\n\n1️⃣ Define uma única prioridade por dia.\n2️⃣ Desliga notificação enquanto executa.\n3️⃣ Revisa antes de adicionar tarefa nova.\n\nComenta qual desses falta na sua rotina.\n\n#produtividade #disciplina #foco",
  "Isso vai mudar sua relação com a agenda 🎯\n\nAgenda cheia não é sinônimo de dia produtivo.\n\nÉ sinal de falta de prioridade.\nMenos tarefas, mais entrega.\n\n#produtividade #rotina #foco",
  "3 coisas que roubam seu foco sem você perceber:\n\n1️⃣ Trocar de aba a cada 2 minutos.\n2️⃣ Responder mensagem na hora que chega.\n3️⃣ Começar o dia sem saber a prioridade.\n\nMarca alguém que precisa ler isso.\n\n#foco #produtividade #trabalho",
  "POV: você aprendeu a dizer não pra tarefa que não é sua 🎯\n\nToda tarefa aceita é uma prioridade recusada.\n\nProteja sua agenda, ela é o seu recurso mais caro.\n\n#produtividade #limites #foco",
  "3 sinais de que você trabalha demais e produz de menos:\n\n1️⃣ Está sempre ocupado, raramente termina algo.\n2️⃣ Confunde estar cansado com estar produzindo.\n3️⃣ Não sabe dizer o que fez de importante hoje.\n\nSalva pra revisar sua semana.\n\n#produtividade #burnout #rotina",
  "Ninguém te ensinou isso sobre tempo 🕐\n\nO problema raramente é falta de tempo.\n\nÉ falta de prioridade clara.\nOrganize antes de correr.\n\n#produtividade #tempo #foco",
  "3 hábitos de manhã de quem rende mais o dia todo:\n\n1️⃣ Não olha o celular nos primeiros 30 min.\n2️⃣ Escreve as 3 prioridades do dia.\n3️⃣ Começa pela tarefa mais difícil.\n\nGuarda isso pra amanhã de manhã.\n\n#produtividade #rotina #manha",
  "3 mentiras que a procrastinação te conta:\n\n1️⃣ 'Depois eu faço com mais calma.'\n2️⃣ 'Preciso estar inspirado pra começar.'\n3️⃣ 'Ainda dá tempo.'\n\nComenta qual dessas você já ouviu de si mesmo.\n\n#produtividade #procrastinacao #foco",
  "Isso separa quem executa de quem só planeja 🎯\n\nPlanejar sem agir é só ansiedade organizada.\n\nComece pequeno, ação gera clareza que o planejamento sozinho não dá.\n\n#produtividade #execucao #mentalidade",

  // Dinheiro / finanças
  "3 hábitos de quem constrói patrimônio de verdade:\n\n1️⃣ Investe antes de gastar o que sobra.\n2️⃣ Tem reserva antes de qualquer desejo.\n3️⃣ Registra pra onde o dinheiro vai.\n\nSalva pra revisar todo mês.\n\n#financas #dinheiro #investimentos",
  "Ninguém te ensinou isso na escola 💰\n\nDinheiro que entra e some não é falta de sorte.\n\nÉ falta de plano.\nÉ falta de meta.\nCrie as duas coisas.\n\n#educacaofinanceira #dinheiro #mentalidade",
  "3 sinais de que você tem uma relação saudável com dinheiro:\n\n1️⃣ Sabe exatamente quanto gasta por mês.\n2️⃣ Compra com plano, não com impulso.\n3️⃣ Guarda antes de gastar, não o contrário.\n\nComenta em qual desses você ainda precisa evoluir.\n\n#financas #dinheiro #educacaofinanceira",
  "POV: você parou de comprar coisa pra impressionar gente que nem gosta de você 💸\n\nStatus que se paga em 12x não é riqueza.\n\nÉ dívida disfarçada, gaste com o que constrói.\n\n#dinheiro #financas #mentalidade",
  "3 coisas que ricos fazem diferente de quem só parece rico:\n\n1️⃣ Investem no silêncio, gastam pouco à vista.\n2️⃣ Compram ativo, não aparência.\n3️⃣ Têm paciência pro dinheiro trabalhar sozinho.\n\nMarca alguém que precisa ver isso.\n\n#dinheiro #investimentos #riqueza",
  "Isso muda como você enxerga salário 💰\n\nRenda alta sem controle vira pobreza disfarçada.\n\nO problema não é quanto entra, é pra onde vai.\n\n#financas #dinheiro #educacaofinanceira",
  "3 hábitos que sabotam sua reserva de emergência:\n\n1️⃣ Deixar o 'sobra' pro fim do mês.\n2️⃣ Misturar reserva com dinheiro do dia a dia.\n3️⃣ Usar o cartão como extensão do salário.\n\nSalva pra corrigir ainda esse mês.\n\n#reservaemergencia #financas #dinheiro",
  "POV: você entendeu que juro composto trabalha melhor com tempo do que com valor alto 📈\n\nComeçar pequeno e cedo vale mais que começar tarde e grande.\n\nO tempo é o verdadeiro investidor.\n\n#investimentos #dinheiro #financas",
  "3 perguntas antes de qualquer compra parcelada:\n\n1️⃣ Eu compraria isso à vista?\n2️⃣ Isso resolve um problema ou só um desejo?\n3️⃣ Eu ainda vou querer isso daqui 1 mês?\n\nComenta se você já ia comprar algo por impulso essa semana.\n\n#dinheiro #consumo #financas",
  "Isso aqui é sério sobre dinheiro 💰\n\nQuem não sabe pra onde o dinheiro vai, nunca vai saber por que ele acaba.\n\nAnote por 30 dias e depois me conta o que descobriu.\n\n#financas #dinheiro #educacaofinanceira",

  // Relacionamentos / amor
  "3 hábitos de relacionamento que duram:\n\n1️⃣ Falar o que incomoda sem indireta.\n2️⃣ Resolver o conflito, não vencer a discussão.\n3️⃣ Respeitar o tempo do outro.\n\nManda pra alguém que constrói algo bonito com você.\n\n#relacionamento #amor #vinculos",
  "POV: você percebeu que amor não sustenta relação sozinho 🪞\n\nRespeito, comunicação e escolha diária é que sustentam.\n\nAmor é o começo, não o suficiente.\n\n#relacionamento #amor #maturidade",
  "3 sinais de que a relação é saudável:\n\n1️⃣ Você continua se sentindo você mesmo.\n2️⃣ Discordar não vira punição.\n3️⃣ Silêncio junto também é confortável.\n\nSalva pra usar como referência.\n\n#relacionamento #amor #vinculos",
  "Ninguém te contou isso sobre relacionamento 💬\n\nParceiro não é terapeuta nem leitor de mente.\n\nDiga o que sente, clareza evita ressentimento.\n\n#relacionamento #comunicacao #amor",
  "3 coisas que destroem relação aos poucos:\n\n1️⃣ Guardar mágoa em vez de conversar.\n2️⃣ Competir em vez de somar.\n3️⃣ Comparar com o relacionamento dos outros.\n\nComenta qual desses você já viveu.\n\n#relacionamento #amor #vinculos",
  "Isso vai te fazer repensar seus vínculos 🪞\n\nRelação que só exige e nunca sustenta, cansa.\n\nAmor recíproco não pesa, amor desequilibrado sim.\n\n#relacionamento #amor #autoestima",
  "3 atitudes de quem ama com maturidade:\n\n1️⃣ Não usa o passado como arma.\n2️⃣ Pede desculpa sem esperar retribuição.\n3️⃣ Escolhe todo dia, não só no início.\n\nMarca quem faz isso por você.\n\n#relacionamento #maturidade #amor",
  "POV: você aprendeu a diferença entre amar e precisar 🪞\n\nQuem precisa tem medo de perder.\n\nQuem ama tem liberdade de ficar. Escolha, não dependa.\n\n#relacionamento #amorproprio #maturidade",
  "3 frases que evitam brigas desnecessárias:\n\n1️⃣ 'Isso me incomodou, posso falar?'\n2️⃣ 'Não é isso que eu quis dizer.'\n3️⃣ 'Vamos resolver, não discutir.'\n\nSalva pra usar na próxima discussão.\n\n#relacionamento #comunicacao #amor",
  "Isso muda toda relação que você tiver depois 🪞\n\nVocê ensina as pessoas a te tratar pelo que você aceita.\n\nRevise seus limites, eles definem o padrão.\n\n#relacionamento #limites #autoestima",

  // Autoestima / amor próprio
  "3 lembretes pra quando amor próprio parecer distante:\n\n1️⃣ Não trocar paz por elogio.\n2️⃣ Não trocar limite por aprovação.\n3️⃣ Não trocar verdade por aplauso.\n\nSalva pra reler sempre que precisar.\n\n#amorproprio #autoestima #maturidade",
  "POV: você se libertou da vontade de agradar todo mundo 🪞\n\nAgradar todos é desagradar você.\n\nEscolhe quem cuidar, você inclusive.\n\n#amorproprio #autoestima #limites",
  "3 sinais de que sua autoestima está se fortalecendo:\n\n1️⃣ Você aceita elogio sem minimizar.\n2️⃣ Erra e segue sem se destruir por dentro.\n3️⃣ Não pede desculpa por existir do seu jeito.\n\nComenta qual desses já é seu.\n\n#autoestima #amorproprio #crescimentopessoal",
  "Ninguém te ensinou isso sobre se cuidar 🪞\n\nCuidar de si não é egoísmo.\n\nÉ pré-requisito, você só sustenta o que dá quando se sustenta primeiro.\n\n#amorproprio #autocuidado #autoestima",
  "3 hábitos de quem tem autoestima alta:\n\n1️⃣ Fala de si sem se diminuir.\n2️⃣ Aceita cuidado sem achar que não merece.\n3️⃣ Comemora conquista pequena também.\n\nMarca alguém que precisa ler isso hoje.\n\n#autoestima #amorproprio #mentalidade",
  "Isso vai bater fundo se você já se cobrou demais 🪞\n\nSe cobrar não é o mesmo que se cuidar.\n\nUma constrói, a outra destrói. Escolhe construir.\n\n#amorproprio #saudemental #autoestima",
  "3 coisas que amor próprio de verdade não faz:\n\n1️⃣ Não espera aprovação alheia pra existir.\n2️⃣ Não se compara pra se sentir suficiente.\n3️⃣ Não aceita qualquer tratamento por medo de ficar só.\n\nSalva pra lembrar quando duvidar de si.\n\n#amorproprio #autoestima #limites",
  "POV: você entendeu que se colocar em primeiro lugar não é vaidade 🪞\n\nÉ sobrevivência emocional.\n\nVocê não pode dar o que não tem, comece dando pra você.\n\n#amorproprio #autoestima #saudemental",
  "3 frases pra repetir quando a autocrítica exagerar:\n\n1️⃣ 'Eu fiz o melhor com o que sabia.'\n2️⃣ 'Errar não apaga o que já construí.'\n3️⃣ 'Eu posso ser gentil comigo também.'\n\nComenta se você precisava ler isso hoje.\n\n#amorproprio #autoestima #saudemental",
  "Isso aqui é sobre parar de se abandonar 🪞\n\nVocê sustenta os outros, mas esquece de sustentar você.\n\nCuidar de si não é depois, é agora.\n\n#amorproprio #autocuidado #autoestima",

  // Sono / saúde física
  "3 hábitos de quem dorme bem de verdade:\n\n1️⃣ Larga o celular 30 min antes de deitar.\n2️⃣ Mantém o mesmo horário todo dia.\n3️⃣ Evita cafeína depois das 16h.\n\nManda pra quem vive reclamando que não dorme direito.\n\n#sono #saude #bemestar",
  "Curiosidade que vai te marcar 🧠\n\nPessoas que dormem 30 minutos a mais por noite são mais produtivas.\n\nSono não é tempo perdido.\nÉ construção.\nPriorize.\n\nComenta o que mais te surpreendeu.\n\n#sono #produtividade #saude",
  "3 sinais de que seu corpo está pedindo descanso:\n\n1️⃣ Irritação sem motivo aparente.\n2️⃣ Dificuldade de foco no básico.\n3️⃣ Vontade de dormir o dia todo no fim de semana.\n\nSalva pra prestar atenção nisso.\n\n#saude #descanso #bemestar",
  "Isso vai mudar como você vê seu corpo 🧠\n\nSeu cérebro gasta 20% de toda sua energia, mesmo parado.\n\nDescansar não é preguiça.\nÉ manutenção.\n\n#saude #descanso #curiosidades",
  "3 hábitos simples que melhoram sua disposição:\n\n1️⃣ Beber água antes do café.\n2️⃣ Tomar sol pela manhã, mesmo 10 minutos.\n3️⃣ Se mexer antes de olhar tela.\n\nMarca alguém que anda sem energia.\n\n#saude #bemestar #rotina",
  "Ninguém te contou isso sobre cansaço 💤\n\nCansaço mental também é cansaço físico.\n\nSeu corpo não separa os dois, descanse a mente também.\n\n#saude #saudemental #bemestar",
  "3 coisas que sabotam seu sono sem você perceber:\n\n1️⃣ Dormir tarde por 'mais um episódio'.\n2️⃣ Cochilar demais durante o dia.\n3️⃣ Levar problema do dia pra cama.\n\nComenta qual desses é sua rotina.\n\n#sono #saude #rotina",
  "POV: você entendeu que corpo cansado não sustenta mente forte 💤\n\nAntes de cobrar mais produtividade de você, cobre mais descanso.\n\nA base vem primeiro.\n\n#saude #descanso #produtividade",
  "3 hábitos de quem tem energia o dia todo:\n\n1️⃣ Café da manhã com proteína, não só carboidrato.\n2️⃣ Pausa a cada 90 minutos de trabalho.\n3️⃣ Água por perto o tempo todo.\n\nSalva pra testar amanhã.\n\n#saude #energia #bemestar",
  "Isso aqui é sobre parar de romantizar o cansaço 💤\n\nAcordar exausto todo dia não é dedicação.\n\nÉ sinal de alerta, seu corpo está pedindo ajuda.\n\n#saude #saudemental #bemestar",

  // Saúde mental / ansiedade
  "Você sabia? 🤔\n\nPessoas que assistem menos notícia têm menos ansiedade.\n\nNão significa alienação.\nSignifica filtro.\nCuide do que entra.\n\nSalva pra mostrar pra alguém depois.\n\n#saudemental #ansiedade #bemestar",
  "3 hábitos que reduzem ansiedade no dia a dia:\n\n1️⃣ Respirar fundo antes de reagir.\n2️⃣ Diminuir tempo de rolagem no celular.\n3️⃣ Nomear o que está sentindo, em vez de evitar.\n\nComenta qual desses você já pratica.\n\n#saudemental #ansiedade #bemestar",
  "Isso vai te ajudar a lidar com dias difíceis 🧠\n\nVocê não precisa dar conta de tudo hoje.\n\nUm passo de cada vez já é suficiente.\n\n#saudemental #ansiedade #bemestar",
  "3 sinais de que você precisa desacelerar:\n\n1️⃣ Irritação constante com coisas pequenas.\n2️⃣ Dificuldade de relaxar mesmo parado.\n3️⃣ Sensação de estar sempre atrasado.\n\nMarca quem precisa ler isso hoje.\n\n#saudemental #ansiedade #descanso",
  "POV: você entendeu que sentir tudo intensamente não é fraqueza 🧠\n\nÉ sinal de sensibilidade, não de defeito.\n\nAprenda a lidar com isso, não a se culpar por isso.\n\n#saudemental #saudeemocional #autoconhecimento",
  "3 coisas que ajudam mais que 'pensamento positivo forçado':\n\n1️⃣ Aceitar o que você está sentindo de verdade.\n2️⃣ Buscar ajuda quando precisar.\n3️⃣ Ter rotina, mesmo em dias ruins.\n\nSalva pra lembrar disso.\n\n#saudemental #ansiedade #bemestar",
  "Ninguém te contou isso sobre autocuidado emocional 🧠\n\nChorar não é fraqueza.\n\nÉ o corpo processando o que a mente ainda não organizou.\n\n#saudemental #saudeemocional #bemestar",
  "3 hábitos de quem cuida da mente todo dia:\n\n1️⃣ Escreve o que sente, mesmo sem solução.\n2️⃣ Pede ajuda antes de estourar.\n3️⃣ Descansa sem culpa.\n\nComenta qual falta na sua rotina.\n\n#saudemental #autocuidado #bemestar",
  "Isso aqui pode salvar o seu dia 🧠\n\nVocê não precisa estar bem o tempo todo pra merecer coisas boas.\n\nDias ruins também fazem parte.\n\n#saudemental #saudeemocional #bemestar",
  "3 perguntas pra fazer antes de entrar em pânico:\n\n1️⃣ Isso é urgente ou só parece?\n2️⃣ O que está no meu controle agora?\n3️⃣ Daqui um ano isso ainda vai importar?\n\nSalva pra usar na próxima crise de ansiedade.\n\n#ansiedade #saudemental #bemestar",

  // Hábitos / disciplina
  "3 hábitos que mudam qualquer rotina:\n\n1️⃣ Acordar no mesmo horário, inclusive fim de semana.\n2️⃣ Planejar o dia antes de abrir o celular.\n3️⃣ Fechar o dia revisando o que foi feito.\n\nSalva pra aplicar amanhã.\n\n#habitos #disciplina #rotina",
  "POV: você entendeu que disciplina não depende de motivação 💪\n\nMotivação vai e volta.\n\nDisciplina te sustenta quando ela some.\n\n#disciplina #habitos #mentalidade",
  "3 sinais de que um hábito virou parte de você:\n\n1️⃣ Você faz mesmo sem vontade.\n2️⃣ Sente falta quando não faz.\n3️⃣ Já nem pensa, só faz.\n\nComenta qual hábito assim você já construiu.\n\n#habitos #disciplina #rotina",
  "Isso muda como você constrói hábito novo 💪\n\nComeçar pequeno demais parece bobo.\n\nMas é o pequeno que se sustenta, grande demais você abandona.\n\n#habitos #disciplina #mentalidade",
  "3 coisas que atrapalham qualquer hábito novo:\n\n1️⃣ Querer perfeição desde o primeiro dia.\n2️⃣ Depender só de força de vontade.\n3️⃣ Não ter um horário fixo pra fazer.\n\nMarca quem está tentando criar um hábito novo.\n\n#habitos #disciplina #rotina",
  "Ninguém te contou isso sobre constância 💪\n\nConstância não é fazer muito uma vez.\n\nÉ fazer pouco, sempre. O tempo faz o resto.\n\n#disciplina #habitos #mentalidade",
  "3 hábitos de quem não desiste no meio do caminho:\n\n1️⃣ Foca no processo, não só no resultado.\n2️⃣ Aceita dia ruim sem abandonar tudo.\n3️⃣ Revisa a meta, não a decisão de continuar.\n\nSalva pra reler quando bater vontade de desistir.\n\n#disciplina #habitos #mentalidade",
  "Isso aqui explica por que hábito novo é difícil no começo 💪\n\nSeu cérebro prefere o que já conhece, mesmo que não sirva mais.\n\nDesconforto no início é normal, não é sinal de que está errado.\n\n#habitos #disciplina #mentalidade",
  "3 perguntas pra revisar seus hábitos hoje:\n\n1️⃣ Isso me aproxima ou me afasta do que eu quero?\n2️⃣ Eu faria isso se ninguém visse?\n3️⃣ Daqui 1 ano, esse hábito ainda faz sentido?\n\nComenta o que você vai mudar essa semana.\n\n#habitos #disciplina #crescimentopessoal",
  "POV: você trocou perfeição por consistência 💪\n\nFazer 80% todo dia vale mais que 100% de vez em quando.\n\nConsistência ganha de intensidade.\n\n#disciplina #habitos #mentalidade",

  // Maturidade / crescimento pessoal
  "3 sinais de que você amadureceu de verdade:\n\n1️⃣ Parou de responder toda provocação.\n2️⃣ Aprendeu a dizer não sem se justificar demais.\n3️⃣ Escolhe suas batalhas.\n\nSalva pra lembrar disso na próxima vez que alguém te testar.\n\n#maturidade #crescimentopessoal #autoconhecimento",
  "Isso vai mudar como você lida com crítica 🌱\n\nNem toda opinião sobre você merece uma reação.\n\nAlgumas só merecem silêncio, escolha bem.\n\n#maturidade #crescimentopessoal #mentalidade",
  "3 coisas que separam quem evolui de quem estagna:\n\n1️⃣ Aceita feedback sem se defender.\n2️⃣ Age antes de se sentir 100% pronto.\n3️⃣ Revisa o próprio erro sem se punir.\n\nComenta qual desses você mais precisa treinar.\n\n#crescimentopessoal #mentalidade #evolucao",
  "Ninguém te contou isso sobre crescer 🌱\n\nCrescer dói porque exige soltar quem você já não é mais.\n\nDesconforto às vezes é sinal de evolução, não de erro.\n\n#crescimentopessoal #maturidade #mentalidade",
  "3 atitudes de quem tem inteligência emocional:\n\n1️⃣ Sente a raiva sem agir por impulso.\n2️⃣ Ouve antes de concluir.\n3️⃣ Assume erro sem procurar culpado.\n\nMarca alguém com essa maturidade.\n\n#inteligenciaemocional #maturidade #crescimentopessoal",
  "POV: você parou de levar tudo pro lado pessoal 🌱\n\nNem toda reação dos outros é sobre você.\n\nMuitas vezes é só o dia ruim de alguém.\n\n#maturidade #inteligenciaemocional #mentalidade",
  "3 sinais de inteligência emocional em ação:\n\n1️⃣ Pede desculpa sem esperar nada em troca.\n2️⃣ Aceita não saber tudo.\n3️⃣ Comemora o sucesso alheio sem se comparar.\n\nSalva pra treinar isso essa semana.\n\n#inteligenciaemocional #maturidade #crescimentopessoal",
  "Isso aqui é maturidade de verdade 🌱\n\nDiscordar sem precisar destruir quem pensa diferente.\n\nRespeito não exige concordância.\n\n#maturidade #inteligenciaemocional #mentalidade",
  "3 hábitos de quem lida bem com frustração:\n\n1️⃣ Aceita o que não pode controlar.\n2️⃣ Age no que pode mudar.\n3️⃣ Não confunde frustração com fracasso.\n\nComenta se você já treinou isso hoje.\n\n#maturidade #resiliencia #mentalidade",
  "Isso vai bater fundo se você já foi muito duro consigo 🌱\n\nCrescer não é nunca errar.\n\nÉ errar diferente a cada vez.\n\n#crescimentopessoal #maturidade #autoconhecimento",

  // Comunicação / limites
  "3 frases pra estabelecer limite sem culpa:\n\n1️⃣ 'Eu não vou conseguir dessa vez.'\n2️⃣ 'Isso não funciona pra mim.'\n3️⃣ 'Preciso pensar antes de responder.'\n\nSalva pra usar na próxima vez que precisar dizer não.\n\n#limites #comunicacao #autoestima",
  "POV: você aprendeu que dizer não também é cuidado 🗣️\n\nCada sim forçado é um pedaço de você que você entrega sem querer.\n\nAprenda a escolher.\n\n#limites #autoestima #maturidade",
  "3 sinais de que você não tem limites claros:\n\n1️⃣ Diz sim com raiva por dentro.\n2️⃣ Sente culpa toda vez que fala não.\n3️⃣ Explica demais uma decisão simples.\n\nComenta se você se identificou com algum.\n\n#limites #comunicacao #autoestima",
  "Ninguém te contou isso sobre se comunicar bem 🗣️\n\nFalar o que você sente evita adivinhação.\n\nQuem não sabe, não pode acertar.\n\n#comunicacao #relacionamento #maturidade",
  "3 hábitos de comunicação que evitam conflito:\n\n1️⃣ Falar sobre o fato, não sobre a intenção que você imagina.\n2️⃣ Ouvir até o fim antes de responder.\n3️⃣ Perguntar em vez de presumir.\n\nMarca quem precisa treinar isso.\n\n#comunicacao #relacionamento #maturidade",
  "Isso muda toda conversa difícil que você tiver 🗣️\n\nTom de voz importa tanto quanto a palavra.\n\nO como você fala define se vai virar conversa ou briga.\n\n#comunicacao #relacionamento #maturidade",
  "3 coisas que limite saudável não é:\n\n1️⃣ Não é grosseria.\n2️⃣ Não é egoísmo.\n3️⃣ Não é afastar quem te ama de verdade.\n\nSalva pra lembrar disso na próxima vez que duvidar.\n\n#limites #autoestima #maturidade",
  "POV: você parou de se explicar demais 🗣️\n\nExplicação em excesso soa como pedido de permissão.\n\nVocê não deve satisfação de tudo pra todo mundo.\n\n#limites #autoestima #maturidade",
  "3 hábitos de quem sabe ouvir de verdade:\n\n1️⃣ Não interrompe pra dar opinião.\n2️⃣ Repete o que entendeu antes de responder.\n3️⃣ Fica em silêncio quando o outro só precisa desabafar.\n\nComenta quem tem essa habilidade na sua vida.\n\n#comunicacao #relacionamento #maturidade",
  "Isso aqui evita muita mágoa desnecessária 🗣️\n\nFalar magoa menos do que guardar.\n\nO silêncio prolongado é o que mais destrói vínculo.\n\n#comunicacao #relacionamento #limites",

  // Trabalho / carreira
  "3 atitudes de quem cresce rápido na carreira:\n\n1️⃣ Resolve problema antes de ser cobrado.\n2️⃣ Pede feedback com frequência.\n3️⃣ Aprende o que ninguém pede, mas todo mundo valoriza.\n\nSalva pra revisar sua postura no trabalho.\n\n#carreira #trabalho #crescimentoprofissional",
  "Ninguém te contou isso sobre emprego 💼\n\nSer o mais ocupado não é o mesmo que ser o mais valioso.\n\nEntrega resultado, não horas.\n\n#carreira #trabalho #produtividade",
  "3 sinais de que você está pronto pra um passo maior:\n\n1️⃣ Já resolve sozinho o que antes precisava perguntar.\n2️⃣ Buscam você antes de você se oferecer.\n3️⃣ Você entrega mais do que o combinado.\n\nComenta se você já sentiu isso.\n\n#carreira #crescimentoprofissional #trabalho",
  "POV: você entendeu que networking é construído antes de precisar dele 💼\n\nRelação não se cria na hora da necessidade.\n\nCultive antes.\n\n#carreira #networking #trabalho",
  "3 hábitos que fazem você parecer júnior mesmo sendo bom:\n\n1️⃣ Pedir aprovação pra tudo.\n2️⃣ Não trazer solução, só o problema.\n3️⃣ Evitar falar em reunião.\n\nMarca quem precisa ler isso pra crescer.\n\n#carreira #trabalho #crescimentoprofissional",
  "Isso muda como recrutadores te enxergam 💼\n\nPortfólio fala mais que currículo bonito.\n\nMostre o que você fez, não só o que sabe.\n\n#carreira #trabalho #emprego",
  "3 coisas que fazem diferença num ambiente de trabalho:\n\n1️⃣ Cumprir prazo sem precisar cobrança.\n2️⃣ Assumir erro rápido, sem enrolar.\n3️⃣ Ajudar sem esperar retorno na hora.\n\nSalva pra aplicar essa semana.\n\n#trabalho #carreira #profissional",
  "Isso aqui é sobre parar de romantizar o excesso de trabalho 💼\n\nTrabalhar até tarde todo dia não é dedicação.\n\nÉ falta de gestão de tempo, revise sua rotina.\n\n#carreira #trabalho #equilibrio",
  "3 perguntas antes de aceitar qualquer proposta:\n\n1️⃣ Isso me aproxima do que eu quero pra minha carreira?\n2️⃣ O ambiente combina com quem eu sou?\n3️⃣ O que eu ganho além do salário?\n\nComenta se você já recusou uma proposta por esses motivos.\n\n#carreira #trabalho #emprego",
  "Ninguém te contou isso sobre pedir aumento 💼\n\nSe você não pede, ninguém vai adivinhar seu valor.\n\nApresente resultado, não desabafo.\n\n#carreira #trabalho #crescimentoprofissional",

  // Família / amizade
  "3 hábitos de amizades que duram anos:\n\n1️⃣ Ligar sem motivo, só pra saber como está.\n2️⃣ Estar presente também nos dias ruins, não só nas festas.\n3️⃣ Comemorar a conquista do outro de verdade.\n\nManda pra aquele amigo que é assim com você.\n\n#amizade #vinculos #familia",
  "POV: você percebeu quem realmente fica 🤝\n\nAmizade de verdade não precisa de contato todo dia.\n\nSó precisa de presença quando importa.\n\n#amizade #vinculos #maturidade",
  "3 sinais de amizade saudável:\n\n1️⃣ Você pode discordar sem medo de perder o vínculo.\n2️⃣ Não existe competição silenciosa.\n3️⃣ Vocês se sentem livres pra ser vocês mesmos.\n\nComenta quem tem essa amizade com você.\n\n#amizade #vinculos #relacionamento",
  "Ninguém te contou isso sobre laços de família 👨‍👩‍👧\n\nFamília nem sempre é sobre sangue.\n\nÀs vezes é sobre quem escolhe ficar.\n\n#familia #vinculos #amizade",
  "3 hábitos que fortalecem a relação com seus pais:\n\n1️⃣ Ligar sem precisar de motivo específico.\n2️⃣ Ouvir a história que eles já contaram antes.\n3️⃣ Agradecer o que antes você achava obrigação.\n\nMarca quem você quer ligar hoje.\n\n#familia #vinculos #gratidao",
  "Isso vai te fazer valorizar quem está por perto 🤝\n\nA gente costuma sentir falta só depois que perde.\n\nDemonstre carinho enquanto ainda dá tempo.\n\n#familia #amizade #vinculos",
  "3 coisas que amizade de verdade não exige:\n\n1️⃣ Não exige concordar sempre.\n2️⃣ Não exige estar por perto todos os dias.\n3️⃣ Não exige provar lealdade toda hora.\n\nSalva pra lembrar quem são seus amigos de verdade.\n\n#amizade #vinculos #maturidade",
  "POV: você aprendeu a soltar amizade que só drena 🤝\n\nNem toda amizade antiga precisa durar pra sempre.\n\nAlgumas cumprem um ciclo e terminam, e tudo bem.\n\n#amizade #maturidade #crescimentopessoal",
  "3 hábitos de família que criam memória boa:\n\n1️⃣ Refeição junto, sem celular na mesa.\n2️⃣ Comemorar conquista pequena também.\n3️⃣ Criar tradição simples, tipo um domingo fixo.\n\nComenta qual dessas sua família já tem.\n\n#familia #vinculos #memorias",
  "Isso aqui é sobre valorizar quem soma na sua vida 🤝\n\nVocê não precisa manter vínculo só por costume.\n\nEscolha quem te acrescenta, com carinho, mas escolha.\n\n#amizade #vinculos #autoestima",

  // Minimalismo / simplicidade
  "3 hábitos de quem vive de forma mais leve:\n\n1️⃣ Compra menos, escolhe melhor.\n2️⃣ Doa o que não usa há mais de um ano.\n3️⃣ Prioriza experiência em vez de objeto.\n\nSalva pra aplicar essa semana.\n\n#minimalismo #simplicidade #estilodevida",
  "POV: você percebeu que menos coisas trouxe mais paz 🌿\n\nCasa cheia de objeto muitas vezes é mente cheia de peso.\n\nSimplificar também é cuidar da cabeça.\n\n#minimalismo #simplicidade #bemestar",
  "3 sinais de que você está vivendo no automático:\n\n1️⃣ Compra coisa que nem lembra depois.\n2️⃣ Rotina cheia sem saber o motivo.\n3️⃣ Sente que o tempo passa e nada muda.\n\nComenta se algo disso é você agora.\n\n#simplicidade #mentalidade #rotina",
  "Ninguém te contou isso sobre consumo 🌿\n\nComprar coisa nova alivia por minutos.\n\nO vazio que motivou a compra continua igual.\n\n#minimalismo #consumo #mentalidade",
  "3 hábitos que simplificam qualquer rotina:\n\n1️⃣ Reduzir decisão sobre coisa pequena, tipo roupa.\n2️⃣ Ter menos, mas usar tudo que tem.\n3️⃣ Dizer não pra compromisso que só cansa.\n\nMarca quem precisa simplificar a vida.\n\n#simplicidade #minimalismo #rotina",

  // Motivação / mentalidade
  "3 mentalidades que mudam qualquer resultado:\n\n1️⃣ Focar no que pode controlar.\n2️⃣ Ver erro como dado, não como sentença.\n3️⃣ Comparar com quem você era, não com os outros.\n\nSalva pra lembrar disso sempre.\n\n#mentalidade #motivacao #crescimentopessoal",
  "Isso vai mudar como você encara desafio 🔥\n\nDificuldade não significa que você está no caminho errado.\n\nÀs vezes significa que você está crescendo de verdade.\n\n#mentalidade #motivacao #superacao",
  "3 sinais de mentalidade de crescimento:\n\n1️⃣ Você pede ajuda sem se sentir menor.\n2️⃣ Vê crítica como informação, não ataque.\n3️⃣ Prefere aprender a parecer certo.\n\nComenta qual desses você já tem.\n\n#mentalidade #crescimentopessoal #evolucao",
  "Ninguém te contou isso sobre foco 🔥\n\nEnergia vai pra onde sua atenção vai.\n\nCuide do que você escolhe pensar todo dia.\n\n#mentalidade #foco #motivacao",
  "3 frases que mudam o dia quando repetidas de manhã:\n\n1️⃣ 'Eu não preciso controlar tudo hoje.'\n2️⃣ 'Um passo de cada vez já é progresso.'\n3️⃣ 'Eu consigo lidar com o que vier.'\n\nSalva pra ler amanhã de manhã.\n\n#mentalidade #motivacao #bemestar",
  "POV: você parou de esperar motivação pra agir 🔥\n\nMotivação vem depois da ação, não antes.\n\nComece mesmo sem vontade.\n\n#motivacao #disciplina #mentalidade",
  "3 coisas que separam quem desiste de quem persiste:\n\n1️⃣ Quem persiste ajusta o plano, não a meta.\n2️⃣ Aceita ritmo lento sem parar de andar.\n3️⃣ Lembra o motivo que começou.\n\nMarca quem está no meio de um desafio grande.\n\n#motivacao #persistencia #mentalidade",
  "Isso aqui muda tudo sobre superação 🔥\n\nVocê não precisa estar 100% curado pra seguir em frente.\n\nPode seguir carregando a dor, um passo de cada vez.\n\n#superacao #mentalidade #motivacao",
  "3 hábitos de quem tem resiliência de verdade:\n\n1️⃣ Aceita o momento difícil sem negar.\n2️⃣ Busca apoio em vez de isolar.\n3️⃣ Foca no próximo passo possível.\n\nComenta se você já precisou usar essa força.\n\n#resiliencia #mentalidade #superacao",
  "POV: você entendeu que comparação é ladrão de motivação 🔥\n\nO caminho do outro não é o seu caminho.\n\nCompita só com quem você foi ontem.\n\n#mentalidade #motivacao #crescimentopessoal",

  // Estudos / aprendizado
  "3 hábitos de quem aprende rápido:\n\n1️⃣ Ensina o que aprendeu pra alguém.\n2️⃣ Revisa em intervalos, não só uma vez.\n3️⃣ Pratica em vez de só ler.\n\nSalva pra usar nos seus estudos.\n\n#estudos #aprendizado #foco",
  "Ninguém te contou isso sobre estudar 📚\n\nReler não é a mesma coisa que aprender.\n\nTestar a si mesmo ensina muito mais que revisão passiva.\n\n#estudos #aprendizado #produtividade",
  "3 sinais de que você está estudando errado:\n\n1️⃣ Passa horas grifando texto sem revisar depois.\n2️⃣ Estuda tudo de uma vez, sem intervalo.\n3️⃣ Nunca se testa antes da prova.\n\nComenta se você já fez algum desses.\n\n#estudos #aprendizado #foco",
  "POV: você descobriu técnica de estudo que realmente funciona 📚\n\nEnsinar é a forma mais rápida de perceber o que você ainda não entendeu.\n\nTente explicar em voz alta.\n\n#estudos #aprendizado #produtividade",
  "3 hábitos que aumentam retenção de conteúdo:\n\n1️⃣ Estudar em blocos curtos, com pausa.\n2️⃣ Revisar 24h depois do primeiro contato.\n3️⃣ Fazer resumo com suas próprias palavras.\n\nMarca quem está estudando pra prova.\n\n#estudos #aprendizado #foco",

  // Tempo / rotina / curiosidades
  "Você sabia? 🤔\n\nSeu cérebro processa uma decisão antes de você perceber que decidiu.\n\nNão significa falta de livre-arbítrio.\nSignifica que intuição também é dado processado.\n\nComenta o que achou disso.\n\n#curiosidades #mentalidade #cerebro",
  "3 hábitos de quem administra bem o tempo:\n\n1️⃣ Planeja a semana, não só o dia.\n2️⃣ Reserva tempo pra imprevisto.\n3️⃣ Revisa o que não funcionou e ajusta.\n\nSalva pra organizar sua próxima semana.\n\n#tempo #rotina #produtividade",
  "Isso vai te fazer valorizar o hoje 🕐\n\nO tempo que passa não volta, mesmo quando parece igual todo dia.\n\nUse o hoje como se fosse único, porque é.\n\n#tempo #mentalidade #motivacao",
  "3 coisas que roubam tempo sem você perceber:\n\n1️⃣ Rolar rede social 'só mais um pouco'.\n2️⃣ Decidir de novo o que já foi decidido.\n3️⃣ Adiar tarefa pequena até virar grande.\n\nComenta qual desses é você.\n\n#tempo #produtividade #foco",
  "POV: você aprendeu a valorizar o tempo livre de verdade 🕐\n\nDescanso planejado rende mais que descanso por exaustão.\n\nDescanse antes de precisar.\n\n#tempo #descanso #rotina",
  "Curiosidade que vai te marcar 🧠\n\nO cérebro humano gasta mais energia tomando decisões pequenas repetidas do que decisões grandes e raras.\n\nSimplifique o automático.\nGuarde energia pro que importa.\n\nComenta o que mais te surpreendeu.\n\n#curiosidades #produtividade #mentalidade",
  "3 hábitos que trazem sensação de controle sobre o tempo:\n\n1️⃣ Anotar tudo em vez de confiar só na memória.\n2️⃣ Ter um horário fixo pra revisar a agenda.\n3️⃣ Dizer não pra tarefa que não é prioridade.\n\nMarca quem sente que o tempo sempre escapa.\n\n#tempo #rotina #produtividade",
  "Ninguém te contou isso sobre rotina 🕐\n\nRotina não é prisão.\n\nÉ o que sobra de energia pra você gastar no que importa de verdade.\n\n#rotina #produtividade #mentalidade",
  "3 sinais de que sua rotina está desorganizada:\n\n1️⃣ Você sempre sai correndo de casa.\n2️⃣ Esquece compromisso com frequência.\n3️⃣ Sente que o dia te controla, não o contrário.\n\nComenta se isso é a sua realidade agora.\n\n#rotina #produtividade #organizacao",
  "Isso aqui muda como você organiza a semana 🕐\n\nPlanejar domingo à noite evita segunda-feira no caos.\n\n15 minutos de planejamento economizam horas de correria.\n\n#rotina #produtividade #organizacao",

  // Variados: redes sociais, criatividade, gratidão, viagem
  "Você sabia? 🤔\n\nEscrever à mão ativa mais áreas do cérebro do que digitar.\n\nNão é sobre nostalgia.\nÉ sobre memória mesmo.\n\nSalva pra lembrar na próxima anotação importante.\n\n#curiosidades #aprendizado #cerebro",
  "3 hábitos digitais que protegem sua saúde mental:\n\n1️⃣ Desativar notificação de rede social.\n2️⃣ Ter horário pra checar o celular, não o dia todo.\n3️⃣ Seguir só quem soma, não quem só compara.\n\nComenta se você vai aplicar algum hoje.\n\n#saudemental #redessociais #bemestar",
  "POV: você percebeu que rede social é vitrine, não realidade 📱\n\nNinguém posta o dia ruim com a mesma frequência que posta a conquista.\n\nCompare menos, viva mais.\n\n#redessociais #saudemental #mentalidade",
  "3 sinais de que você precisa de um detox digital:\n\n1️⃣ Pega o celular sem nem perceber.\n2️⃣ Compara sua vida com feed dos outros.\n3️⃣ Sente ansiedade quando fica sem internet.\n\nMarca quem precisa disso agora.\n\n#detoxdigital #saudemental #bemestar",
  "Ninguém te contou isso sobre criatividade 🎨\n\nCriatividade não é dom raro.\n\nÉ músculo que se desenvolve com prática constante.\n\n#criatividade #mentalidade #crescimentopessoal",
  "3 hábitos que estimulam criatividade:\n\n1️⃣ Sair da rotina, mesmo que por 10 minutos.\n2️⃣ Anotar ideia na hora, antes de esquecer.\n3️⃣ Misturar áreas diferentes de conhecimento.\n\nSalva pra testar essa semana.\n\n#criatividade #inovacao #mentalidade",
  "Isso vai te fazer valorizar quem te ajudou a chegar até aqui 🙏\n\nNinguém constrói nada sozinho de verdade.\n\nAgradeça quem esteve junto, mesmo nos bastidores.\n\n#gratidao #vinculos #maturidade",
  "3 hábitos de gratidão que mudam a perspectiva do dia:\n\n1️⃣ Anotar 3 coisas boas antes de dormir.\n2️⃣ Agradecer em voz alta, não só por dentro.\n3️⃣ Notar o pequeno, não só o grande.\n\nComenta uma coisa boa do seu dia hoje.\n\n#gratidao #bemestar #mentalidade",
  "POV: você aprendeu que viajar ensina mais que qualquer curso 🌍\n\nSair da rotina te mostra o quanto sua realidade não é a única.\n\nExpande a visão de mundo.\n\n#viagem #crescimentopessoal #mentalidade",
  "3 coisas que toda viagem te ensina, mesmo curta:\n\n1️⃣ Que seu jeito não é o único jeito certo.\n2️⃣ Que imprevisto também faz parte.\n3️⃣ Que menos bagagem, mais leveza.\n\nSalva pra lembrar na próxima viagem.\n\n#viagem #mentalidade #crescimentopessoal",

  // Exercício físico / corpo
  "3 hábitos de quem mantém a rotina de treino:\n\n1️⃣ Marca o horário como compromisso, não como opção.\n2️⃣ Prepara a roupa a noite anterior.\n3️⃣ Começa com 10 minutos nos dias difíceis.\n\nSalva pra usar na próxima recaída de preguiça.\n\n#treino #saude #disciplina",
  "POV: você entendeu que constância vale mais que treino perfeito 🏋️\n\nTreino ruim feito vale mais que treino perfeito adiado.\n\nApareça, mesmo cansado.\n\n#treino #disciplina #saude",
  "3 sinais de que seu corpo agradece o movimento:\n\n1️⃣ Você dorme melhor nos dias que treina.\n2️⃣ Humor melhora depois do exercício.\n3️⃣ Disposição aumenta ao longo da semana.\n\nComenta se você já sentiu isso.\n\n#exercicio #saude #bemestar",
  "Ninguém te contou isso sobre resultado físico 💪\n\nO corpo muda na consistência, não na intensidade de um dia só.\n\nPequeno todo dia bate grande de vez em quando.\n\n#treino #saude #disciplina",
  "3 coisas que atrapalham qualquer evolução física:\n\n1️⃣ Comparar seu progresso com o de outra pessoa.\n2️⃣ Pular refeição achando que emagrece mais rápido.\n3️⃣ Treinar sem descansar o suficiente.\n\nMarca quem precisa ler isso hoje.\n\n#saude #treino #bemestar",
  "Isso muda como você encara o dia de descanso 🏋️\n\nDescansar não atrapalha o resultado.\n\nÉ parte dele, o músculo cresce no repouso, não no treino.\n\n#treino #saude #descanso",
  "3 hábitos de quem cuida do corpo sem obsessão:\n\n1️⃣ Come com equilíbrio, não com culpa.\n2️⃣ Treina por saúde, não só por estética.\n3️⃣ Aceita fase de manutenção sem se cobrar.\n\nSalva pra lembrar disso.\n\n#saude #bemestar #equilibrio",
  "POV: você parou de treinar pra compensar o que comeu 🏋️\n\nComida não é punição nem prêmio.\n\nÉ combustível, trate assim.\n\n#saude #alimentacao #bemestar",
  "3 sinais de que você está treinando demais:\n\n1️⃣ Cansaço que não passa com sono.\n2️⃣ Queda de rendimento mesmo treinando mais.\n3️⃣ Vontade de treinar vira obrigação pesada.\n\nComenta se você já passou por isso.\n\n#treino #saude #descanso",
  "Isso aqui é sobre valorizar o processo, não só o resultado 💪\n\nO corpo que você quer é construído no que você faz todo dia.\n\nConfie no processo.\n\n#treino #disciplina #saude",

  // Alimentação saudável
  "3 hábitos de quem come bem sem radicalismo:\n\n1️⃣ Prioriza comida de verdade na maioria das refeições.\n2️⃣ Não exclui o que gosta, só equilibra a quantidade.\n3️⃣ Planeja a semana pra não decidir com fome.\n\nSalva pra aplicar na próxima feira.\n\n#alimentacaosaudavel #saude #bemestar",
  "Ninguém te contou isso sobre dieta 🥗\n\nRestrição extrema funciona por pouco tempo e cansa rápido.\n\nMudança sustentável vence dieta radical sempre.\n\n#alimentacaosaudavel #saude #mentalidade",
  "3 sinais de que sua relação com comida está saudável:\n\n1️⃣ Você come quando sente fome de verdade.\n2️⃣ Não sente culpa depois de comer o que gosta.\n3️⃣ Consegue parar quando está satisfeito.\n\nComenta qual desses ainda precisa treinar.\n\n#alimentacaosaudavel #saudemental #bemestar",
  "POV: você entendeu que água também é parte da dieta 💧\n\nMuita fome que você sente é sede disfarçada.\n\nBeba antes de comer por impulso.\n\n#alimentacaosaudavel #saude #bemestar",
  "3 hábitos que evitam beliscar sem necessidade:\n\n1️⃣ Fazer refeições com proteína suficiente.\n2️⃣ Não pular refeição principal.\n3️⃣ Ter água por perto o dia todo.\n\nMarca quem belisca demais no trabalho.\n\n#alimentacaosaudavel #saude #rotina",
  "Isso muda como você compra no mercado 🥗\n\nIr com lista e sem fome evita compra por impulso.\n\nPlanejamento também é parte da alimentação saudável.\n\n#alimentacaosaudavel #organizacao #saude",
  "3 coisas que sabotam sua alimentação sem você perceber:\n\n1️⃣ Comer assistindo tela, sem prestar atenção.\n2️⃣ Confundir sede com fome.\n3️⃣ Pular café da manhã e compensar exagerando à noite.\n\nComenta qual desses é você.\n\n#alimentacaosaudavel #saude #rotina",
  "Ninguém te contou isso sobre 'comida boa' 🥗\n\nComida de verdade não precisa de rótulo chamativo.\n\nQuanto menos ingrediente, geralmente melhor.\n\n#alimentacaosaudavel #saude #bemestar",
  "3 hábitos de quem mantém energia estável o dia todo:\n\n1️⃣ Combina proteína com carboidrato em cada refeição.\n2️⃣ Evita açúcar em jejum.\n3️⃣ Faz pausa pra comer com calma, sem pressa.\n\nSalva pra testar amanhã.\n\n#alimentacaosaudavel #energia #saude",
  "POV: você parou de romantizar dieta da moda 🥗\n\nO que funciona é o que você consegue manter a longo prazo.\n\nConstância vale mais que restrição radical.\n\n#alimentacaosaudavel #saude #mentalidade",

  // Empreendedorismo / negócio próprio
  "3 hábitos de quem empreende com consistência:\n\n1️⃣ Revisa o número do negócio toda semana.\n2️⃣ Testa antes de investir alto.\n3️⃣ Aprende com concorrente sem copiar tudo.\n\nSalva pra revisar seu negócio essa semana.\n\n#empreendedorismo #negocios #mentalidade",
  "Ninguém te contou isso sobre empreender 💼\n\nComeçar pequeno não é fracasso, é estratégia.\n\nErro caro é começar grande sem testar nada.\n\n#empreendedorismo #negocios #mentalidade",
  "3 sinais de que seu negócio precisa de ajuste:\n\n1️⃣ Você trabalha muito e o lucro não acompanha.\n2️⃣ Depende só de você pra funcionar.\n3️⃣ Não sabe qual produto realmente dá retorno.\n\nComenta qual desses é a sua realidade.\n\n#empreendedorismo #negocios #financas",
  "POV: você entendeu que cliente insatisfeito ensina mais que elogio 💼\n\nCrítica bem ouvida vira melhoria.\n\nElogio só confirma o que já está certo.\n\n#empreendedorismo #negocios #mentalidade",
  "3 coisas que todo negócio pequeno precisa ter:\n\n1️⃣ Controle claro de entrada e saída de dinheiro.\n2️⃣ Um jeito simples de ouvir o cliente.\n3️⃣ Meta realista, não meta de propaganda.\n\nMarca quem está começando um negócio agora.\n\n#empreendedorismo #negocios #financas",
  "Isso muda como você precifica seu produto 💼\n\nPreço baixo demais não atrai cliente fiel, atrai cliente que só quer desconto.\n\nCobre o que seu trabalho vale.\n\n#empreendedorismo #negocios #financas",
  "3 hábitos de quem vende sem parecer forçado:\n\n1️⃣ Resolve o problema antes de falar do preço.\n2️⃣ Escuta mais do que fala na negociação.\n3️⃣ Segue contato depois da venda, não só antes.\n\nSalva pra aplicar na próxima venda.\n\n#empreendedorismo #vendas #negocios",
  "Ninguém te contou isso sobre autonomia financeira 💼\n\nTer seu negócio não significa trabalhar menos.\n\nSignifica escolher em que trabalhar mais.\n\n#empreendedorismo #negocios #mentalidade",
  "3 sinais de que é hora de delegar no seu negócio:\n\n1️⃣ Você trabalha em tudo, menos em crescer.\n2️⃣ Tarefa repetitiva consome seu dia inteiro.\n3️⃣ Uma pessoa treinada resolveria em metade do tempo.\n\nComenta se você já sentiu isso.\n\n#empreendedorismo #negocios #produtividade",
  "POV: você aprendeu que networking vale mais que anúncio caro 💼\n\nIndicação de quem confia em você converte mais que qualquer campanha.\n\nCultive relação, não só cliente.\n\n#empreendedorismo #negocios #networking",

  // Liderança / gestão de equipe
  "3 atitudes de líder que a equipe respeita:\n\n1️⃣ Assume erro do time, não só o crédito.\n2️⃣ Dá feedback direto, sem humilhar.\n3️⃣ Ouve antes de decidir.\n\nMarca um líder assim que você já teve.\n\n#lideranca #gestao #trabalho",
  "Ninguém te contou isso sobre liderar 👥\n\nLiderar não é mandar mais, é resolver melhor.\n\nEquipe segue quem resolve, não quem só cobra.\n\n#lideranca #gestao #mentalidade",
  "3 sinais de que sua equipe confia em você:\n\n1️⃣ Trazem problema antes que vire crise.\n2️⃣ Discordam de você sem medo.\n3️⃣ Pedem ajuda sem se sentir fracos.\n\nComenta se sua equipe faz isso.\n\n#lideranca #gestao #trabalho",
  "POV: você entendeu que reconhecer o time também é liderança 👥\n\nElogio público custa nada e retém talento.\n\nUse isso mais.\n\n#lideranca #gestao #trabalho",
  "3 coisas que destroem confiança de uma equipe:\n\n1️⃣ Prometer e não cumprir.\n2️⃣ Falar mal de alguém pelas costas.\n3️⃣ Mudar de opinião sem explicar o motivo.\n\nSalva pra lembrar disso na próxima decisão.\n\n#lideranca #gestao #trabalho",
  "Isso muda como sua equipe entrega resultado 👥\n\nClareza de expectativa evita retrabalho.\n\nExplique o porquê, não só o que fazer.\n\n#lideranca #gestao #produtividade",
  "3 hábitos de gestores que retêm talento:\n\n1️⃣ Perguntam o que a pessoa quer crescer, não só o que a empresa precisa.\n2️⃣ Dão autonomia com acompanhamento, não microgerenciam.\n3️⃣ Comemoram conquista pequena da equipe.\n\nMarca um gestor assim.\n\n#lideranca #gestao #trabalho",
  "Ninguém te contou isso sobre delegar 👥\n\nDelegar não é largar, é confiar com acompanhamento.\n\nTreine, depois solte aos poucos.\n\n#lideranca #gestao #produtividade",
  "3 sinais de liderança imatura:\n\n1️⃣ Leva discordância pro pessoal.\n2️⃣ Não admite erro na frente do time.\n3️⃣ Compara membros da equipe entre si.\n\nComenta se você já viveu isso como liderado.\n\n#lideranca #gestao #mentalidade",
  "POV: você entendeu que liderar pelo exemplo vale mais que discurso 👥\n\nA equipe copia o que você faz, não o que você fala.\n\nSeja o padrão que você espera.\n\n#lideranca #gestao #mentalidade",

  // Paternidade / maternidade
  "3 hábitos de pais que criam vínculo forte com os filhos:\n\n1️⃣ Dão atenção total por alguns minutos todo dia.\n2️⃣ Perguntam sem julgar a resposta.\n3️⃣ Assumem erro e pedem desculpa também.\n\nMarca quem faz isso com você ou com os filhos.\n\n#paternidade #maternidade #familia",
  "Ninguém te contou isso sobre educar criança 👶\n\nCriança aprende mais observando do que ouvindo ordem.\n\nO exemplo ensina mais que a regra.\n\n#paternidade #maternidade #familia",
  "3 sinais de que seu filho se sente seguro com você:\n\n1️⃣ Conta coisa ruim sem medo de bronca.\n2️⃣ Pede colo mesmo depois de errar.\n3️⃣ Fica à vontade discordando de você.\n\nComenta se você reconhece isso.\n\n#paternidade #maternidade #familia",
  "POV: você entendeu que presença vale mais que presente 👶\n\nTempo de qualidade não se compra, se dá.\n\nEsteja presente, mesmo pouco tempo.\n\n#paternidade #maternidade #familia",
  "3 coisas que toda criança precisa ouvir com frequência:\n\n1️⃣ 'Eu te amo do jeito que você é.'\n2️⃣ 'Errar faz parte de aprender.'\n3️⃣ 'Eu confio em você.'\n\nSalva pra lembrar de falar hoje.\n\n#paternidade #maternidade #familia",
  "Isso vai te fazer repensar a rotina com os filhos 👶\n\nCelular perto na hora da conversa manda a mensagem errada.\n\nAtenção total, mesmo que por pouco tempo.\n\n#paternidade #maternidade #familia",
  "3 hábitos que ajudam criança a lidar com frustração:\n\n1️⃣ Nomear o sentimento junto com ela.\n2️⃣ Não resolver tudo antes dela tentar.\n3️⃣ Validar a emoção antes de corrigir a atitude.\n\nMarca quem está criando uma criança agora.\n\n#paternidade #maternidade #familia",
  "Ninguém te contou isso sobre disciplina com carinho 👶\n\nLimite não é punição, é cuidado com direção.\n\nExplique o porquê da regra.\n\n#paternidade #maternidade #familia",
  "3 sinais de que você está sendo pai/mãe presente:\n\n1️⃣ Você sabe o nome do melhor amigo do seu filho.\n2️⃣ Sabe o que ele está sentindo sem perguntar direto.\n3️⃣ Ele te procura pra contar boa notícia também.\n\nComenta se algo disso é você.\n\n#paternidade #maternidade #familia",
  "POV: você aprendeu que pedir desculpa pro filho fortalece o vínculo 👶\n\nErrar na frente dele e reconhecer ensina mais que fingir perfeição.\n\nSeja humano, ele aprende com isso.\n\n#paternidade #maternidade #familia",

  // Casa / organização doméstica
  "3 hábitos que mantêm a casa organizada sem esforço extra:\n\n1️⃣ Guardar o que usou na hora, não depois.\n2️⃣ Ter lugar fixo pra cada coisa.\n3️⃣ Arrumar 10 minutos antes de dormir.\n\nSalva pra aplicar hoje à noite.\n\n#organizacao #casa #rotina",
  "Ninguém te contou isso sobre bagunça 🏠\n\nCasa bagunçada geralmente reflete rotina sobrecarregada.\n\nOrganizar o espaço também organiza a cabeça.\n\n#organizacao #casa #bemestar",
  "3 sinais de que sua casa precisa de uma faxina de verdade:\n\n1️⃣ Você não lembra o que tem guardado em certos lugares.\n2️⃣ Compra de novo o que já tem, só não acha.\n3️⃣ Sente cansaço só de olhar pro ambiente.\n\nComenta se sua casa está assim agora.\n\n#organizacao #casa #rotina",
  "POV: você entendeu que menos objeto facilita limpar 🏠\n\nCasa cheia demora mais pra organizar e cansa mais.\n\nDoe o que não usa, facilita sua rotina.\n\n#organizacao #minimalismo #casa",
  "3 hábitos que evitam acúmulo de louça e roupa suja:\n\n1️⃣ Lavar a louça logo depois de comer.\n2️⃣ Separar roupa suja por tipo assim que tira.\n3️⃣ Fazer uma lavagem de roupa por dia, não acumular.\n\nMarca quem precisa desse lembrete.\n\n#organizacao #casa #rotina",
  "Isso muda como você organiza a semana em casa 🏠\n\nDividir tarefa por dia da semana evita faxina geral cansativa.\n\nPouco todo dia bate muito de uma vez.\n\n#organizacao #casa #rotina",
  "3 coisas que uma casa organizada te dá além de limpeza:\n\n1️⃣ Menos tempo procurando coisa perdida.\n2️⃣ Mais clareza mental.\n3️⃣ Mais disposição pra receber visita sem estresse.\n\nComenta o que mudou quando você organizou sua casa.\n\n#organizacao #casa #bemestar",
  "Ninguém te contou isso sobre dividir tarefa doméstica 🏠\n\nCasa organizada é responsabilidade de todo mundo que mora nela.\n\nDivida, não sobrecarregue uma pessoa só.\n\n#organizacao #casa #familia",
  "3 hábitos de quem tem cozinha sempre pronta pra usar:\n\n1️⃣ Lava a louça na hora, não deixa acumular.\n2️⃣ Organiza a geladeira toda semana.\n3️⃣ Tem lista de compra fixa, sem improviso.\n\nSalva pra aplicar essa semana.\n\n#organizacao #casa #rotina",
  "POV: você percebeu que organizar o closet economiza tempo todo dia 🏠\n\nRoupa organizada por categoria acelera a escolha de manhã.\n\nMenos decisão pequena, mais energia pro que importa.\n\n#organizacao #casa #produtividade",

  // Tecnologia / uso consciente
  "3 hábitos pra usar tecnologia sem ser usado por ela:\n\n1️⃣ Desativar notificação que não é urgente.\n2️⃣ Ter horário sem tela antes de dormir.\n3️⃣ Usar app com propósito, não por hábito automático.\n\nSalva pra aplicar hoje.\n\n#tecnologia #bemestar #saudemental",
  "Ninguém te contou isso sobre inteligência artificial 🤖\n\nFerramenta não substitui julgamento, ela acelera o que você já sabe fazer.\n\nUse pra ganhar tempo, não pra parar de pensar.\n\n#tecnologia #produtividade #mentalidade",
  "3 sinais de que você depende demais do celular:\n\n1️⃣ Pega ele antes de levantar da cama.\n2️⃣ Sente ansiedade sem sinal de internet.\n3️⃣ Checa notificação no meio de uma conversa.\n\nComenta se você se identificou.\n\n#tecnologia #saudemental #bemestar",
  "POV: você aprendeu a usar tecnologia a seu favor 🤖\n\nAutomatizar tarefa repetitiva libera tempo pro que só você consegue fazer.\n\nDeixe a máquina fazer o repetitivo.\n\n#tecnologia #produtividade #mentalidade",
  "3 hábitos digitais de quem rende mais no trabalho:\n\n1️⃣ Separa horário fixo pra responder mensagem.\n2️⃣ Usa apenas as ferramentas que realmente precisa.\n3️⃣ Desliga aba que não está usando.\n\nMarca quem trabalha com 20 abas abertas.\n\n#tecnologia #produtividade #foco",

  // Meio ambiente / sustentabilidade
  "3 hábitos simples que reduzem seu impacto ambiental:\n\n1️⃣ Levar sacola própria pro mercado.\n2️⃣ Reduzir desperdício de comida.\n3️⃣ Separar o lixo reciclável em casa.\n\nSalva pra começar hoje.\n\n#sustentabilidade #meioambiente #consciencia",
  "Ninguém te contou isso sobre consumo consciente 🌱\n\nComprar menos e melhor pesa mais que reciclar muito e comprar sem parar.\n\nRepense antes de comprar.\n\n#sustentabilidade #consumo #meioambiente",
  "3 sinais de que sua rotina já é mais sustentável:\n\n1️⃣ Você reutiliza embalagem antes de descartar.\n2️⃣ Prefere produto durável a descartável.\n3️⃣ Pensa duas vezes antes de comprar por impulso.\n\nComenta qual desses já é seu hábito.\n\n#sustentabilidade #consciencia #meioambiente",
  "POV: você entendeu que pequena mudança em massa faz diferença 🌱\n\nUma pessoa sozinha não resolve tudo.\n\nMuita gente fazendo pouco muda muito.\n\n#sustentabilidade #meioambiente #consciencia",
  "3 hábitos que reduzem desperdício em casa:\n\n1️⃣ Planejar a compra pra não sobrar comida.\n2️⃣ Congelar o que não vai usar logo.\n3️⃣ Reaproveitar sobra em receita nova.\n\nMarca quem desperdiça muita comida em casa.\n\n#sustentabilidade #alimentacao #consciencia",

  // Leitura / livros
  "3 hábitos de quem lê com frequência mesmo com rotina cheia:\n\n1️⃣ Lê 10 minutos antes de dormir.\n2️⃣ Sempre tem um livro por perto, físico ou digital.\n3️⃣ Troca tempo de rolagem por tempo de leitura.\n\nSalva pra criar esse hábito.\n\n#leitura #livros #habitos",
  "Ninguém te contou isso sobre ler mais 📚\n\nNão precisa terminar todo livro que começa.\n\nAbandonar o que não te agrega também é escolha válida.\n\n#leitura #livros #mentalidade",
  "3 sinais de que a leitura virou hábito de verdade:\n\n1️⃣ Você sente falta quando passa um dia sem ler.\n2️⃣ Prefere livro a rolar feed em momento de tédio.\n3️⃣ Já indicou livro pra alguém essa semana.\n\nComenta se isso é você.\n\n#leitura #livros #habitos",
  "POV: você trocou 20 minutos de rede social por leitura 📚\n\nO tempo é o mesmo, o resultado que muda.\n\nEscolha onde investir sua atenção.\n\n#leitura #livros #mentalidade",
  "3 hábitos que ajudam a fixar o que você lê:\n\n1️⃣ Anotar frase que marcou.\n2️⃣ Resumir o capítulo com suas palavras.\n3️⃣ Comentar o livro com alguém.\n\nMarca quem lê muito e esquece rápido.\n\n#leitura #aprendizado #livros",

  // Música / arte
  "Você sabia? 🎵\n\nOuvir música que você já conhece ajuda o cérebro a focar mais que música nova.\n\nNão é sobre gosto.\nÉ sobre familiaridade.\n\nComenta sua música de trabalhar favorita.\n\n#musica #curiosidades #foco",
  "3 hábitos de quem usa arte pra cuidar da mente:\n\n1️⃣ Escuta música que combina com o humor, não que força alegria.\n2️⃣ Reserva tempo pra criar, mesmo sem talento técnico.\n3️⃣ Aprecia arte sem pressa de entender tudo.\n\nSalva pra lembrar disso.\n\n#arte #musica #bemestar",
  "Ninguém te contou isso sobre criar sem perfeição 🎨\n\nArte feita imperfeita ainda é arte.\n\nO processo importa mais que o resultado técnico.\n\n#arte #criatividade #mentalidade",
  "POV: você redescobriu o prazer de fazer algo só por fazer 🎨\n\nNem tudo precisa virar produto ou postagem.\n\nCrie por prazer também.\n\n#arte #criatividade #bemestar",
  "3 coisas que música faz pelo seu cérebro:\n\n1️⃣ Reduz nível de estresse em minutos.\n2️⃣ Ajuda a fixar memória com mais facilidade.\n3️⃣ Melhora o humor mesmo em dias ruins.\n\nComenta o que você ouve pra relaxar.\n\n#musica #saudemental #bemestar",

  // Confiança / coragem
  "3 hábitos de quem constrói confiança de verdade:\n\n1️⃣ Cumpre o que promete pra si mesmo.\n2️⃣ Age com medo em vez de esperar ele passar.\n3️⃣ Celebra pequena vitória, não só a grande.\n\nSalva pra lembrar disso.\n\n#confianca #coragem #mentalidade",
  "Ninguém te contou isso sobre coragem 🦁\n\nCoragem não é ausência de medo.\n\nÉ agir mesmo sentindo ele.\n\n#coragem #mentalidade #motivacao",
  "3 sinais de que sua autoconfiança está crescendo:\n\n1️⃣ Você fala sua opinião mesmo divergindo do grupo.\n2️⃣ Aceita desafio novo sem se sentir despreparado.\n3️⃣ Não precisa de aprovação pra tomar decisão.\n\nComenta qual desses já é seu.\n\n#confianca #autoestima #mentalidade",
  "POV: você fez aquilo com medo, e mesmo assim fez 🦁\n\nCoragem de verdade acontece exatamente ali.\n\nNo meio do desconforto.\n\n#coragem #mentalidade #superacao",
  "3 hábitos que travam sua confiança sem você perceber:\n\n1️⃣ Comparar seu começo com o meio do caminho de outra pessoa.\n2️⃣ Esperar sentir 100% de certeza pra agir.\n3️⃣ Deixar erro antigo definir sua capacidade atual.\n\nMarca quem precisa ler isso hoje.\n\n#confianca #mentalidade #autoestima",

  // Terapia / autoconhecimento
  "3 sinais de que você está evoluindo emocionalmente:\n\n1️⃣ Reconhece o próprio padrão antes de repetir ele.\n2️⃣ Nomeia o que sente com mais precisão.\n3️⃣ Busca entender a raiz, não só a reação.\n\nComenta qual desses você já percebeu em você.\n\n#autoconhecimento #terapia #saudemental",
  "Ninguém te contou isso sobre terapia 🧠\n\nProcurar ajuda não é sinal de fraqueza.\n\nÉ sinal de que você se importa com quem você é.\n\n#terapia #saudemental #autoconhecimento",
  "POV: você entendeu que autoconhecimento é processo, não destino 🧠\n\nVocê nunca termina de se conhecer.\n\nCada fase da vida revela uma camada nova.\n\n#autoconhecimento #saudemental #mentalidade",
  "3 perguntas que ajudam no autoconhecimento:\n\n1️⃣ O que eu sinto agora, de verdade?\n2️⃣ Essa reação é sobre o presente ou sobre o passado?\n3️⃣ O que eu preciso nesse momento?\n\nSalva pra usar quando se sentir perdido.\n\n#autoconhecimento #saudemental #terapia",
  "Isso vai te ajudar a entender seus padrões 🧠\n\nO que te incomoda muito no outro, às vezes é o que você reprime em você.\n\nOlhe com curiosidade, não com julgamento.\n\n#autoconhecimento #terapia #saudemental",

  // Networking / relacionamentos profissionais
  "3 hábitos de quem constrói boa reputação profissional:\n\n1️⃣ Cumpre prazo combinado sem enrolar.\n2️⃣ Indica outra pessoa quando não pode ajudar.\n3️⃣ Mantém contato sem precisar de motivo.\n\nSalva pra aplicar essa semana.\n\n#networking #carreira #profissional",
  "Ninguém te contou isso sobre fazer contato profissional 🤝\n\nNetworking de verdade é ajudar antes de pedir.\n\nConstrua a relação antes de precisar dela.\n\n#networking #carreira #profissional",
  "3 sinais de que sua rede profissional é forte:\n\n1️⃣ Você recebe indicação sem pedir.\n2️⃣ Tem gente que confia no seu trabalho de olhos fechados.\n3️⃣ Consegue conselho sincero quando precisa.\n\nComenta se você tem isso.\n\n#networking #carreira #profissional",
  "POV: você aprendeu a manter contato sem parecer interesseiro 🤝\n\nMande mensagem sem pedir nada, só pra saber como a pessoa está.\n\nRelação genuína rende mais que contato oportunista.\n\n#networking #carreira #relacionamento",
  "3 hábitos de quem sabe se apresentar bem:\n\n1️⃣ Fala o que faz de forma clara, sem enrolar.\n2️⃣ Demonstra interesse real pelo outro também.\n3️⃣ Segue contato depois do primeiro encontro.\n\nMarca quem se apresenta bem em qualquer situação.\n\n#networking #carreira #profissional",

  // Resiliência financeira / negociação
  "3 hábitos de quem negocia bem qualquer coisa:\n\n1️⃣ Pesquisa antes de conversar sobre preço.\n2️⃣ Escuta o que o outro lado precisa também.\n3️⃣ Sabe até onde pode ceder antes de começar.\n\nSalva pra usar na próxima negociação.\n\n#negociacao #dinheiro #financas",
  "Ninguém te contou isso sobre negociar salário 💼\n\nSe você não negocia, aceita o valor mais baixo que a empresa está disposta a pagar.\n\nPergunte, o pior que pode acontecer é ouvir não.\n\n#negociacao #carreira #dinheiro",
  "3 sinais de que você está pronto pra negociar melhor:\n\n1️⃣ Sabe exatamente o valor do que está oferecendo.\n2️⃣ Não tem medo de ouvir não.\n3️⃣ Consegue esperar em silêncio depois de propor um valor.\n\nComenta se você já treinou isso.\n\n#negociacao #dinheiro #mentalidade",
  "POV: você entendeu que resiliência financeira é sobre hábito, não sorte 💰\n\nQuem lida bem com dinheiro treinou isso com constância.\n\nComece pequeno, mas comece.\n\n#financas #dinheiro #mentalidade",
  "3 hábitos que fortalecem sua segurança financeira:\n\n1️⃣ Tem plano B pra fonte de renda.\n2️⃣ Não depende de um único cliente ou emprego.\n3️⃣ Revisa gasto fixo pelo menos uma vez por ano.\n\nMarca quem precisa revisar as finanças agora.\n\n#financas #dinheiro #seguranca",

  // Propósito / sentido de vida
  "3 perguntas que ajudam a encontrar propósito:\n\n1️⃣ O que eu faria mesmo sem ser pago?\n2️⃣ Em que momento eu perco a noção do tempo?\n3️⃣ O que as pessoas sempre pedem minha ajuda?\n\nSalva pra refletir com calma.\n\n#proposito #autoconhecimento #mentalidade",
  "Ninguém te contou isso sobre propósito 🌱\n\nPropósito não precisa ser um só, grande e definitivo.\n\nPode mudar de fase em fase da vida.\n\n#proposito #mentalidade #autoconhecimento",
  "POV: você entendeu que propósito se constrói fazendo, não só pensando 🌱\n\nAção revela clareza que reflexão sozinha não dá.\n\nComece, o caminho se ajusta andando.\n\n#proposito #mentalidade #crescimentopessoal",
  "3 sinais de que você está vivendo com propósito:\n\n1️⃣ Suas escolhas diárias combinam com o que você valoriza.\n2️⃣ Você sente sentido mesmo nos dias difíceis.\n3️⃣ Seu trabalho conecta com algo maior que só o salário.\n\nComenta se você sente isso hoje.\n\n#proposito #mentalidade #autoconhecimento",
  "Isso vai te ajudar a rever suas prioridades 🌱\n\nVida sem direção cansa mais que vida com esforço, mas com sentido.\n\nDefina pra onde você quer ir.\n\n#proposito #mentalidade #crescimentopessoal",
  "3 coisas que roubam o senso de propósito:\n\n1️⃣ Viver só pra cumprir expectativa alheia.\n2️⃣ Nunca parar pra pensar no que realmente quer.\n3️⃣ Medir sucesso só pelo padrão dos outros.\n\nMarca quem precisa parar e pensar nisso.\n\n#proposito #mentalidade #autoconhecimento",
  "Ninguém te contou isso sobre legado 🌱\n\nLegado não é só o que você deixa no fim.\n\nÉ o que você constrói todo dia, com quem você é.\n\n#proposito #mentalidade #crescimentopessoal",
  "3 hábitos de quem vive com mais sentido:\n\n1️⃣ Revisa se as ações do dia combinam com os valores.\n2️⃣ Diz não pro que não conecta com o propósito.\n3️⃣ Ajuda alguém sem esperar retorno.\n\nSalva pra lembrar disso.\n\n#proposito #mentalidade #crescimentopessoal",
  "POV: você percebeu que dinheiro sozinho não sustenta motivação 🌱\n\nSalário motiva por um tempo.\n\nPropósito motiva por muito mais.\n\n#proposito #carreira #mentalidade",
  "3 sinais de que você precisa de uma pausa pra repensar rumo:\n\n1️⃣ Sente que faz tudo no automático.\n2️⃣ Não lembra a última vez que se sentiu animado com algo.\n3️⃣ Sucesso externo não traz satisfação interna.\n\nComenta se isso é você agora.\n\n#proposito #mentalidade #autoconhecimento",

  // Hobbies / lazer
  "3 hábitos de quem não deixa o hobby morrer na correria:\n\n1️⃣ Reserva um horário fixo na semana, como compromisso.\n2️⃣ Não exige resultado, só prazer no processo.\n3️⃣ Faz mesmo com pouco tempo, nem que seja 15 minutos.\n\nSalva pra retomar aquele hobby esquecido.\n\n#hobby #lazer #bemestar",
  "Ninguém te contou isso sobre ter um hobby 🎨\n\nHobby não precisa virar renda extra pra valer a pena.\n\nDivertimento também é produtivo pra mente.\n\n#hobby #lazer #bemestar",
  "3 sinais de que você precisa de mais lazer na rotina:\n\n1️⃣ Não lembra a última vez que fez algo só por diversão.\n2️⃣ Sente que só descansa quando adoece.\n3️⃣ Trabalho ocupa todo tempo livre também.\n\nComenta se isso é você.\n\n#lazer #bemestar #saudemental",
  "POV: você voltou a fazer aquilo que só te dava prazer, sem cobrança 🎨\n\nNem tudo precisa ser produtivo.\n\nAlgumas coisas só precisam te fazer bem.\n\n#hobby #lazer #bemestar",
  "3 hábitos que trazem leveza pro fim de semana:\n\n1️⃣ Reservar tempo sem compromisso nenhum.\n2️⃣ Fazer algo manual, longe de tela.\n3️⃣ Sair da rotina, mesmo perto de casa.\n\nMarca quem precisa de um fim de semana assim.\n\n#lazer #bemestar #descanso",
  "Isso vai te fazer valorizar tempo livre de verdade 🎨\n\nDescanso ativo, tipo hobby, recarrega mais que rolar feed parado.\n\nEscolha lazer que engaja, não só distrai.\n\n#lazer #bemestar #saudemental",
  "3 coisas que todo hobby bom te ensina:\n\n1️⃣ Que nem tudo precisa de meta.\n2️⃣ Que erro no processo também diverte.\n3️⃣ Que fazer por prazer é suficiente.\n\nComenta qual é o seu hobby favorito.\n\n#hobby #lazer #bemestar",
  "Ninguém te contou isso sobre lazer de qualidade 🎨\n\nRolar rede social não é descanso, é só outro estímulo.\n\nDescanso de verdade desliga a mente.\n\n#lazer #saudemental #bemestar",
  "3 hábitos de quem equilibra trabalho e diversão:\n\n1️⃣ Separa horário claro pra cada um.\n2️⃣ Não sente culpa de parar pra se divertir.\n3️⃣ Trata o lazer como compromisso também.\n\nSalva pra aplicar essa semana.\n\n#lazer #equilibrio #bemestar",
  "POV: você entendeu que se divertir também é produtivo pra mente 🎨\n\nCriatividade e disposição vêm do descanso, não só do esforço.\n\nBrinque mais.\n\n#lazer #bemestar #criatividade",

  // Longevidade / envelhecer bem
  "3 hábitos de quem envelhece com saúde:\n\n1️⃣ Mantém o corpo em movimento todo dia.\n2️⃣ Cuida da mente tanto quanto do corpo.\n3️⃣ Mantém vínculo social ativo.\n\nSalva pra pensar no seu futuro.\n\n#longevidade #saude #bemestar",
  "Ninguém te contou isso sobre longevidade 🌿\n\nViver mais não é só sobre genética.\n\nÉ sobre hábito repetido por décadas.\n\n#longevidade #saude #mentalidade",
  "3 sinais de que seus hábitos de hoje vão te ajudar no futuro:\n\n1️⃣ Você se movimenta com regularidade.\n2️⃣ Cuida do sono com prioridade.\n3️⃣ Mantém relação social de verdade, não só online.\n\nComenta qual desses já é seu hábito.\n\n#longevidade #saude #bemestar",
  "POV: você entendeu que qualidade de vida importa tanto quanto tempo de vida 🌿\n\nViver mais anos só vale se vier com saúde e disposição.\n\nCuide disso agora, não só depois.\n\n#longevidade #saude #mentalidade",
  "3 hábitos que protegem a saúde mental na terceira idade:\n\n1️⃣ Manter a mente ativa com aprendizado novo.\n2️⃣ Cultivar propósito além do trabalho.\n3️⃣ Não isolar, manter contato social frequente.\n\nMarca quem tem um idoso querido na vida.\n\n#longevidade #saudemental #familia",
  "Isso vai mudar como você pensa em envelhecer 🌿\n\nO corpo que você vai ter aos 60 começa a ser construído agora.\n\nComece cedo, colha depois.\n\n#longevidade #saude #mentalidade",
  "3 coisas que ajudam a manter a mente afiada com o tempo:\n\n1️⃣ Aprender algo novo, mesmo pequeno.\n2️⃣ Ler com regularidade.\n3️⃣ Manter conversa estimulante, não só repetitiva.\n\nSalva pra aplicar na sua rotina.\n\n#longevidade #aprendizado #saude",
  "Ninguém te contou isso sobre envelhecer bem 🌿\n\nNão é sobre parecer jovem.\n\nÉ sobre continuar funcional, ativo e presente.\n\n#longevidade #saude #mentalidade",
  "3 hábitos que idosos saudáveis têm em comum:\n\n1️⃣ Movimento diário, mesmo que leve.\n2️⃣ Alimentação com equilíbrio, sem radicalismo.\n3️⃣ Vínculo social mantido com esforço ativo.\n\nComenta quem é seu exemplo de envelhecer bem.\n\n#longevidade #saude #familia",
  "POV: você decidiu cuidar do seu futuro a partir de hoje 🌿\n\nCada hábito bom agora é investimento na sua qualidade de vida depois.\n\nComece pequeno, comece já.\n\n#longevidade #saude #mentalidade",

  // Perdão / deixar ir
  "3 sinais de que você perdoou de verdade:\n\n1️⃣ Lembrar do fato não dói mais como antes.\n2️⃣ Você não sente necessidade de revanche.\n3️⃣ Consegue desejar bem pra pessoa, mesmo à distância.\n\nComenta se você já viveu isso.\n\n#perdao #maturidade #saudemental",
  "Ninguém te contou isso sobre perdoar 🕊️\n\nPerdoar não é dizer que estava tudo bem.\n\nÉ parar de carregar o peso por você mesmo.\n\n#perdao #saudemental #maturidade",
  "POV: você entendeu que perdoar é pra você, não pro outro 🕊️\n\nGuardar mágoa machuca mais quem guarda do que quem causou.\n\nSolte pelo seu próprio bem.\n\n#perdao #saudemental #maturidade",
  "3 coisas que perdão de verdade não exige:\n\n1️⃣ Não exige reatar a relação.\n2️⃣ Não exige esquecer o que aconteceu.\n3️⃣ Não exige explicar pro outro que perdoou.\n\nSalva pra lembrar disso quando for difícil.\n\n#perdao #maturidade #saudemental",
  "Isso vai te ajudar a soltar o que já passou 🕊️\n\nVocê não pode mudar o que aconteceu.\n\nMas pode escolher parar de reviver.\n\n#perdao #saudemental #mentalidade",
  "3 hábitos que ajudam no processo de perdoar:\n\n1️⃣ Nomear o que sentiu, sem minimizar.\n2️⃣ Dar tempo ao processo, sem forçar.\n3️⃣ Buscar apoio quando for pesado demais sozinho.\n\nMarca quem está nesse processo agora.\n\n#perdao #saudemental #maturidade",
  "Ninguém te contou isso sobre guardar mágoa 🕊️\n\nMágoa guardada não protege você.\n\nSó mantém a dor viva por mais tempo.\n\n#perdao #saudemental #mentalidade",
  "3 sinais de que ainda falta perdoar algo:\n\n1️⃣ A lembrança ainda gera raiva imediata.\n2️⃣ Você evita qualquer contato com o assunto.\n3️⃣ Sente vontade de que o outro sofra também.\n\nComenta se algo disso é você hoje.\n\n#perdao #saudemental #autoconhecimento",
  "POV: você perdoou alguém que nunca vai saber disso 🕊️\n\nPerdão não precisa de plateia.\n\nÉ um acerto seu, com você mesmo.\n\n#perdao #saudemental #maturidade",
  "Isso aqui é sobre se libertar do passado 🕊️\n\nVocê não escolheu o que te machucou.\n\nMas pode escolher até quando isso te define.\n\n#perdao #saudemental #crescimentopessoal",

  // Foco em objetivos / metas
  "3 hábitos de quem realmente alcança meta:\n\n1️⃣ Quebra objetivo grande em passo pequeno.\n2️⃣ Revisa o progresso toda semana.\n3️⃣ Ajusta o plano sem abandonar o objetivo.\n\nSalva pra revisar sua meta atual.\n\n#metas #objetivos #produtividade",
  "Ninguém te contou isso sobre definir meta 🎯\n\nMeta vaga não sai do papel.\n\nQuanto mais específica, mais fácil de agir.\n\n#metas #objetivos #mentalidade",
  "3 sinais de que sua meta está mal definida:\n\n1️⃣ Você não sabe medir se está progredindo.\n2️⃣ Não tem prazo nenhum associado a ela.\n3️⃣ Muda de ideia toda semana sobre o que quer.\n\nComenta se sua meta está assim agora.\n\n#metas #objetivos #mentalidade",
  "POV: você aprendeu a comemorar meta pequena no caminho 🎯\n\nSó celebrar o resultado final cansa a motivação.\n\nComemore cada passo também.\n\n#metas #motivacao #mentalidade",
  "3 hábitos que mantêm você no rumo da meta:\n\n1️⃣ Revisar o objetivo quando perde o foco.\n2️⃣ Lembrar o motivo que começou.\n3️⃣ Ajustar o prazo sem desistir do plano.\n\nMarca quem está no meio de um objetivo grande.\n\n#metas #objetivos #disciplina",
  "Isso muda como você planeja o ano 🎯\n\nMeta sem plano de ação é só desejo.\n\nTransforme desejo em passo concreto.\n\n#metas #objetivos #planejamento",
  "3 coisas que atrapalham qualquer meta:\n\n1️⃣ Querer resultado rápido demais.\n2️⃣ Comparar seu progresso com o de outra pessoa.\n3️⃣ Desistir no primeiro obstáculo.\n\nSalva pra lembrar na próxima dificuldade.\n\n#metas #objetivos #mentalidade",
  "Ninguém te contou isso sobre foco em objetivo 🎯\n\nFoco não é fazer tudo ao mesmo tempo.\n\nÉ escolher o que fazer primeiro.\n\n#metas #foco #produtividade",
  "3 hábitos de quem revisa metas com constância:\n\n1️⃣ Reserva um momento fixo no mês pra revisar.\n2️⃣ Anota o que funcionou e o que não funcionou.\n3️⃣ Ajusta a meta sem abandonar o objetivo maior.\n\nComenta com que frequência você revisa suas metas.\n\n#metas #objetivos #planejamento",
  "POV: você entendeu que meta de longo prazo se constrói com ação de curto prazo 🎯\n\nO grande objetivo é feito de pequenas ações repetidas.\n\nFoque no próximo passo, não no topo da montanha.\n\n#metas #objetivos #disciplina",
];

// ---------------------------------------------------------------------------
// Funções públicas
// ---------------------------------------------------------------------------

/** Retorna uma legenda aleatória do pool. */
export function getAutoCaption(_type?: AutoCaptionType): string {
  return CAPTIONS[Math.floor(Math.random() * CAPTIONS.length)];
}

/**
 * Retorna `count` legendas únicas e embaralhadas do pool.
 * Se `count` > pool.length, o pool é reutilizado em ciclos para nunca retornar vazio.
 */
export function getUniqueCaptions(_type: AutoCaptionType | undefined, count: number): string[] {
  if (count <= 0) return [];

  const result: string[] = [];
  while (result.length < count) {
    for (const cap of shuffleArray([...CAPTIONS])) {
      if (result.length >= count) break;
      result.push(cap);
    }
  }

  return result.slice(0, count);
}

/**
 * Identifica se uma legenda pertence ao pool automático (match exato).
 * Usado para inferir, a partir de posts já criados, se uma campanha estava
 * usando legendas automáticas — sem precisar de config salva.
 */
export function matchAutoCaptionType(caption: string): AutoCaptionType | null {
  const trimmed = caption.trim();
  if (!trimmed) return null;
  return CAPTIONS.includes(trimmed) ? "curiosidades-gerais" : null;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function shuffleArray<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
