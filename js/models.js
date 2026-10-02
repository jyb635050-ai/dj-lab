// 机型：同一套音频引擎，不同的面板和手感。不用真实品牌名，只模拟「这一类设备」的典型配置。
export const MODEL_IDS = ['starter', 'standard', 'club', 'vinyl'];
export const MODELS = {
  starter: {
    tag: 'STARTER',
    name: { zh: '入门控制器', en: 'Starter controller' },
    sub: { zh: '第一台 DJ 设备的样子', en: 'What a first DJ controller looks like' },
    desc: { zh: '小转盘、3 段 EQ 加滤波、每台 4 个打击垫、固定 4 拍循环，SYNC 做得最大。多一个「一键过渡」：按一下，16 拍内自动推交叉推子、交换低音——先听听好的过渡是什么样。', en: 'Compact jogs, 3-band EQ plus filter, four pads per deck, a fixed 4-beat loop and a big SYNC. Plus AUTO MIX: one press and it rides the crossfader and swaps the bass over 16 beats — hear what a good blend sounds like.' },
    chips: { zh: ['小转盘', '4 个打击垫', '固定 4 拍循环', '一键过渡'], en: ['Compact jogs', '4 pads', 'Fixed 4-beat loop', 'Auto mix'] },
    pitch: [8], hot: 4, loopSel: false, trim: false, fx: false, vinyl: false,
  },
  standard: {
    tag: 'STANDARD',
    name: { zh: '标准', en: 'Standard' },
    sub: { zh: '本站课程用的就是它', en: 'The one the lessons use' },
    desc: { zh: '大转盘、滚动波形、拍子灯、4 个热点、4 拍循环、3 段隔离式 EQ 和滤波——学打碟需要的都在，没有多余的东西。', en: 'Big jogs, scrolling waveforms, beat lights, 4 hot cues, a 4-beat loop, a 3-band isolator EQ and filter — everything you need to learn, nothing extra.' },
    chips: { zh: ['滚动波形', '4 个热点', '±8% 变速'], en: ['Scrolling waveforms', '4 hot cues', '±8% tempo'] },
    pitch: [8], hot: 4, loopSel: false, trim: false, fx: false, vinyl: false,
  },
  club: {
    tag: 'CLUB',
    name: { zh: '俱乐部专业', en: 'Club pro' },
    sub: { zh: '夜店 DJ 台：两台播放器＋一台混音台', en: 'Club booth: two media players + a mixer' },
    desc: { zh: '大号转盘带中央显示；变速范围可切 ±6 / ±10 / ±16%；循环长度 1/4 到 16 拍；每台 8 个彩色热点；量化（Q）打开时，热点会吸附到拍子上；每路有增益（TRIM）；混音台自带节拍效果器——回声、混响、镶边，跟着 BPM 走。', en: 'Large jogs with a centre display; tempo range ±6 / ±10 / ±16%; loops from 1/4 to 16 beats; 8 coloured hot cues per deck; with quantize (Q) on, cues snap to the beat; TRIM on every channel; and a beat FX unit on the mixer — echo, reverb, flanger, locked to the BPM.' },
    chips: { zh: ['变速 ±6/10/16%', '循环 1/4–16 拍', '8 个热点', '量化', '节拍效果器'], en: ['Tempo ±6/10/16%', 'Loops 1/4–16', '8 hot cues', 'Quantize', 'Beat FX'] },
    pitch: [6, 10, 16], hot: 8, loopSel: true, trim: true, fx: true, vinyl: false,
  },
  vinyl: {
    tag: 'VINYL',
    name: { zh: '经典黑胶', en: 'Classic vinyl' },
    sub: { zh: '两台唱机＋一台对战混音台', en: 'Two turntables + a battle mixer' },
    desc: { zh: '没有波形、没有 BPM 读数、没有 SYNC——全靠耳朵对拍。按住唱片它就停，松手才回转；START·STOP 有电机起转和刹车；33/45 转切换；交叉推子可以切成「硬切」，搓碟专用。', en: 'No waveforms, no BPM readout, no SYNC — you beatmatch by ear. Hold the record and it stops; let go and it spins back up; START·STOP has real motor spin-up and brake; switch 33/45 rpm; set the crossfader to a sharp cut for scratching.' },
    chips: { zh: ['靠耳朵对拍', '按住即停', '电机起转/刹车', '33 / 45 转', '硬切推子'], en: ['Beatmatch by ear', 'Hold to stop', 'Motor spin-up/brake', '33 / 45 rpm', 'Cut crossfader'] },
    pitch: [8], hot: 0, loopSel: false, trim: true, fx: false, vinyl: true,
  },
};
export const LOOP_BEATS = [0.25, 0.5, 1, 2, 4, 8, 16];
export const fmtBeats = b => b === 0.125 ? '1/8' : b === 0.25 ? '1/4' : b === 0.5 ? '1/2' : b === 0.75 ? '3/4' : String(b);
