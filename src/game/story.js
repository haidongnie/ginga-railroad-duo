// Story script. Each chapter runs in one area; the host walks through `steps` in order.
// Step types: dialog | goal (whole party near a point) | collect | ordered | talk | each | plates | event | end

export const ROLES = {
  giovanni: { name: '乔凡尼', model: 'giovanni', color: '#9fd4ff' },
  campanella: { name: '康帕内拉', model: 'campanella', color: '#f4d58d' },
};
export const otherRole = (r) => (r === 'giovanni' ? 'campanella' : 'giovanni');

export const SPEAKERS = {
  n: '', G: '乔凡尼', C: '康帕内拉', cond: '列车长', bird: '捕鸟人', keep: '灯塔看守', kaoru: '薰', voice: '？？？',
};

export const CHAPTERS = [
  {
    area: 'hill', label: '序章', title: '半人马祭之夜',
    steps: [
      { type: 'dialog', id: 'hill_intro' },
      { type: 'goal', text: '一起登上山丘，走到天气轮之柱旁', point: 'pillar', r: 4.5 },
      { type: 'event', id: 'trainArrive', dur: 7.5 },
      { type: 'dialog', id: 'hill_train' },
      { type: 'goal', text: '走到列车门前，登上银河列车', point: 'door', r: 3.5 },
    ],
  },
  {
    area: 'carriage', label: '第一章', title: '银河铁道',
    steps: [
      { type: 'dialog', id: 'car_intro' },
      { type: 'each', text: '走到车厢前方，向列车长出示车票', target: 'conductor' },
      { type: 'dialog', id: 'car_ticket' },
      { type: 'goal', text: '列车到站了。从前方车门下车', point: 'door', r: 2.2 },
    ],
  },
  {
    area: 'swan', label: '第二章', title: '天鹅站 · 普利奥新海岸',
    steps: [
      { type: 'dialog', id: 'swan_arrive' },
      { type: 'collect', text: '在发光的石英沙滩上寻找胡桃化石', group: 'fossil', need: 6 },
      { type: 'dialog', id: 'swan_fossil' },
      { type: 'goal', text: '汽笛响了，回到站台上的列车门前', point: 'door', r: 3.5 },
    ],
  },
  {
    area: 'birds', label: '第三章', title: '捕鸟人',
    steps: [
      { type: 'dialog', id: 'birds_intro' },
      { type: 'talk', text: '去芒草原上和捕鸟人说话', target: 'birdcatcher' },
      { type: 'dialog', id: 'birds_start' },
      { type: 'collect', text: '接住从天河飘落的白鹭（等它们飞低再靠近）', group: 'heron', need: 8 },
      { type: 'event', id: 'catcherVanish', dur: 2.5 },
      { type: 'dialog', id: 'birds_done' },
      { type: 'goal', text: '回到列车门前', point: 'door', r: 3.5 },
    ],
  },
  {
    area: 'apples', label: '第四章', title: '灯塔看守与苹果',
    steps: [
      { type: 'dialog', id: 'apple_intro' },
      { type: 'collect', text: '在苹果树下拾起发光的苹果', group: 'apple', need: 5 },
      { type: 'talk', text: '把苹果送给穿红外套的女孩“薰”', target: 'kaoru' },
      { type: 'dialog', id: 'apple_given' },
      { type: 'plates', text: '两人分别站上灯塔两侧的光环，点亮灯塔', plates: ['plateA', 'plateB'] },
      { type: 'event', id: 'lighthouseOn', dur: 3 },
      { type: 'dialog', id: 'apple_lit' },
      { type: 'goal', text: '回到列车门前', point: 'door', r: 3.5 },
    ],
  },
  {
    area: 'scorpion', label: '第五章', title: '天蝎之火',
    steps: [
      { type: 'dialog', id: 'scorp_intro' },
      { type: 'ordered', text: '沿着蝎子的形状，按顺序点亮地上的星', group: 'star', need: 8 },
      { type: 'dialog', id: 'scorp_heart' },
      { type: 'plates', text: '两人同时站在心宿二两侧的光环上', plates: ['plateA', 'plateB'] },
      { type: 'event', id: 'fire', dur: 4 },
      { type: 'dialog', id: 'scorp_fire' },
      { type: 'goal', text: '回到列车门前', point: 'door', r: 3.5 },
    ],
  },
  {
    area: 'cross', label: '终章', title: '南十字星与煤袋',
    steps: [
      { type: 'dialog', id: 'cross_arrive' },
      { type: 'goal', text: '一起走过光之桥，到南十字星下', point: 'cross', r: 7 },
      { type: 'dialog', id: 'cross_farewell' },
      { type: 'event', id: 'ascend', dur: 4 },
      { type: 'goal', text: '走到河岸的尽头，抬头看看天空', point: 'view', r: 4 },
      { type: 'dialog', id: 'coalsack' },
      { type: 'event', id: 'farewell', dur: 5 },
    ],
  },
  {
    area: 'dawn', label: '尾声', title: '拂晓',
    steps: [
      { type: 'dialog', id: 'dawn' },
      { type: 'end' },
    ],
  },
];

// Lines: [speaker, text, textForCampanellaPlayer?]
export const DIALOGS = {
  hill_intro: [
    ['n', '半人马祭的夜晚。镇上的孩子们提着王瓜灯，沿着河边放流星灯。'],
    ['n', '乔凡尼没有去。他独自爬上镇外的山丘——丘顶立着一根古老的天气轮之柱，头顶是一条白茫茫的银河。'],
    ['G', '老师说，银河其实是无数星星聚在一起……可是看上去，它真像一条流着牛奶的河。'],
    ['C', '乔凡尼！原来你在这里。大家都去河边了，我却只想看星星。'],
    ['G', '康帕内拉……'],
    ['C', '我们一起爬到天气轮之柱那儿去吧，从那里看得最清楚。'],
  ],
  hill_train: [
    ['n', '天气轮之柱忽然亮了起来，像一盏被谁点燃的三角标。'],
    ['voice', '「银河站——银河站——」'],
    ['n', '仿佛有亿万只萤乌贼的光一下子变成化石，沉进了天空里。四周忽然明亮得睁不开眼。'],
    ['C', '你看！是火车……从天上开下来了！'],
    ['G', '我们……要上去吗？'],
    ['C', '嗯。走吧，乔凡尼。'],
  ],
  car_intro: [
    ['n', '回过神来，两人已经坐在一列小小的夜行列车里。黄色的灯照着蓝色天鹅绒的座椅，车厢空荡荡的。'],
    ['n', '窗外，银河的河床上立满了发光的三角标，蓝的、橙的、绿的，像一片静静燃烧的原野。'],
    ['C', '大家都没赶上呢。马尔索他们跑得那么快，还是没赶上。'],
    ['G', '……我们要去哪里呢？'],
    ['C', '我也不知道。可是我好像什么都不怕了。只要是和你一起。'],
    ['cond', '车票，请出示车票。'],
  ],
  car_ticket: [
    ['cond', '……哎呀，这张绿色的车票。'],
    ['cond', '这可是了不起的东西。有了它，不管是天上，还是哪里，都可以一直坐下去。'],
    ['G', '（我什么时候把它放进口袋里的呢？）'],
    ['cond', '下一站是天鹅站，停车二十分钟。两位不妨下车走走吧。'],
  ],
  swan_arrive: [
    ['n', '列车在一座白色的小站停下。站台上的钟指着十一点。'],
    ['C', '二十分钟！我们去河边看看吧。听说那里的沙子，全都是水晶。'],
    ['n', '河岸上，白色的岩石像月光一样铺开。一块木牌上写着：普利奥新海岸。'],
    ['G', '沙子里好像埋着什么……一颗颗圆圆的，在发光。'],
  ],
  swan_fossil: [
    ['C', '你看，这是胡桃——一百二十万年前的胡桃，变成了石头。'],
    ['G', '一百二十万年……那时候，这里还是海吧。'],
    ['C', '嗯。海退去了，胡桃却留了下来。好像一直在等谁来把它捡起来似的。'],
    ['n', '远处传来汽笛声。该回列车了。'],
  ],
  birds_intro: [
    ['n', '列车重新开动，不久又在一片闪着银光的芒草原旁停下。'],
    ['n', '一个留着红胡子、背着白布包袱的男人在草原上朝他们招手。'],
  ],
  birds_start: [
    ['bird', '哎呀，好地方，好地方！两位小少爷，是要去哪里呀？'],
    ['G', '我们……哪里都可以去。'],
    ['bird', '那可真好。我嘛，是捕鸟的，专捉白鹭和大雁。'],
    ['bird', '等它们从天河上飘下来的时候，轻轻一按，它们就一动不动，变成扁扁的、甜甜的点心啦。'],
    ['bird', '来了来了！看天上——白鹭飘下来了！等它们飞得够低，走过去接住就行。两位帮我一把吧！'],
  ],
  birds_done: [
    ['C', '它们……真的像点心一样，是甜的。'],
    ['G', '可是，怎么看都是真正的鸟啊……'],
    ['n', '两人一回头，捕鸟人已经不见了。只剩芒草沙沙作响，像有人刚刚从那里走过。'],
    ['C', '他……去哪里了？'],
    ['G', '不知道。可是我总觉得，应该对他再好一点。'],
  ],
  apple_intro: [
    ['n', '下一站，一座红白相间的灯塔立在银河岸边。车厢里不知何时多了几位客人。'],
    ['kaoru', '这里……是哪里呀？我们的船……'],
    ['n', '那个女孩全身湿透了，穿着一件深红色的外套，紧紧抓着衣角。'],
    ['keep', '别怕。这里是天上的岸边。来，这附近的树下落了好些苹果，金黄的、通红的。'],
    ['keep', '两位少年，能帮我拾些苹果，送给这位小姑娘吗？'],
  ],
  apple_given: [
    ['kaoru', '好香……谢谢你们。'],
    ['kaoru', '船撞上冰山的时候，老师把我们从人群里拉出来……可是救生艇已经坐满了。'],
    ['kaoru', '老师说，与其推开别人自己得救，不如大家一起，去到神那里。'],
    ['G', '……'],
    ['keep', '不管多么辛苦的事，只要走在正确的路上，无论上坡下坡，都是一步步走近真正的幸福。'],
    ['keep', '灯塔的光，是为了让候鸟在黑暗里找到方向。今天就请两位替我点亮它吧。'],
  ],
  apple_lit: [
    ['n', '灯塔的光柱扫过银河，一群候鸟从光里飞过，又消失在星星之间。'],
    ['keep', '谢谢你们。快回列车吧——下一站，就能看见天蝎之火了。'],
  ],
  scorp_intro: [
    ['n', '银河对岸，有一团通红的火在静静燃烧，比红宝石还透亮，比锂的焰色还要美丽。'],
    ['kaoru', '那是天蝎之火。爸爸给我讲过。'],
    ['kaoru', '从前有一只蝎子，靠吃小虫子活着。有一天，它被黄鼠狼追赶，掉进了井里。'],
    ['kaoru', '快要淹死的时候，它祈祷说：「我夺走了那么多生命，轮到自己时，却只顾拼命逃跑。」'],
    ['kaoru', '「如果可以，请不要让我白白死去。请用我的身体，去换大家真正的幸福吧。」'],
    ['C', '然后呢？'],
    ['kaoru', '然后，它的身体就变成了通红的火，照亮了夜空，一直燃烧到现在。'],
    ['n', '黑曜石般的地面上，浮现出一颗颗暗淡的星，连成了一只蝎子的形状。'],
  ],
  scorp_heart: [
    ['n', '星点一颗接一颗地亮了。只剩下蝎子心脏的位置——心宿二，还在黑暗里等待。'],
    ['C', '要我们两个人一起，才能点亮它吧。'],
  ],
  scorp_fire: [
    ['n', '心宿二亮了。一道火柱升上天空，把整条银河都映红了。'],
    ['G', '康帕内拉，我也想像那只蝎子一样。为了大家真正的幸福，就算身体被烧上一百次也没关系。'],
    ['C', '嗯，我也是。'],
    ['G', '可是，真正的幸福，到底是什么呢？'],
    ['C', '我不知道……'],
    ['n', '汽笛响了。列车在等他们。'],
  ],
  cross_arrive: [
    ['n', '列车驶入一片光的海洋。河中央，一座由光与水晶构成的十字架高高耸立——南十字星。'],
    ['kaoru', '我们要在这里下车了。妈妈……一定在那边等我。'],
    ['G', '不要下车！和我们一起，一直坐下去吧。我们可以去任何地方！'],
    ['kaoru', '……可是，我们必须在这里下车。这里是去天上的地方。'],
    ['C', '那我们送她到十字架下面吧。'],
  ],
  cross_farewell: [
    ['kaoru', '再见了。谢谢你们的苹果。'],
    ['n', '女孩的身影渐渐化成了光，和许多人一起，向十字架的方向升了上去。'],
    ['n', '星空里传来很轻很轻的歌声，然后，一切又安静下来。'],
  ],
  coalsack: [
    ['C', '看，那里——那是煤袋。天上的一个洞。'],
    ['n', '银河的一角，有一个漆黑的大洞，深不见底，看久了眼睛都会发痛。'],
    ['G', '我已经不怕那样的黑暗了。我一定要去寻找大家真正的幸福。'],
    ['G', '康帕内拉，我们一起去吧。不管到哪里，都要一起去。'],
    ['C', '嗯，一起去……'],
    ['C', '你看，那边的原野多美啊。大家都在那里……我的妈妈也在那里。'],
    ['G', '原野？在哪里……我什么也看不见，康帕内拉。'],
    ['C', '乔凡尼，你要一直……一直往前走啊。'],
    ['n', '乔凡尼回过头。刚才还站在身边的康帕内拉，已经不见了。', '你朝那片美丽的原野走去。身后，乔凡尼的呼喊声越来越远。'],
  ],
  dawn: [
    ['n', '乔凡尼睁开眼睛。他躺在山丘的草地上，胸口热热的，脸颊上全是泪水。', '天亮了。你化作一缕微光，停在山丘上，静静看着他醒来。'],
    ['n', '天快亮了。镇上的灯火依旧，银河淡淡地挂在天边。'],
    ['n', '后来他才知道，那一晚，康帕内拉为了救落水的同学，跳进了河里，再也没有回来。'],
    ['G', '康帕内拉……我会一直走下去的。为了大家真正的幸福。'],
    ['n', '口袋里，那张绿色的车票还在。'],
  ],
};

export const ENDING_TEXT = '「不管到哪里，我们都要一起去。」<br />谢谢你们，一起乘上了这班列车。';
