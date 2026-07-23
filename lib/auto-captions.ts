// Pool de legendas automáticas para postagens — curiosidades em PT-BR otimizadas para Instagram.
// Cada pool tem 60 variações para evitar repetição nas primeiras semanas de uso.

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
  "🍯 O mel nunca estraga. Arqueólogos encontraram potes com mais de 3.000 anos nas pirâmides do Egito e ainda estavam comestíveis! A natureza tem seus próprios conservantes.",
  "🧠 Seu cérebro usa 20% de toda a energia do seu corpo, mesmo pesando apenas 2% do seu peso total. É literalmente o órgão mais guloso que você tem! ⚡",
  "🌊 Conhecemos melhor a superfície da Lua do que o fundo dos nossos oceanos. 95% das profundezas marinhas nunca foram exploradas de perto!",
  "🦋 As borboletas provam os alimentos com os pés. Elas têm células gustativas nas patas para saber se uma planta é boa para botar ovos! 🌿",
  "🌿 As árvores se comunicam através de uma rede subterrânea de fungos. Compartilham nutrientes e avisos sobre pragas entre si, a famosa 'internet da floresta'! 🍄",
  "🐋 O coração de uma baleia azul pesa cerca de 600 kg. É do tamanho de um carro pequeno e bate apenas 9 vezes por minuto! 💙",
  "⭐ O Sol é tão grande que 1,3 milhão de Terras caberiam dentro dele. E ainda assim ele é considerado uma estrela de tamanho médio! 🌌",
  "🦈 Os tubarões existem há mais de 450 milhões de anos, antes mesmo das árvores existirem na Terra. Sobreviveram a 5 extinções em massa! 🌊",
  "🧬 Você compartilha 60% do seu DNA com uma banana. Somos mais parecidos com frutas do que imaginamos! 🍌",
  "🦦 As lontras marinhas dormem de mãos dadas para não se separarem durante as correntes do mar. Uma das coisas mais fofas da natureza! 🌊",
  "🐘 Os elefantes são um dos poucos animais que reconhecem a si mesmos no espelho, assim como humanos, grandes primatas e golfinhos! 🪞",
  "🌋 Existem mais vulcões no fundo do oceano do que em toda a superfície da Terra. A maioria nunca foi estudada de perto!",
  "🦕 Os dinossauros viveram na Terra por 165 milhões de anos. Os humanos existem há apenas 300 mil anos, somos absolutamente recém-chegados! 😳",
  "🌙 Os rastros de pegadas que Neil Armstrong deixou na Lua em 1969 ainda estão lá. Sem vento nem chuva, nada os apaga!",
  "🐌 Um caracol pode dormir por até 3 anos sem se alimentar. Quando as condições climáticas são ruins, ele entra em hibernação profunda!",
  "💎 Os diamantes e o grafite do seu lápis são feitos exatamente do mesmo material: carbono puro. A diferença está só na organização dos átomos!",
  "🦩 Os flamingos nascem brancos, não cor-de-rosa. A coloração vem dos pigmentos das algas e camarões que comem! 🎨",
  "🌈 Arco-íris são círculos completos, não meias-luas. O chão bloqueia a metade inferior. Do avião você vê o círculo inteiro!",
  "🦁 Uma leoa passa 95% da vida em repouso. O descanso não é preguiça, é estratégia evolutiva de eficiência energética!",
  "🧲 Se você removesse todo o espaço vazio dos átomos do corpo humano, toda a humanidade caberia em um cubo de açúcar!",
  "🌺 A baunilha é extraída de uma orquídea polinizada por apenas um tipo de abelha encontrada no México. Por isso é tão rara e cara! 🐝",
  "🐬 Golfinhos dormem com um olho aberto. Metade do cérebro permanece acordada enquanto a outra descansa, para continuar nadando e respirando! 😴",
  "🦔 Os porcos-espinhos não atiram seus espinhos. Eles ficam soltos e se prendem em predadores que os tocam, é uma crença popular errada!",
  "🌵 Um cacto pode armazenar até 200 litros de água. Algumas espécies vivem mais de 200 anos sem precisar de chuva regular!",
  "🐝 Para fazer apenas um pote de mel, uma abelha precisa visitar cerca de 2 milhões de flores e voar o equivalente a 3 voltas ao mundo! 🍯",
  "⚡ Um raio tem temperatura de 30.000 Kelvin, 5 vezes mais quente que a superfície do Sol. E dura apenas 0,2 segundos!",
  "🌍 A África é o único continente que toca os quatro hemisférios: Norte, Sul, Leste e Oeste simultaneamente!",
  "🦎 Alguns lagartos conseguem jogar a própria cauda fora para escapar de predadores e ela cresce de volta! A natureza é incrível. 😮",
  "🐊 O sangue dos crocodilos mata bactérias que até antibióticos não destroem. Cientistas estudam seu sistema imunológico para criar novos remédios!",
  "🌠 Existem mais estrelas no universo do que grãos de areia em todas as praias da Terra. O cosmos é inimaginavelmente imenso! ✨",
  "🐠 O peixe-palhaço pode mudar de sexo. Todos nascem machos e quando a fêmea dominante morre, o macho maior se transforma em fêmea! 🌊",
  "🍎 A maçã e a rosa fazem parte da mesma família de plantas. Pêssegos, ameixas e morangos também são parentes das rosas! 🌹",
  "🦎 O camaleão não muda de cor para se camuflar. Ele faz isso para comunicar emoções e status, é a linguagem da cor deles!",
  "🌱 A semente de lótus mais antiga germinada com sucesso em laboratório tinha 1.300 anos. A vida sempre encontra um jeito!",
  "🦭 As focas podem mergulhar até 600 metros e ficar submersas por 80 minutos. Seu sangue armazena oxigênio de forma muito mais eficiente que o nosso!",
  "🐻 Os ursos polares têm pelo transparente, não branco. Cada fio é oco e incolor, parece branco por refletir a luz solar! ❄️",
  "🌊 A Corrente do Golfo transporta 30 vezes mais água do que todos os rios do mundo juntos. Ela regula o clima de toda a Europa!",
  "🦜 Alguns papagaios aprendem a usar palavras corretamente para pedir comida, mostrar emoções e até enganar seus tratadores!",
  "🦠 Seu corpo tem mais células bacterianas do que células humanas. Cerca de 38 trilhões de bactérias vivem em você, a maioria essencial à saúde!",
  "🧊 O iceberg que afundou o Titanic tinha entre 10.000 e 100.000 anos de idade. Ele viajou da Groenlândia por anos antes do encontro fatal!",
  "🦓 Cada zebra tem um padrão de listras único, como uma impressão digital. Pesquisadores identificam indivíduos pelas listras!",
  "🍄 O maior organismo da Terra é um fungo em Oregon (EUA) com mais de 8 km². Tem 8.000 anos e continua crescendo sob o solo!",
  "🐦 O beija-flor é o único pássaro que consegue voar para trás. Seu coração pode bater até 1.260 vezes por minuto durante o voo!",
  "💤 Você passa um terço da vida dormindo. Se viver até os 90 anos, terá dormido cerca de 30 anos! Não é tempo perdido, é manutenção vital.",
  "🌎 O Brasil tem mais espécies de animais e plantas do que qualquer outro país. Mais de 100.000 espécies, 13% de toda a biodiversidade terrestre! 🌿",
  "🐙 O polvo tem três corações, sangue azul e cada tentáculo tem um 'mini-cérebro' próprio. Se há aliens na Terra, são os polvos! 🦑",
  "🎵 Plantas crescem mais rápido quando expostas à música clássica. As frequências das ondas sonoras afetam as células vegetais! 🌱",
  "🌙 A Lua está se afastando da Terra 3,8 cm por ano. Bilhões de anos atrás, ela era muito maior no céu e as marés eram gigantescas!",
  "🧬 Todo o DNA do seu corpo, se esticado em linha, mediria 70 bilhões de km, suficiente para ir e voltar ao Sol 190 vezes!",
  "🐺 Num grupo de lobos que caminha pela neve, os mais velhos e lentos ficam na frente para definir um ritmo que todos consigam seguir. ❤️",
  "🐧 Os pinguins ficam com o mesmo par vida toda. Quando os machos encontram a parceira, oferecem uma pedra como presente! 💎",
  "🌊 O oceano produz mais da metade do oxigênio que respiramos, não as florestas! O verdadeiro pulmão do planeta fica embaixo d'água.",
  "🦋 A metamorfose da borboleta dentro do casulo não é uma transformação gradual. A lagarta se dissolve em uma sopa líquida e é reconstruída do zero!",
  "🌸 A cerejeira floresce por apenas 2 semanas por ano no Japão. A cultura inteira do 'hanami' existe para apreciar essa beleza fugaz! 🍡",
  "⚡ Os neurônios do seu cérebro disparam sinais elétricos a até 120 metros por segundo, mais rápido que um carro de Fórmula 1!",
  "🐋 As baleias cantam músicas que evoluem ao longo do tempo. Novas melodias se espalham de baleia em baleia pelo oceano, como hits musicais! 🎵",
  "🦊 As raposas usam o campo magnético da Terra para caçar. Elas se posicionam em relação ao norte para calcular a distância e o salto! 🧲",
  "🐘 Os elefantes são os únicos animais além dos humanos que têm rituais de luto. Eles visitam os ossos dos ancestrais e parecem reconhecê-los! 💀",
  "🌊 O ponto mais fundo do oceano, no Abismo de Challenger, é mais profundo do que o Everest é alto. São 11.034 metros de profundidade!",
  "🦅 Águias têm visão 4 a 8 vezes mais nítida que a humana. Elas enxergam raios UV, o que nos parece branco para elas é colorido! 🌈",
  "⭐ Todo ouro, prata e platina na Terra veio de colisões entre estrelas de nêutrons bilhões de anos atrás. Suas joias têm origem cósmica! 💫",
];

const CURIOSIDADES_TOPS: string[] = [
  "🤯 INACREDITÁVEL: Você existe porque TODOS os seus ancestrais, sem exceção, sobreviveram e tiveram filhos desde o início da vida na Terra. Você é um milagre de bilhões de anos! 🌍",
  "😱 O tempo que os humanos existem na Terra (300 mil anos) é apenas 0,007% dos 4,5 bilhões de anos do planeta. Somos recém-chegados absolutos na história do mundo! ⏰",
  "🔥 SURPREENDENTE: A temperatura de um raio é 5 vezes mais quente que a superfície do Sol. E dura apenas 0,2 segundos. A natureza tem poderes que a ficção não acompanha! ⚡",
  "🌊 O Oceano Pacífico é maior que toda a massa continental do planeta combinada. Ele poderia engolir todos os continentes com espaço sobrando!",
  "⚡ CHOCANTE: Você não vê com os olhos, você vê com o cérebro. Os olhos captam luz e enviam sinais. Todo o 'mundo' que você enxerga é uma simulação construída pelo seu cérebro!",
  "😮 Cleopatra viveu mais perto da construção da Pizza Hut (1958) do que da construção das Pirâmides (2560 a.C.). O passado é muito mais distante do que percebemos!",
  "🤯 Em toda a história da humanidade, cerca de 108 bilhões de pessoas já nasceram. Hoje existem 8 bilhões vivas ao mesmo tempo, nunca houve tanta gente simultânea!",
  "🌑 Existem buracos negros maiores que nossa galáxia inteira. Alguns têm massa bilhões de vezes superior ao Sol. A escala do universo destrói qualquer intuição humana!",
  "🧬 Você é literalmente feito de estrelas. Todos os átomos do seu corpo (exceto hidrogênio) foram forjados dentro de estrelas que explodiram bilhões de anos atrás! ✨",
  "😱 MENTAL: O número de sinapses no seu cérebro é maior do que o número de estrelas na Via Láctea. Você literalmente carrega um universo dentro da cabeça! 🌌",
  "🔥 A luz que você vê do Sol saiu do núcleo solar há 170.000 anos. Mas levou apenas 8 minutos para percorrer os 150 milhões de km até você!",
  "💀 PERTURBADOR: Se você misturasse toda a humanidade uniformemente no oceano, a concentração seria menor que 1 pessoa por km³. Somos estatisticamente irrelevantes no universo!",
  "🌋 A erupção do Krakatoa em 1883 foi ouvida a 5.000 km de distância, cruzando continentes. Uma das explosões mais barulhentas já registradas na história! 💥",
  "🚀 A velocidade de escape da Terra é 11,2 km por segundo. Um tiro de revólver vai a 0,37 km/s, 30 vezes mais lento do que o mínimo para sair da gravidade!",
  "🧊 O zero absoluto (-273,15°C) nunca foi atingido. É um limite termodinâmico: extrair a última unidade de energia de um sistema requereria energia infinita!",
  "⭐ O Sol viaja ao redor do centro da Via Láctea a 220 km/s. Levamos 225 milhões de anos para completar uma 'volta galáctica'. A última ocorreu na era dos dinossauros!",
  "🧠 FILOSÓFICO: Cada vez que você dorme, você basicamente 'apaga'. Sua consciência desaparece por horas. Uma versão similar a você acorda no dia seguinte!",
  "🌊 Ondas oceânicas podem se propagar por milhares de quilômetros sem perder energia. Uma tempestade no Japão pode criar ondas que chegam à costa brasileira!",
  "🦠 MINÚSCULO: Um vírus é para uma bactéria o que uma bactéria é para um ser humano. O mundo microscópico tem sua própria hierarquia de escala, e é vasta!",
  "😮 O WiFi usa as mesmas frequências de rádio que o micro-ondas. A diferença é só a potência: um aquece comida, o outro transmite dados a metros de distância. 📡",
  "💡 Einstein publicou a teoria da relatividade em 1905 mas só recebeu o Nobel em 1921. E não foi pela relatividade, foi pelo efeito fotoelétrico!",
  "🌕 ABSURDO: A Lua se afasta da Terra 3,8 cm por ano. Em bilhões de anos, estará tão longe que eclipses totais serão impossíveis para sempre!",
  "🐙 ALIENÍGENA: Os polvos têm 2/3 dos neurônios nos tentáculos. Cada braço 'pensa' semi-independentemente do cérebro central. Se há alienígenas na Terra, são eles!",
  "🔥 O fogo não tem sombra! A luz emitida pelo fogo ilumina tudo ao redor, não existe 'bloqueio' de luz para criar uma sombra. Tente observar isso!",
  "🌌 Para um fóton de luz, o tempo não passa. Da perspectiva da luz, ela viaja do Sol até você em zero segundos. A dilatação do tempo é real e verificada!",
  "💫 O universo tem 13,8 bilhões de anos, mas tem 93 bilhões de anos-luz de diâmetro. Isso é possível porque o espaço se expandiu mais rápido que a própria luz!",
  "🧬 Cada célula do seu corpo tem 2 metros de DNA enrolado dentro dela. Com 37 trilhões de células, você tem DNA suficiente para ir ao Sol e voltar 190 vezes!",
  "🌍 O campo magnético da Terra está se invertendo. Já fez isso centenas de vezes na história geológica e estamos atualmente em processo de inversão! 🧲",
  "😱 A maioria do seu corpo não é humana. 60% dos genes que carregamos são de origem bacteriana ou viral. Somos uma simbiose forjada por milhões de anos de evolução!",
  "🦕 O T-Rex estava mais próximo de nós no tempo do que do Estegossauro. A era dos dinossauros durou 165 milhões de anos, mais que suficiente para várias eras evolutivas!",
  "🔬 O oxigênio foi descoberto apenas em 1774. Toda a humanidade anterior respirava sem saber o que era o ar que sustentava suas vidas!",
  "🌊 A Corrente do Golfo transporta 30 vezes mais água do que todos os rios do mundo combinados. Se ela parar, a Europa pode congelar em décadas!",
  "⚡ Elétrons se movem a milímetros por segundo em um fio. O que viaja à velocidade da luz é o CAMPO eletromagnético. Os elétrons apenas dão o empurrão inicial!",
  "🧊 A Antártica não é apenas gelo, tem montanhas, vales e até um lago líquido sob 4 km de gelo. O Lago Vostok está isolado há 15 milhões de anos!",
  "🔭 Antes de cair em um buraco negro, você veria toda a história futura do universo se comprimindo em um flash de luz, em instantes do seu ponto de vista!",
  "🦈 Os tubarões passaram por 5 extinções em massa e sobreviveram a todas. Existiam antes dos dinossauros. São a criatura mais resiliente que o planeta já produziu!",
  "💀 As células do seu corpo morrem e são substituídas constantemente. Em 7-10 anos, praticamente todo o seu corpo físico foi renovado. Você é literalmente uma pessoa diferente!",
  "🌍 Se um pixel representasse 1 km², uma tela de 4K precisaria ser do tamanho de uma sala para mostrar o Brasil. E o Brasil cabe 20 vezes na Rússia!",
  "🧠 Seu cérebro consome a mesma quantidade de energia dormindo e acordado. Sonhar é tão custoso metabolicamente quanto pensar, só que de forma diferente!",
  "⭐ A maior estrela conhecida, UY Scuti, é tão grande que se substituísse o Sol, sua superfície ultrapassaria a órbita de Júpiter. O Sol seria invisível dentro dela!",
  "😮 TEMPO: Uma hora tem 3.600 segundos. Um dia tem 86.400. Um ano tem 31,5 milhões de segundos. Em 1 ano você viveu mais de 31 milhões de momentos distintos!",
  "🔥 O Sol converte 4 milhões de toneladas de matéria em energia por segundo pela fusão nuclear. Em 1 segundo, gera mais energia do que a humanidade em 1 milhão de anos!",
  "🧬 O DNA humano tem apenas 2% codificando proteínas. Os outros 98%, antes chamados de 'DNA lixo', controlam quando e como os genes são ativados!",
  "🌌 Se o Sol fosse do tamanho de uma laranja, a Terra seria um grão de areia a 11 metros de distância. E a estrela mais próxima estaria a 3.000 km!",
  "🦠 Há mais bactérias em 1 grama de solo do que seres humanos que já existiram em toda a história. O mundo microscópico domina absolutamente o planeta!",
  "💡 Uma partícula quântica pode estar em dois lugares ao mesmo tempo, em superposição. Só 'escolhe' uma posição quando é observada. A realidade depende do observador!",
  "🌍 Você não vê o Sol como ele é agora, você vê como era 8 minutos atrás. Toda observação astronômica é uma viagem ao passado!",
  "💥 Se o universo tivesse 1 bilionésimo de segundo a menos após o Big Bang, ou se a gravidade fosse ligeiramente diferente, estrelas não se formariam. Tudo é muito preciso!",
  "🦠 Encontraram bactérias vivas em amostras de sal com 250 milhões de anos. Existiam antes dos dinossauros e sobreviveram à extinção! 😱",
  "🌙 No espaço, explosões não fazem barulho. Não há átomos suficientes para propagar o som, o espaço interestelar é um silêncio absoluto e eterno!",
  "🌍 O Himalaia está crescendo 6 mm por ano. A pressão das placas tectônicas continua empurrando e em milhões de anos pode ser irreconhecível!",
  "💡 Para um objeto viajando à velocidade da luz, o tempo para completamente. Um fóton de luz não envelhece, existe em um eterno presente físico!",
  "🧬 Compartilhamos 98,7% do DNA com os chimpanzés. Essa diferença de 1,3% é responsável por toda linguagem, cultura, ciência e arte que nos distingue!",
  "😮 A água que você bebeu hoje pode ter passado por um dinossauro. Toda a água da Terra é reciclada há bilhões de anos, o ciclo hidrológico é eterno!",
  "⚡ Um impulso nervoso percorre seu corpo a 120 m/s. Mas a decisão consciente de mover um dedo acontece 0,35 segundos ANTES de você 'decidir'. O livre-arbítrio existe?",
  "🌊 A pressão no ponto mais fundo do oceano é de 1.100 atmosferas, como ter 50 aviões jumbo empilhados sobre você. As criaturas lá são quase alienígenas!",
  "🔥 O fogo é um plasma, o quarto estado da matéria, além de sólido, líquido e gás. Na maior parte do universo, a matéria existe em plasma. Nós somos a exceção!",
  "💫 O sistema solar está se movendo em direção à Constelação de Hércules a 19,4 km/s. Cada segundo, você se afasta 19 km da posição onde estava ontem!",
  "🦈 O tubarão-branco detecta sangue na concentração de 1 parte por 1 bilhão, equivalente a 1 gota de sangue em 100 piscinas olímpicas. Olfato sobre-humano!",
  "🧠 Seu cérebro gera cerca de 70.000 pensamentos por dia. A maioria é repetição, menos de 5% são genuinamente novos. Criatividade real é rara até internamente!",
  "🌌 O Sol vai se tornar uma gigante vermelha em 5 bilhões de anos, engolindo a Terra. A humanidade precisará ter ido embora até lá, ou terá acabado muito antes!",
  "⭐ Cada átomo de ferro no seu sangue foi forjado no interior de uma supernova. Você é, literalmente e poeticamente, feito de poeira de estrelas! 💫",
];

const FATOS_COMPLEXOS: string[] = [
  "🧠 A memória humana não funciona como um HD. Cada vez que você se lembra de algo, reconstrói a memória do zero e a modifica sutilmente. Suas lembranças mais vívidas podem ser as menos precisas!",
  "⚡ Os elétrons não 'correm' por um fio à velocidade da luz. Eles se movem a milímetros por segundo. O que viaja rápido é o campo eletromagnético que os empurra, como uma fila de bolinhas!",
  "🌊 O paradoxo da costa: quanto mais você amplia a medição de uma linha costeira, maior ela fica, indefinidamente. Não existe um comprimento 'real', depende da escala. É um fractal natural!",
  "🔥 O fogo é um plasma, o quarto estado da matéria além de sólido, líquido e gás. É uma mistura de íons e elétrons excitados emitindo luz enquanto reagem quimicamente com o oxigênio!",
  "🌌 O princípio da incerteza de Heisenberg não é uma limitação dos instrumentos. É uma propriedade fundamental da realidade: posição e velocidade de uma partícula nunca são definidas simultaneamente!",
  "🧬 A seleção natural não é 'sobrevivência do mais forte', é sobrevivência do que se reproduz mais. Uma bactéria resistente a antibióticos não é mais forte. Ela simplesmente tem mais descendentes!",
  "🌍 A tectônica de placas não é apenas sobre terremotos. Ela regula o CO₂ atmosférico, o nível dos oceanos e o clima global. Sem ela, a Terra poderia ser inabitável como Vênus!",
  "💡 O efeito fotoelétrico (Nobel de Einstein em 1921) prova que a luz é tanto onda quanto partícula. Essa dualidade viola toda intuição clássica, mas é a realidade confirmada por experimentos!",
  "🌊 A corrente termohalina oceânica leva 1.000 anos para completar um ciclo global. Ela regula o clima planetário e o aquecimento global está perigosamente a desacelerando!",
  "🧬 Nosso DNA contém sequências de vírus que infectaram nossos ancestrais há milhões de anos. Cerca de 8% do genoma humano são retrovírus integrados, somos parte vírus evolutivamente!",
  "🔬 A combustão parece simples, mas é uma cascata de centenas de reações químicas simultâneas. Modelar matematicamente uma simples chama de vela requer supercomputadores modernos!",
  "🌌 Em física quântica, partículas podem estar 'emaranhadas'. O que acontece com uma afeta instantaneamente a outra, independentemente da distância. Einstein chamou de 'ação fantasmagórica'!",
  "⚗️ A maioria dos metais é formada por cristais microscópicos invisíveis. Ferro, alumínio, cobre, todos compostos de grãos cristalinos. A metalurgia é a arte de controlar esses cristais!",
  "🧠 O 'problema difícil da consciência': sabemos como o cérebro processa informação, mas não sabemos como impulsos elétricos criam a experiência subjetiva de 'ser você'. Sem resposta ainda!",
  "🌡️ O zero absoluto (-273,15°C) nunca pode ser atingido, apenas se aproximado. É uma lei termodinâmica: extrair a última unidade de energia de um sistema requereria energia infinita!",
  "🌌 A matéria escura não emite, absorve ou reflete luz. Sabemos que existe pelo efeito gravitacional em galáxias, mas nunca a detectamos diretamente. Representa 27% do universo!",
  "⚡ O tunelamento quântico permite que partículas atravessem barreiras classicamente intransponíveis. O Sol brilha por causa disso, sem tunelamento, a fusão nuclear seria impossível!",
  "🔭 Quando você olha para as estrelas à noite, você está vendo o passado. A luz de Andrômeda que você vê tem 2,5 milhões de anos, a estrela pode nem existir mais hoje!",
  "🌊 A ressonância de Schumann é a frequência natural eletromagnética da Terra: 7,83 Hz. Determinada pela distância entre a superfície e a ionosfera e coincide com o ritmo alfa do cérebro!",
  "🧬 Trigêmeos idênticos têm DNA idêntico mas epigenomas diferentes, o que explica personalidades distintas. O DNA é o código-fonte; o ambiente decide o que é executado!",
  "🔬 A especiação simpátrica ocorre quando duas espécies evoluem a partir da mesma população sem separação geográfica, apenas por diferenças comportamentais. Desafia a teoria clássica!",
  "💡 O paradoxo do observador na física quântica: observar uma partícula muda seu comportamento. O ato de medir colapsa a 'função de onda', a realidade existe em superposição até ser medida!",
  "🌍 O campo magnético da Terra oscila, enfraquece e já se inverteu centenas de vezes na história geológica. Estamos atualmente num período de enfraquecimento gradual dos polos!",
  "⚗️ CRISPR-Cas9 são como tesouras moleculares que cortam o DNA em posições exatas. Isso permite editar genes com precisão cirúrgica, estamos na era da programação da vida biológica!",
  "🌌 O horizonte de eventos de um buraco negro é o ponto onde a velocidade de escape supera a velocidade da luz. Nada retorna, nem informação. O que acontece além é matematicamente indescritível!",
  "🧠 A 'rede de modo padrão' do cérebro é mais ativa quando você não está fazendo nada. Esse estado de 'mente vagabunda' é onde surgem insights criativos e onde memórias se consolidam!",
  "🌊 A estratificação oceânica divide o mar em camadas com temperaturas e densidades distintas que raramente se misturam. As criaturas das profundezas vivem em condições completamente diferentes!",
  "🔥 A combustão do hidrogênio produz apenas água como subproduto. Por isso o hidrogênio é chamado de combustível do futuro, o único 'resíduo' é H₂O. O desafio é armazená-lo com segurança!",
  "⚡ A supercondutividade ocorre quando certos materiais perdem toda resistência elétrica em temperaturas muito baixas. Uma corrente elétrica pode circular indefinidamente sem perda de energia!",
  "🧬 O paradoxo do envelhecimento: as células do corpo morrem e são substituídas constantemente, mas os neurônios cerebrais são quase todos os mesmos que você tinha ao nascer!",
  "🌌 A expansão do universo está acelerando, não desacelerando como a gravidade sugeria. 'Energia escura' está empurrando tudo para longe. Representa 68% do universo e ninguém sabe o que é!",
  "💡 O laser não existe na natureza. É uma luz muito especial: coerente (ondas em fase), monocromática (um único comprimento de onda) e colimada (não diverge). Cada propriedade exige engenharia precisa!",
  "🔬 A teoria evolucionária moderna combina Darwin com a genética de Mendel. A seleção natural age sobre variações aleatórias, sem propósito ou direção. A complexidade emerge do acaso mais tempo!",
  "🌊 O efeito Mpemba diz que água quente pode congelar mais rápido do que água fria em certas condições. Ainda não há consenso científico sobre por quê, é um fenômeno real mas misterioso!",
  "⚗️ O estado de Bose-Einstein é o quinto estado da matéria, criado em laboratório próximo ao zero absoluto. Partículas se comportam como uma única entidade quântica, um 'superfluido' inexplicável!",
  "🧠 A síndrome do membro fantasma: amputados sentem dor em membros que não existem mais. O cérebro mantém o 'mapa' do corpo original e continua a interpretá-lo como real!",
  "🌌 A gravitação não é uma força na relatividade geral, é a curvatura do espaço-tempo causada pela massa. A Terra orbita o Sol porque o Sol curva o espaço ao redor dele!",
  "🧬 As mitocôndrias têm seu próprio DNA, distinto do DNA do núcleo celular. Evidência de que eram bactérias independentes que foram incorporadas às células há 2 bilhões de anos!",
  "🔥 O plasma é o estado mais abundante da matéria no universo. O Sol, estrelas e a maior parte do universo visível estão em plasma. Sólidos, líquidos e gases são a exceção cósmica!",
  "🌊 O fenômeno de ressonância pode destruir pontes. A Ponte de Tacoma Narrows colapsou em 1940 porque o vento criou oscilações na frequência de ressonância estrutural. Engenharia precisa preveni-lo!",
  "🧠 A sinestesia é quando estímulos de um sentido ativam outro. Pessoas com sinestesia podem 'ouvir' cores, 'ver' sons ou 'sentir' números como texturas. É um cross-wiring neurológico real!",
  "⚡ A energia solar que chega à Terra em 1 hora supre toda a demanda energética humana por 1 ano. O desafio não é falta de energia, é armazenamento e distribuição eficiente!",
  "🌌 Segundo o princípio antrópico, o universo parece 'afinado' para permitir a vida. As constantes físicas poderiam ser outras, a maioria impossibilitaria estrelas, planetas e seres pensantes!",
  "🧬 A epigenética estuda como fatores ambientais ativam ou silenciam genes sem mudar o DNA. Experiências traumáticas criam marcas epigenéticas transmitidas aos filhos, herança não-genética!",
  "🔬 A teoria dos conjuntos de Cantor provou que existem infinitos maiores do que outros. O infinito dos números reais é 'maior' que o dos números inteiros, mesmo ambos sendo infinitos!",
  "🌊 O efeito de maré não é causado pela força gravitacional em si, mas pelo GRADIENTE, a diferença entre a atração no lado próximo e no lado distante da Terra. É física sutil e elegante!",
  "💡 A termodinâmica proíbe máquinas de movimento perpétuo. A entropia sempre aumenta, sistemas isolados sempre evoluem para estados mais desordenados. É uma lei fundamental da natureza!",
  "🧠 O efeito Dunning-Kruger: pessoas com pouco conhecimento superestimam sua competência, enquanto especialistas tendem a subestimá-la. Saber pouco te faz se sentir expert!",
  "⚗️ A catálise química acelera reações sem ser consumida no processo. Os catalisadores nos carros transformam gases nocivos em CO₂ e água, o mesmo princípio das enzimas do seu corpo!",
  "🌌 O paradoxo de Fermi: se o universo tem bilhões de planetas habitáveis e bilhões de anos de história, por que ainda não encontramos evidências de outras civilizações inteligentes?",
  "🧬 O CRISPR existe na natureza! Bactérias o usam como sistema imunológico adaptativo, armazenam fragmentos de DNA viral para reconhecer e destruir vírus conhecidos no futuro!",
  "🔥 A fissão nuclear divide átomos pesados liberando energia enorme. A fusão une átomos leves liberando ainda mais energia, é o que o Sol usa. Dominar a fusão seria a revolução energética do século!",
  "💡 A computação quântica usa 'qubits' que podem estar em 0 e 1 simultaneamente. Um computador quântico com 300 qubits pode processar mais estados do que átomos no universo observável!",
  "🌊 A bioluminescência é produzida por reações químicas enzimáticas. É uma das poucas formas de produzir luz sem calor. 90% das criaturas das profundezas oceânicas são bioluminescentes!",
  "🧠 A neuroplasticidade permite que o cérebro se reorganize fisicamente com base em experiências. Taxistas de Londres têm hipocampo maior do que a média, o cérebro treina como músculo!",
  "⚡ O paradoxo EPR demonstrou que a mecânica quântica implica 'ação à distância'. Bell provou que não é imperfeição da teoria: a realidade quântica genuinamente é não-local!",
  "🌌 A matéria bariônica, tudo que vemos, representa apenas 5% do universo. 27% é matéria escura e 68% é energia escura. Somos incapazes de detectar diretamente 95% do que existe!",
  "🧬 O splicing alternativo permite que um único gene produza múltiplas proteínas diferentes. Com ~20.000 genes, o humano produz ~200.000 proteínas. A complexidade emerge da combinatória!",
  "🔬 A lei de Moore previu que transistores em chips dobrariam a cada 2 anos. Funcionou por décadas, mas está chegando ao limite: transistores menores que 5 nm atingem barreiras quânticas!",
  "💡 A interferência quântica: elétrons criam padrões de interferência mesmo passando um a um por duas fissuras. O elétron interfere consigo mesmo, como se passasse pelas duas ao mesmo tempo!",
  "🌊 O pH do estômago humano é entre 1,5 e 3,5, ácido o suficiente para dissolver metais. A mucosa estomacal se renova completamente a cada 3-4 dias para sobreviver ao próprio ácido!",
  "🧠 A taxa de disparo neuronal afeta a qualidade da memória. Memórias consolidadas durante o sono profundo (ondas delta, 0.5-4 Hz) são as mais duráveis. O sono é o mecanismo de aprendizado do cérebro!",
  "🌌 O horizonte cósmico limita o que podemos observar, a luz de regiões mais distantes ainda não chegou a nós. Pode existir um universo muito maior além do nosso horizonte, para sempre inacessível!",
  "🧬 A evolução convergente: espécies não relacionadas desenvolvem características semelhantes independentemente. Olhos de polvos e de vertebrados evoluíram separadamente e são estruturalmente parecidos!",
  "💡 O teorema da incompletude de Gödel provou que em qualquer sistema matemático suficientemente poderoso, existem afirmações verdadeiras que não podem ser provadas dentro do próprio sistema!",
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
