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
