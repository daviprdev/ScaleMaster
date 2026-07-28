// Pool de legendas automáticas para postagens — curiosidades em PT-BR otimizadas para Instagram.
// Cada pool tem 100+ variações para evitar repetição em campanhas grandes.
// Regras de estilo: sem travessão (—), abertura variada (não repetir sempre "PALAVRA:"),
// tom natural — texto pensado para não soar como legenda gerada por IA.

export type AutoCaptionType =
  | "curiosidades-gerais"
  | "curiosidades-tops"
  | "fatos-complexos"
  | "variado";

export const AUTO_CAPTION_TYPES = [
  {
    id: "curiosidades-gerais" as AutoCaptionType,
    label: "Curiosidades Gerais",
    emoji: "💡",
    desc: "Fatos interessantes do dia a dia",
  },
  {
    id: "curiosidades-tops" as AutoCaptionType,
    label: "Curiosidades Tops",
    emoji: "🏆",
    desc: "Fatos surpreendentes e virais",
  },
  {
    id: "fatos-complexos" as AutoCaptionType,
    label: "Fatos Complexos",
    emoji: "🔬",
    desc: "Ciência e filosofia acessíveis",
  },
  {
    id: "variado" as AutoCaptionType,
    label: "Variado",
    emoji: "🔀",
    desc: "Sorteia entre os 3 tipos a cada legenda",
  },
] as const;

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

const CURIOSIDADES_GERAIS: string[] = [
  "🐙 Polvos têm três corações. Um deles para de bater quando eles nadam, por isso preferem rastejar pelo fundo do mar. 🌊",
  "🍌 Bananas são levemente radioativas por causa do potássio que contêm. Quantidade totalmente inofensiva, você precisaria comer milhares por dia pra sentir algo.",
  "🐝 Abelhas conseguem reconhecer rostos humanos, mesmo com um cérebro do tamanho de uma semente de gergelim.",
  "🦒 Girafas dormem só cerca de 30 minutos por dia, divididos em cochilos curtos de poucos minutos cada.",
  "🪐 Um dia em Vênus dura mais que um ano em Vênus. O planeta gira tão devagar que a volta ao redor do Sol termina primeiro!",
  "🍫 Chocolate branco tecnicamente não é chocolate. Ele não tem sólidos de cacau, só manteiga de cacau e açúcar.",
  "🦷 O esmalte dos dentes é o tecido mais duro do corpo humano, mais resistente até que o osso.",
  "🐘 Elefantes sentem chuva chegando a quilômetros de distância, captando vibrações no chão com as patas.",
  "🌊 A água do Mar Morto é tão salgada que o corpo flutua sozinho, é quase impossível afundar nele.",
  "🐨 Coalas dormem entre 18 e 22 horas por dia. O eucalipto que comem tem tão pouca energia que exige economizar ao máximo.",
  "🦴 Você nasce com cerca de 300 ossos, mas na fase adulta fica com 206. Vários se fundem durante o crescimento.",
  "🍯 O mel nunca estraga se guardado corretamente. Já encontraram potes de mais de 3 mil anos em tumbas egípcias ainda comestíveis.",
  "🐧 Pinguins-imperador conseguem passar mais de 500 metros de profundidade prendendo a respiração por 20 minutos.",
  "🌵 Alguns cactos armazenam água suficiente para sobreviver mais de um ano sem chuva nenhuma.",
  "🐦 Corvos conseguem lembrar do rosto de uma pessoa por anos, principalmente se ela já os assustou uma vez.",
  "🧠 Seu cérebro representa 2% do peso do corpo, mas consome cerca de 20% de toda a energia que você gasta em repouso.",
  "🦈 Tubarões existem há mais de 400 milhões de anos, bem antes das árvores aparecerem na Terra.",
  "🐌 Um caracol pode ficar em hibernação profunda por até 3 anos quando o clima está desfavorável.",
  "🌈 Um arco-íris é, na verdade, um círculo completo. O horizonte só esconde a metade de baixo.",
  "🐬 Golfinhos dormem com metade do cérebro acordado, pra continuar respirando e vigiando o ambiente.",
  "🦩 Flamingos nascem cinzentos. A cor rosa vem dos pigmentos dos crustáceos e algas que eles comem ao longo da vida.",
  "🌍 A África é o único continente que se estende pelos quatro hemisférios do planeta ao mesmo tempo.",
  "🐊 O sangue de jacaré tem propriedades que combatem até bactérias resistentes a antibióticos comuns.",
  "🍎 Maçã, pêssego, ameixa e morango pertencem à mesma grande família botânica das rosas.",
  "🦎 Camaleões mudam de cor mais pra comunicar humor e temperatura do que pra se camuflar de predadores.",
  "🐢 Algumas espécies de tartaruga vivem mais de 150 anos, ultrapassando facilmente a expectativa de vida humana.",
  "🌊 Existem mais vulcões submersos no fundo do oceano do que em toda a superfície terrestre combinada.",
  "🦭 Focas conseguem mergulhar a mais de 500 metros de profundidade e prender a respiração por quase 1h20.",
  "🐺 Numa caminhada em grupo pela neve, lobos mais velhos costumam liderar a frente pra marcar o ritmo dos mais novos.",
  "🌙 As pegadas deixadas na Lua em 1969 continuam lá intactas até hoje, porque não existe vento nem chuva pra apagá-las.",
  "🐍 Cobras não têm pálpebras. Uma escama transparente protege os olhos delas o tempo todo, mesmo dormindo.",
  "🍄 O maior organismo vivo já identificado na Terra é um fungo com mais de 8 km² de extensão, no estado do Oregon.",
  "🦅 Águias enxergam com nitidez de 4 a 8 vezes maior que a visão humana, inclusive luz ultravioleta.",
  "🐋 Baleias jubarte compõem cantos que mudam com o tempo, e essas 'músicas' se espalham entre indivíduos diferentes.",
  "🌸 A cerejeira japonesa fica em flor por apenas duas semanas por ano, o que torna a época ainda mais especial por lá.",
  "🐿️ Esquilos enterram milhares de sementes por temporada e simplesmente esquecem a maioria dos esconderijos.",
  "🌋 O Krakatoa entrou em erupção com um estrondo ouvido a quase 5 mil km de distância, um recorde histórico de barulho.",
  "🦋 Dentro do casulo, a lagarta praticamente se desfaz numa espécie de líquido antes de se reorganizar como borboleta.",
  "🐫 Camelos não armazenam água na corcova. Lá dentro tem gordura, que serve de reserva de energia pro deserto.",
  "🧊 Icebergs guardam ar tão comprimido que, ao derreter, às vezes soltam um estalo quase como se estivessem 'crepitando'.",
  "🦔 Ouriços não lançam espinhos. A crença é popular, mas os espinhos só se soltam ao encostar em algo.",
  "🐄 Vacas têm uma espécie de 'melhor amiga' na manada e ficam visivelmente estressadas quando são separadas dela.",
  "🌻 Girassóis jovens acompanham o movimento do sol durante o dia e voltam a posição de leste antes do amanhecer.",
  "🐦‍⬛ O beija-flor é a única ave capaz de voar de costas, batendo as asas em formato de oito.",
  "🦥 Preguiças descem da árvore só uma vez por semana, basicamente pra fazer as necessidades no chão.",
  "🌎 O Brasil concentra mais espécies de plantas e animais do que qualquer outro país do mundo.",
  "🐙 O polvo consegue mudar de cor e textura da pele em menos de um segundo pra se camuflar perfeitamente.",
  "🌕 A Lua se afasta da Terra cerca de 3,8 cm por ano, um ritmo quase do tamanho do crescimento de uma unha.",
  "🐝 Uma abelha precisa visitar cerca de 2 milhões de flores só pra produzir um único pote de mel.",
  "🦓 Cada zebra tem um padrão de listras único, tão individual quanto uma impressão digital.",
  "🐧 Pinguins passam presentes de pedra pra parceira em algumas espécies, como uma espécie de 'pedido de namoro'.",
  "🌊 O oceano produz mais oxigênio pra atmosfera do que todas as florestas terrestres somadas.",
  "🐘 Elefantes fazem uma espécie de luto: visitam ossadas de outros elefantes e ficam ali por um tempo em silêncio.",
  "🦇 Morcegos são os únicos mamíferos capazes de voar de verdade, sem apenas planar como esquilos-voadores.",
  "🍇 Uvas podem soltar faíscas se colocadas no micro-ondas, um efeito curioso ligado à forma como a casca concentra energia.",
  "🐹 Hamsters conseguem correr o equivalente a vários quilômetros por noite só dentro da rodinha de exercício.",
  "🌌 A Via Láctea tem um buraco negro supermassivo bem no centro, ao redor do qual todo o resto da galáxia gira.",
  "🐺 Lobos uivam menos pra 'chamar a lua' e mais pra manter contato com o resto da matilha à distância.",
  "🦫 Castores conseguem represar rios inteiros, criando lagos que mudam completamente a paisagem ao redor.",
  "🐸 Alguns sapos conseguem congelar quase por completo no inverno e voltar a se mexer normalmente quando degelam.",
  "🌊 A Grande Barreira de Corais é a maior estrutura viva do planeta, visível até do espaço.",
  "🐦 Papagaios conseguem aprender o uso correto de palavras pra pedir comida ou expressar preferências.",
  "🧬 Você troca praticamente todas as células do corpo ao longo de uma década, então já foi 'outra pessoa' fisicamente algumas vezes.",
  "🐋 O coração de uma baleia-azul é do tamanho de um carro pequeno e bate só cerca de 9 vezes por minuto.",
  "🦭 Lontras marinhas dormem de mãos dadas em grupo pra não se separarem enquanto flutuam nas correntes.",
  "🌋 Existem mais vulcões ativos debaixo d'água do que na superfície visível de todos os continentes juntos.",
  "🐴 Cavalos conseguem dormir em pé, mas precisam se deitar de vez em quando pra entrar em sono profundo de verdade.",
  "🦉 Corujas não conseguem mover os olhos dentro da órbita, por isso giram o pescoço em até 270 graus.",
  "🐢 O tempo de gestação de um elefante dura quase 2 anos, o mais longo entre os mamíferos terrestres.",
  "🌊 Ondas gigantes formadas por tempestades distantes conseguem viajar milhares de quilômetros sem perder força.",
  "🐝 Vespas e abelhas conseguem reconhecer indivíduos da própria espécie por padrões faciais únicos.",
  "🦜 Araras vivem, em média, tanto quanto humanos, algumas passam dos 60 anos de idade em cativeiro.",
  "🐊 Crocodilos trocam de dente ao longo de toda a vida, podendo passar por milhares deles.",
  "🌎 Se toda a água do planeta coubesse numa bola, ela seria menor do que muita gente imagina, quase toda a água está nos oceanos.",
  "🐿️ Esquilos vermelhos escondem estoques de comida em vários pontos diferentes, como uma estratégia contra roubo.",
  "🦋 Borboletas monarca migram milhares de quilômetros mesmo sem nenhum indivíduo ter feito o trajeto antes.",
  "🐘 Elefantes se comunicam por infrassons que viajam por quilômetros no chão, imperceptíveis pro ouvido humano.",
  "🌱 Bambu é uma das plantas que mais crescem rápido no mundo, alguns tipos passam de 90 cm em um único dia.",
  "🐦 Andorinhas conseguem voar dormindo, alternando períodos curtos de sono enquanto ainda estão no ar.",
  "🦑 A lula-gigante tem os maiores olhos do reino animal, do tamanho de uma bola de basquete.",
  "🐻 Ursos-polares têm pele preta por baixo da pelagem, o que ajuda a absorver mais calor do sol.",
  "🌊 A pressão no ponto mais fundo do oceano é tão grande que esmagaria a maioria dos objetos feitos pelo homem.",
  "🐍 Pítons conseguem engolir presas bem maiores que a própria cabeça, graças a mandíbulas que se desencaixam.",
  "🦥 Preguiças gastam tão pouca energia que fungos e algas chegam a crescer no próprio pelo delas.",
  "🐦 Um bando de estorninhos consegue se mover no céu como se fosse um único organismo, sem líder aparente.",
  "🌙 A face da Lua que vemos é sempre a mesma porque ela leva o mesmo tempo pra girar em torno de si e da Terra.",
  "🐝 As abelhas conseguem se comunicar por meio de uma 'dança' que indica a distância e direção de uma flor.",
  "🦈 Tubarões-baleia, os maiores peixes do oceano, se alimentam basicamente só de plâncton e pequenos peixes.",
  "🐘 Elefantes usam a tromba pra abraçar outros elefantes como forma de consolo em momentos difíceis.",
  "🌊 A Corrente do Golfo carrega mais água do que todos os rios do planeta juntos.",
  "🐨 Coalas têm impressões digitais tão parecidas com as humanas que já confundiram até peritos em cenas de crime.",
  "🦋 As asas da borboleta não têm pigmento colorido em si, a cor vem da forma como escamas microscópicas refletem a luz.",
  "🐦 Pica-paus batem a cabeça no tronco várias vezes por segundo sem sofrer nenhum dano cerebral.",
  "🐢 Tartarugas-marinhas conseguem voltar pra desovar exatamente na mesma praia onde nasceram, décadas depois.",
  "🌵 O saguaro, um cacto gigante do deserto, pode levar mais de 70 anos só pra desenvolver o primeiro braço.",
  "🐍 A cascavel move o guizo mais rápido do que consegue vibrar um alarme comum, como aviso a predadores.",
  "🦭 Elefantes-marinhos machos podem pesar mais de 3 toneladas, quase tanto quanto um caminhão pequeno.",
  "🐦 Um bando de flamingos costuma sincronizar movimentos de corte como se estivesse ensaiando uma coreografia.",
  "🍄 Alguns fungos conseguem se comunicar com árvores através de redes subterrâneas, trocando nutrientes entre espécies.",
];

const CURIOSIDADES_TOPS: string[] = [
  "🤯 Todos os seus ancestrais, sem uma única exceção, sobreviveram tempo suficiente pra ter filhos. Você é o resultado direto de uma cadeia perfeita de sobrevivência!",
  "🌍 Os humanos existem há cerca de 300 mil anos. Isso representa menos de 0,01% da idade da Terra, somos recém-chegados absolutos.",
  "⚡ Um raio pode atingir 30 mil Kelvin de temperatura, cinco vezes mais quente que a superfície do Sol, e tudo isso dura só 0,2 segundos.",
  "🌊 O Oceano Pacífico sozinho é maior que toda a área de terra firme do planeta somada.",
  "👁️ Você não vê com os olhos, você vê com o cérebro. Os olhos só captam luz, quem monta a imagem final é o cérebro processando os sinais.",
  "😮 Cleópatra viveu mais perto da inauguração da Pizza Hut do que da construção das pirâmides do Egito. O tempo histórico engana bastante.",
  "🌌 Já nasceram cerca de 108 bilhões de pessoas em toda a história. Hoje, cerca de 8 bilhões estão vivas ao mesmo tempo, nunca tivemos tanta gente junta.",
  "🕳️ Alguns buracos negros são maiores que galáxias inteiras. A escala do universo é difícil até de imaginar direito.",
  "✨ Praticamente todos os átomos do seu corpo, menos o hidrogênio, foram forjados dentro de estrelas que explodiram há bilhões de anos.",
  "🧠 O número de conexões entre neurônios no seu cérebro é maior que o número de estrelas estimado na Via Láctea.",
  "☀️ A luz que sai do núcleo do Sol demora cerca de 170 mil anos pra chegar até a superfície dele, mas só 8 minutos pra chegar até você depois disso.",
  "🌋 A erupção do Krakatoa em 1883 foi ouvida a quase 5 mil quilômetros de distância, atravessando continentes inteiros.",
  "🚀 A velocidade mínima pra escapar da gravidade da Terra é de 11,2 km por segundo, dezenas de vezes mais rápido que uma bala comum.",
  "🧊 O zero absoluto nunca foi alcançado na prática. É um limite teórico da física que só pode ser aproximado, nunca atingido de fato.",
  "🌠 O Sol demora 225 milhões de anos pra dar uma volta completa em torno do centro da Via Láctea. Da última vez, os dinossauros ainda estavam por aqui.",
  "😴 Toda noite que você dorme, sua consciência praticamente 'desliga' por horas. Quem acorda no dia seguinte é, filosoficamente, uma continuação sua.",
  "🦠 Pra uma bactéria, um vírus é proporcionalmente do tamanho que uma bactéria é pra um ser humano. O mundo microscópico tem sua própria escala gigante.",
  "📡 O wifi de casa usa faixas de frequência parecidas com as do micro-ondas, a diferença real está na potência de transmissão.",
  "🏅 Einstein publicou a teoria da relatividade em 1905, mas o Nobel só veio em 1921, e olha que nem foi por essa teoria.",
  "🌕 A Lua está se afastando da Terra aos poucos. Em bilhões de anos, vai estar tão distante que eclipses totais vão deixar de existir.",
  "🐙 Dois terços dos neurônios de um polvo ficam nos tentáculos, cada braço age quase como se pensasse por conta própria.",
  "🔥 O fogo não projeta sombra. A luz que ele emite ilumina tudo ao redor, não existe bloqueio suficiente pra criar uma sombra visível.",
  "⏳ Pra um fóton de luz, o tempo simplesmente não passa. Da perspectiva dele, a viagem do Sol até você acontece em zero segundos.",
  "📏 O universo observável tem cerca de 93 bilhões de anos-luz de diâmetro, mesmo tendo só 13,8 bilhões de anos de idade. O espaço se expandiu mais rápido que a luz.",
  "🧬 Você tem cerca de 2 metros de DNA enrolado dentro de cada célula. Multiplicado pelas trilhões de células do corpo, dá pra ir e voltar do Sol centenas de vezes.",
  "🧲 O campo magnético da Terra já se inverteu centenas de vezes ao longo da história geológica, e atualmente está passando por um período de enfraquecimento.",
  "🦕 O Tirano-rex esteve mais perto, no tempo, dos humanos do que do Estegossauro. A era dos dinossauros foi bem mais longa do que parece.",
  "🔬 O oxigênio como elemento só foi descoberto oficialmente em 1774. Antes disso, ninguém sabia exatamente o que estava respirando.",
  "🌊 Se a Corrente do Golfo parasse de circular, o clima da Europa poderia esfriar drasticamente em poucas décadas.",
  "⚡ Dentro de um fio elétrico, os elétrons se movem devagar, quase a passos de lesma. O que se propaga rápido é o campo elétrico, não a partícula em si.",
  "🧊 A Antártica esconde vales, montanhas e até um lago líquido soterrado por quilômetros de gelo, isolado há milhões de anos.",
  "🕳️ Cair em direção a um buraco negro faria você, teoricamente, ver toda a história futura do universo comprimida num único clarão.",
  "🦈 Tubarões sobreviveram a cinco extinções em massa e existiam muito antes dos dinossauros aparecerem no planeta.",
  "🔄 As células do corpo humano se renovam quase por completo a cada década. Fisicamente falando, você já foi 'outra pessoa' algumas vezes.",
  "🧠 O cérebro consome praticamente a mesma energia dormindo e acordado. Sonhar exige quase tanto esforço metabólico quanto pensar.",
  "⭐ A estrela UY Scuti é tão grande que, se estivesse no lugar do Sol, sua superfície ultrapassaria a órbita de Júpiter.",
  "⏱️ Um ano tem cerca de 31,5 milhões de segundos. Cada um deles é, tecnicamente, um momento só seu que nunca mais vai se repetir.",
  "☀️ O Sol converte cerca de 4 milhões de toneladas de matéria em energia por segundo através da fusão nuclear.",
  "🧬 Perto de 98% do DNA humano não codifica proteínas diretamente. Boa parte dele regula quando e como os outros genes são ativados.",
  "🌌 Se o Sol fosse do tamanho de uma laranja, a Terra seria um grão de areia a cerca de 11 metros de distância dele.",
  "🦠 Existem mais bactérias em uma colher de terra do que o total de seres humanos que já viveram na história inteira.",
  "🔮 Uma partícula quântica pode existir em dois estados ao mesmo tempo, e só 'escolhe' um estado definitivo quando é observada.",
  "🌍 A luz que você vê vindo do Sol saiu de lá há 8 minutos. Toda vez que você olha pro céu, está literalmente vendo o passado.",
  "💥 Se as constantes físicas do universo fossem só um pouquinho diferentes logo após o Big Bang, nenhuma estrela teria se formado.",
  "🧂 Já encontraram bactérias vivas dentro de cristais de sal com 250 milhões de anos, mais velhas que os próprios dinossauros.",
  "🔇 No espaço, explosões simplesmente não fazem barulho. Sem átomos suficientes pra propagar o som, reina um silêncio absoluto.",
  "🏔️ O Himalaia continua crescendo cerca de 6 mm por ano, empurrado pelo choque contínuo das placas tectônicas.",
  "🐒 Compartilhamos quase 99% do DNA com chimpanzés. A pequena diferença restante explica toda a nossa cultura, linguagem e ciência.",
  "💧 A água que você bebeu hoje já passou, em algum momento, por dinossauros, oceanos antigos e geleiras, o ciclo da água é praticamente eterno.",
  "🧠 Sua decisão consciente de mover um dedo aparece no cérebro fração de segundo depois do impulso que já estava sendo preparado. A neurociência ainda discute o que isso significa pro livre-arbítrio.",
  "🌊 No ponto mais profundo do oceano, a pressão equivale a ter dezenas de aviões empilhados sobre um único ponto.",
  "🔥 O fogo é considerado plasma, o quarto estado da matéria. Na maior parte do universo, é essa a forma mais comum em que a matéria existe.",
  "🌌 O sistema solar inteiro está se movendo em direção a uma constelação distante a quase 20 km por segundo, sem que a gente perceba nada disso no dia a dia.",
  "🦈 O olfato do tubarão-branco consegue detectar uma gota de sangue diluída em cerca de 100 piscinas olímpicas de água.",
  "🧠 O cérebro gera dezenas de milhares de pensamentos por dia, mas a maior parte é repetição do que você já pensou antes.",
  "🌠 Em cerca de 5 bilhões de anos, o Sol vai se expandir tanto que pode engolir a órbita da Terra por completo.",
  "⭐ Cada átomo de ferro no seu sangue foi forjado dentro de uma estrela que explodiu bilhões de anos atrás. Você carrega poeira estelar dentro de si.",
  "🧮 Um computador quântico com poucas centenas de qubits consegue, em teoria, processar mais combinações do que existem átomos no universo observável.",
  "🌗 Um eclipse total só é possível porque o Sol é 400 vezes maior que a Lua, mas também está 400 vezes mais distante, um alinhamento quase coincidente demais.",
  "🧬 Cerca de 8% do genoma humano vem de vírus antigos que infectaram nossos ancestrais há milhões de anos e ficaram registrados no DNA.",
  "🌊 A corrente termohalina do oceano leva cerca de mil anos pra completar um ciclo inteiro ao redor do planeta.",
  "🪐 Júpiter é tão massivo que o centro de gravidade dele com o Sol fica ligeiramente fora da superfície solar, os dois na prática giram um ao redor do outro.",
  "🧠 Uma pessoa adulta gera, em média, mais de 6 mil pensamentos por dia, segundo estudos recentes de neuroimagem.",
  "🌋 Existe uma reserva de magma sob o Parque de Yellowstone grande o bastante pra ser classificada como supervulcão.",
  "🌊 A profundidade média dos oceanos é maior que a altura média das montanhas continentais, o planeta é mais 'fundo' do que 'alto'.",
  "🧬 Cerca de 1 em cada 200 homens vivos hoje descende diretamente da linhagem de Genghis Khan, segundo estudos genéticos populacionais.",
  "🌌 A galáxia de Andrômeda está numa rota de colisão com a Via Láctea, só que a fusão completa deve acontecer daqui uns 4 bilhões de anos.",
  "🧊 O gelo da Antártica guarda bolhas de ar de centenas de milhares de anos atrás, um registro direto da atmosfera antiga do planeta.",
  "🐋 O canto de uma baleia-azul pode ser ouvido por outras baleias a centenas de quilômetros de distância debaixo d'água.",
  "🌡️ A temperatura mais baixa já registrada na Terra, na Antártica, chegou perto de -89°C, frio o bastante pra congelar o ar exalado quase instantaneamente.",
  "🧠 O cérebro humano continua se desenvolvendo estruturalmente até por volta dos 25 anos de idade.",
  "🌊 O maior terremoto já registrado, no Chile em 1960, foi forte o suficiente pra alterar ligeiramente a duração do dia na Terra.",
  "🪨 Alguns meteoritos encontrados na Terra são mais antigos que o próprio planeta, restos da formação inicial do sistema solar.",
  "🧬 O genoma da cebola tem mais informação genética do que o genoma humano, apesar de ser uma planta aparentemente simples.",
  "🌠 A cada segundo, dezenas de neutrinos vindos do espaço atravessam o seu corpo sem causar efeito nenhum perceptível.",
  "🌊 O nível do mar já foi mais de 120 metros mais baixo durante a última era glacial, terras hoje submersas eram litoral seco.",
  "🧠 O cérebro processa imagens em uma fração de segundo tão pequena que muitas vezes você reage antes de perceber conscientemente o que viu.",
  "🌋 A Islândia se forma sobre uma fronteira de placas tectônicas que se afastam a poucos centímetros por ano, literalmente crescendo aos poucos.",
  "🧬 Formigas conseguem carregar, proporcionalmente, dezenas de vezes o próprio peso corporal, uma proeza que nenhum humano chega perto de igualar em escala.",
  "🌌 A luz das estrelas mais distantes que você vê no céu pode ter partido antes mesmo de o sistema solar existir.",
  "🧊 O Monte Everest ainda está crescendo, empurrado centímetro a centímetro pela mesma colisão de placas que o formou.",
  "🦴 O osso mais forte do corpo humano, proporcionalmente ao tamanho, é o fêmur, capaz de suportar um peso muito maior do que o concreto na mesma proporção.",
  "🌊 Cientistas estimam que ainda exista mais espécie marinha desconhecida do que catalogada, mesmo depois de séculos de exploração.",
  "🧠 A dor 'fantasma' registrada em membros amputados mostra que boa parte da sensação de corpo vem inteiramente do cérebro, não do membro em si.",
  "🌡️ A temperatura no núcleo da Terra chega perto da temperatura da superfície do Sol, mesmo estando a milhares de quilômetros de profundidade.",
];

const FATOS_COMPLEXOS: string[] = [
  "🧠 Cada vez que você lembra de algo, o cérebro reconstrói a memória do zero, o que significa que ela muda um pouco a cada lembrança. As mais vívidas nem sempre são as mais precisas.",
  "⚡ Elétrons não correm por um fio na velocidade da luz, eles se movem devagar. O que se propaga rápido é o campo elétrico que os empurra em cadeia.",
  "🌊 O chamado paradoxo da costa mostra que, quanto mais de perto você mede uma linha costeira, mais comprida ela parece ficar, sem um valor 'real' fixo.",
  "🔥 O fogo é um plasma, formado por íons e elétrons excitados emitindo luz enquanto reagem quimicamente com o oxigênio do ar.",
  "🌀 O princípio da incerteza de Heisenberg não é limitação de instrumento, é característica da própria realidade: posição e velocidade de uma partícula nunca são totalmente definidas ao mesmo tempo.",
  "🧬 Seleção natural não significa sobrevivência do mais forte, e sim de quem consegue deixar mais descendentes. Força física nem sempre entra na equação.",
  "🌍 A tectônica de placas regula o CO₂ da atmosfera, o nível dos oceanos e o clima global, muito além de só causar terremotos.",
  "💡 O efeito fotoelétrico mostrou que a luz se comporta como onda e como partícula ao mesmo tempo, contrariando boa parte da intuição clássica da física.",
  "🌊 A corrente termohalina dos oceanos leva cerca de mil anos pra completar um ciclo, e ela tem papel direto na regulação do clima planetário.",
  "🧬 Perto de 8% do genoma humano é formado por sequências de vírus antigos, incorporados ao nosso DNA há milhões de anos.",
  "🕯️ Modelar matematicamente a chama de uma vela de forma completa exige simular centenas de reações químicas simultâneas, algo que só supercomputadores conseguem de verdade.",
  "🔗 Em física quântica, duas partículas podem ficar entrelaçadas de um jeito que o que acontece com uma afeta a outra instantaneamente, mesmo a distâncias enormes.",
  "⚗️ A maioria dos metais é formada por grãos cristalinos microscópicos. Boa parte da metalurgia é literalmente a arte de controlar esses cristais.",
  "🧠 O chamado 'problema difícil da consciência' pergunta como impulsos elétricos no cérebro criam a experiência subjetiva de simplesmente 'ser você', e ainda não há resposta definitiva.",
  "🌡️ O zero absoluto nunca pode ser atingido de fato, apenas aproximado, já que tirar a última fração de energia de um sistema exigiria energia infinita.",
  "🌌 A matéria escura não emite nem reflete luz. Sabemos que ela existe pelo efeito gravitacional que provoca, mas nunca foi detectada diretamente.",
  "⚡ O tunelamento quântico permite que partículas atravessem barreiras que, pela física clássica, seriam intransponíveis, e é graças a isso que o Sol consegue brilhar.",
  "🔭 Quando você olha pro céu à noite, está literalmente vendo o passado. A luz de Andrômeda que chega até você saiu de lá há 2,5 milhões de anos.",
  "🌊 A ressonância de Schumann, uma frequência eletromagnética natural da Terra, coincide de forma curiosa com o ritmo alfa registrado no cérebro humano.",
  "🧬 Gêmeos idênticos compartilham o mesmo DNA, mas desenvolvem epigenomas diferentes ao longo da vida, o que ajuda a explicar diferenças de personalidade entre eles.",
  "🔬 A especiação simpátrica acontece quando duas espécies surgem a partir da mesma população sem qualquer separação geográfica entre elas.",
  "👁️ No chamado paradoxo do observador, medir uma partícula muda o comportamento dela. A realidade pareceria existir em superposição até o momento da observação.",
  "🧲 O campo magnético da Terra já se inverteu centenas de vezes ao longo da história geológica e atualmente está num período de enfraquecimento gradual.",
  "✂️ A tecnologia CRISPR funciona como uma tesoura molecular capaz de cortar o DNA em posições exatas, abrindo caminho pra edição genética de precisão.",
  "🕳️ O horizonte de eventos de um buraco negro marca o ponto onde nem a luz consegue escapar, e o que acontece além dele é, até hoje, matematicamente indescritível.",
  "🧠 A chamada 'rede de modo padrão' do cérebro fica mais ativa quando você não está fazendo nada de específico, e é justamente nesse estado que muitos insights criativos surgem.",
  "🌊 A estratificação oceânica divide o mar em camadas de temperatura e densidade que quase não se misturam, criando ecossistemas isolados em profundidades diferentes.",
  "💧 A queima de hidrogênio como combustível gera só água como resíduo, o desafio real está em armazená-lo de forma segura e eficiente.",
  "⚡ A supercondutividade acontece quando certos materiais, em temperaturas muito baixas, perdem toda a resistência elétrica e permitem corrente circulando quase sem perda de energia.",
  "🧬 Os neurônios do cérebro estão entre as poucas células do corpo que praticamente não se renovam ao longo da vida, mesmo quando o resto do organismo troca de células constantemente.",
  "🌌 A expansão do universo está acelerando, e não desacelerando como a gravidade sugeriria. Chamamos essa força desconhecida de energia escura.",
  "💡 Um laser não existe naturalmente, ele é uma luz de engenharia precisa: coerente, de um único comprimento de onda e praticamente sem divergência.",
  "🔬 A teoria evolutiva moderna combina Darwin com a genética de Mendel, mostrando como variações aleatórias, somadas ao tempo, geram complexidade sem precisar de um plano definido.",
  "🌊 O efeito Mpemba descreve como, em certas condições, água quente pode congelar mais rápido que água fria, e ainda não existe consenso completo sobre o motivo.",
  "⚗️ O condensado de Bose-Einstein é considerado o quinto estado da matéria, formado perto do zero absoluto, onde partículas passam a se comportar como uma única entidade quântica.",
  "🧠 Na síndrome do membro fantasma, pessoas amputadas ainda sentem dor num membro que não existe mais, porque o cérebro mantém o mapa original do corpo.",
  "🪐 Na relatividade geral, a gravidade não é bem uma força, é a curvatura do espaço-tempo causada por massa. A Terra orbita o Sol porque ele curva o espaço ao redor dele.",
  "🧬 Mitocôndrias têm DNA próprio, diferente do DNA do núcleo da célula, um indício de que já foram bactérias independentes incorporadas há bilhões de anos.",
  "🌉 A ponte de Tacoma Narrows desabou em 1940 porque o vento criou oscilações exatamente na frequência de ressonância da estrutura, um caso clássico estudado até hoje em engenharia.",
  "🧠 Na sinestesia, um estímulo de um sentido ativa outro sentido diferente, fazendo algumas pessoas literalmente associarem cores a sons ou números a texturas.",
  "☀️ A energia solar que chega à Terra em apenas uma hora seria suficiente pra suprir toda a demanda energética da humanidade por um ano inteiro.",
  "🧬 A epigenética estuda como fatores do ambiente ligam ou desligam genes sem alterar a sequência do DNA, e algumas dessas marcas podem até passar pra próxima geração.",
  "♾️ A teoria dos conjuntos mostrou que existem infinitos maiores que outros, o infinito dos números reais é 'maior' que o dos números inteiros, mesmo os dois sendo infinitos.",
  "🌊 O efeito das marés não vem só da força gravitacional em si, mas da diferença dessa força entre o lado próximo e o lado distante da Terra em relação à Lua.",
  "🔥 A segunda lei da termodinâmica impede máquinas de movimento perpétuo, já que a entropia de sistemas isolados tende sempre a aumentar.",
  "🧠 No efeito Dunning-Kruger, pessoas com pouco conhecimento sobre um assunto tendem a superestimar a própria competência, enquanto especialistas costumam se avaliar de forma mais cautelosa.",
  "⚗️ Catalisadores aceleram reações químicas sem serem consumidos no processo, o mesmo princípio usado tanto no catalisador do carro quanto nas enzimas do corpo humano.",
  "👽 O paradoxo de Fermi questiona por que, com tantos planetas potencialmente habitáveis no universo, ainda não encontramos nenhum sinal de vida inteligente fora da Terra.",
  "🧬 Bactérias usam um sistema parecido com o CRISPR na natureza, guardando pedaços de DNA viral pra reconhecer e destruir vírus conhecidos no futuro.",
  "⚛️ A fusão nuclear une átomos leves liberando energia enorme, é o mesmo processo que alimenta o Sol, e dominá-la na Terra seria uma revolução energética.",
  "💻 Computadores quânticos usam qubits que podem representar 0 e 1 ao mesmo tempo, permitindo processar um número absurdo de combinações em paralelo.",
  "🌊 A bioluminescência é gerada por reações químicas enzimáticas, e a maior parte das criaturas encontradas nas profundezas do oceano produz luz própria.",
  "🧠 A neuroplasticidade permite que o cérebro se reorganize fisicamente com a experiência, taxistas que decoram rotas complexas costumam ter regiões cerebrais mais desenvolvidas.",
  "⚛️ O paradoxo EPR sugeriu uma espécie de 'ação à distância' na mecânica quântica, e experimentos posteriores confirmaram que a realidade quântica realmente não é local.",
  "🌌 A matéria que conseguimos observar representa só uma fração pequena do universo, o resto é dividido entre matéria escura e energia escura, ambas ainda um mistério.",
  "🧬 O splicing alternativo permite que um único gene produza várias proteínas diferentes, o que ajuda a explicar como poucos genes geram tanta complexidade biológica.",
  "💻 A lei de Moore previu que a quantidade de transistores em um chip dobraria a cada dois anos, e funcionou por décadas até esbarrar em limites físicos quânticos.",
  "⚛️ Na interferência quântica, elétrons formam padrões mesmo passando um de cada vez por duas fendas, como se cada elétron interferisse com uma versão de si mesmo.",
  "🌊 A mucosa do estômago se renova a cada poucos dias, justamente porque o ácido estomacal é forte o bastante pra dissolver boa parte dos tecidos comuns.",
  "🧠 Memórias consolidadas durante o sono profundo tendem a ser mais duráveis, o que reforça a ideia de que dormir bem é parte ativa do processo de aprendizado.",
  "🔭 O horizonte cósmico marca o limite do que conseguimos observar, já que a luz de regiões mais distantes ainda não teve tempo de chegar até nós.",
  "🧬 Na evolução convergente, espécies sem parentesco próximo desenvolvem estruturas parecidas de forma independente, como os olhos de polvos e de vertebrados.",
  "♾️ O teorema da incompletude de Gödel mostrou que, em qualquer sistema matemático suficientemente complexo, sempre existirão afirmações verdadeiras que não podem ser provadas dentro dele mesmo.",
  "🧠 O efeito placebo é forte o bastante pra provocar mudanças fisiológicas mensuráveis, mesmo quando a pessoa sabe, em algum nível, que está tomando algo inerte.",
  "🌊 A hipótese de Gaia propõe que a biosfera da Terra se comporta quase como um sistema autorregulado, mantendo condições favoráveis à vida ao longo do tempo.",
  "⚛️ O princípio de exclusão de Pauli explica por que dois elétrons não podem ocupar exatamente o mesmo estado quântico, e é isso que dá estrutura à matéria como conhecemos.",
  "🧬 A hipótese da Rainha Vermelha sugere que espécies precisam evoluir constantemente só pra manter a mesma posição relativa diante de predadores e parasitas que também evoluem.",
  "🌡️ A lei zero da termodinâmica é a base que permite definir temperatura de forma consistente, mesmo sendo formulada depois das outras leis da termodinâmica.",
  "🔬 O efeito observador em física quântica não significa que a consciência humana altera a realidade, é a própria interação física da medição que causa a mudança.",
  "🧠 A memória de curto prazo consegue reter, em média, entre 4 e 7 itens de cada vez antes de começar a perder informação.",
  "🌌 A teoria de cordas propõe que partículas fundamentais seriam, na verdade, pequenas cordas vibrando em dimensões extras que não conseguimos perceber diretamente.",
  "⚗️ A entropia de um sistema fechado tende sempre a aumentar, o que ajuda a explicar por que processos como quebrar um ovo são fáceis de fazer e quase impossíveis de reverter sozinhos.",
  "🧬 A deriva genética pode mudar a frequência de características numa população inteira só por acaso, sem qualquer vantagem evolutiva envolvida.",
  "🌊 O fenômeno da ressonância explica por que soldados costumam quebrar o passo ao atravessar pontes, evitando que a marcha sincronizada amplifique vibrações perigosas.",
  "🧠 O cérebro prioriza economia de energia o tempo todo, e boa parte dos chamados vieses cognitivos são atalhos criados justamente pra gastar menos esforço mental.",
  "⚛️ A dualidade onda-partícula mostra que elétrons e fótons podem se comportar como onda ou como partícula, dependendo de como o experimento é montado.",
  "🌋 A tectônica de placas é rara no sistema solar, até onde sabemos, a Terra é o único planeta rochoso conhecido onde esse processo acontece de forma tão ativa.",
  "🧬 A hipótese do mundo de RNA sugere que, antes do DNA existir, moléculas de RNA teriam sido capazes tanto de guardar informação quanto de catalisar reações sozinhas.",
  "🔬 O princípio da parcimônia, conhecido como navalha de Occam, não prova que a explicação mais simples é sempre verdadeira, só que ela deve ser testada primeiro.",
  "🧠 A plasticidade sináptica permite que conexões entre neurônios se fortaleçam ou enfraqueçam com a experiência, é a base física do aprendizado.",
  "🌌 Segundo a relatividade geral, quanto mais forte a gravidade em um ponto, mais devagar o tempo passa ali, um efeito já medido com precisão em satélites de GPS.",
  "⚗️ Reações exotérmicas liberam energia na forma de calor, enquanto reações endotérmicas absorvem energia do ambiente, o mesmo princípio que explica compressas quentes e frias.",
  "🧬 O conceito de aptidão evolutiva não mede força ou inteligência isoladas, mede exclusivamente o sucesso reprodutivo de um organismo dentro do próprio ambiente.",
  "🌊 O efeito Coriolis faz com que sistemas de vento e correntes girem em sentidos opostos nos hemisférios norte e sul, resultado direto da rotação da Terra.",
  "🧠 O viés de confirmação leva as pessoas a notarem com mais facilidade informações que reforçam o que elas já acreditam, ignorando o que contradiz.",
  "⚛️ Um único átomo de urânio-235 pode iniciar uma reação em cadeia inteira, cada divisão libera nêutrons que atingem outros átomos vizinhos.",
  "🌌 A lei de Hubble mostra que quanto mais distante uma galáxia está, mais rápido ela parece se afastar de nós, uma das evidências centrais da expansão do universo.",
  "🧬 Espécies invasoras costumam se espalhar rápido justamente porque chegam a ambientes sem os predadores naturais que limitavam a população delas na origem.",
  "🔬 O método científico não busca provar teorias como verdades absolutas, ele busca testá-las de um jeito que permita refutá-las se estiverem erradas.",
  "🧠 O cérebro interpreta a ausência de informação sensorial como um sinal de perigo, o que ajuda a explicar por que ambientes muito silenciosos podem soar desconfortáveis.",
  "🌊 Recifes de coral crescem tão devagar que uma estrutura de poucos metros pode representar séculos de desenvolvimento acumulado.",
  "⚗️ Catalisadores biológicos, as enzimas, conseguem acelerar reações químicas em ordens de grandeza, tornando possíveis processos que levariam tempo demais sem elas.",
  "🧬 A poliploidia, ter conjuntos extras de cromossomos, é rara em animais mas relativamente comum em plantas, e ajudou a originar várias espécies agrícolas que cultivamos hoje.",
  "🌌 A velocidade da luz no vácuo é o mesmo valor para qualquer observador, independentemente da velocidade dele, uma das bases centrais da relatividade especial.",
  "🧠 A dor crônica pode persistir mesmo depois que o tecido original já cicatrizou, porque o sistema nervoso central se reorganiza em torno do próprio sinal de dor.",
  "🔬 A reprodutibilidade de um experimento é um dos pilares da ciência, um resultado só se torna confiável quando outros pesquisadores conseguem repeti-lo de forma independente.",
];

// ---------------------------------------------------------------------------
// Funções públicas
// ---------------------------------------------------------------------------

/** Retorna uma legenda aleatória do pool indicado. */
export function getAutoCaption(type: AutoCaptionType): string {
  const pool = getPool(type);
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Retorna `count` legendas únicas e embaralhadas do pool indicado.
 * Se `count` > pool.length, o pool é reutilizado em ciclos para nunca retornar vazio.
 */
export function getUniqueCaptions(type: AutoCaptionType, count: number): string[] {
  const pool = getPool(type);
  if (count <= 0) return [];

  const result: string[] = [];
  const shuffled = shuffleArray([...pool]);

  while (result.length < count) {
    for (const cap of shuffleArray([...pool])) {
      if (result.length >= count) break;
      result.push(cap);
    }
  }

  return result.slice(0, count);
}

/**
 * Identifica se uma legenda pertence a um dos pools automáticos (match exato).
 * Usado para inferir, a partir de posts já criados, se uma campanha estava
 * usando legendas automáticas e de qual tipo — sem precisar de config salva.
 */
export function matchAutoCaptionType(caption: string): AutoCaptionType | null {
  const trimmed = caption.trim();
  if (!trimmed) return null;
  for (const type of ["curiosidades-gerais", "curiosidades-tops", "fatos-complexos"] as AutoCaptionType[]) {
    if (getPool(type).includes(trimmed)) return type;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function getPool(type: AutoCaptionType): string[] {
  switch (type) {
    case "curiosidades-tops":    return CURIOSIDADES_TOPS;
    case "fatos-complexos":      return FATOS_COMPLEXOS;
    // "variado" mistura os 3 pools — cada legenda sorteada (getAutoCaption)
    // ou cada posição embaralhada (getUniqueCaptions) pode vir de qualquer tipo.
    case "variado":               return [...CURIOSIDADES_GERAIS, ...CURIOSIDADES_TOPS, ...FATOS_COMPLEXOS];
    case "curiosidades-gerais":
    default:                     return CURIOSIDADES_GERAIS;
  }
}

function shuffleArray<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
