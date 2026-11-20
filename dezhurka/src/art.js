/* Дежурная часть — графика без картинок: всё рисуется SVG-строками.
   scene()  — вестибюль отделения, каким его видно из окна дежурки (viewBox 400×250);
   person() — поясной портрет в коробке 200×240, собирается из параметров дела (look);
   item()   — вещь из лотка в коробке 64×64. */
(function (root) {
  const DZ = (root.DZ = root.DZ || {});
  const OUT = 'stroke="#0e0c0a" stroke-width="1.4" stroke-linejoin="round"';

  // ————————————————————————————————————————————— люди

  const FACE = {
    narrow: 'M63,72 C63,24 137,24 137,72 L137,88 C137,108 118,131 100,131 C82,131 63,108 63,88 Z',
    mid: 'M62,72 C62,24 138,24 138,72 L138,90 C138,113 121,131 100,131 C79,131 62,113 62,90 Z',
    wide: 'M60,72 C60,24 140,24 140,72 L140,94 C140,120 124,134 100,134 C76,134 60,120 60,94 Z',
  };

  const BROWS = {
    neutral: ['M76,72 L92,71', 'M108,71 L124,72'],
    worried: ['M76,74 L92,68', 'M108,68 L124,74'],
    angry: ['M76,68 L92,73.5', 'M108,73.5 L124,68'],
    raised: ['M76,70 Q84,64 92,69', 'M108,69 Q116,64 124,70'],
  };

  const MOUTH = {
    neutral: 'M91,114 Q100,116 109,114',
    smile: 'M89,112 Q100,121 111,112',
    smirk: 'M90,115 Q103,118 112,110',
    frown: 'M90,116 Q100,111 110,116',
    flat: 'M91,114.5 L109,114.5',
  };

  function torso(nx1, nx2) {
    return `M4,240 C6,188 24,166 64,157 L${nx1},148 L${nx2},148 L136,157 C176,166 194,188 196,240 Z`;
  }

  const CLOTHES = {
    denim(p, nx1, nx2) {
      return `<path d="${torso(nx1, nx2)}" fill="#3f546a"/>
        <path d="M${nx1},148 L100,208 L${nx2},148 Z" fill="#8c8567"/>
        <path d="M88,170 l4,-5 l4,5 l4,-5 l4,5 l4,-5 l4,5" stroke="#5d5943" fill="none" stroke-width="1.6"/>
        <path d="M${nx1},148 L64,157 L78,188 L97,198 Z" fill="#4c6682"/>
        <path d="M${nx2},148 L136,157 L122,188 L103,198 Z" fill="#4c6682"/>
        <path d="M78,188 L74,240 M122,188 L126,240 M40,172 L46,240 M160,172 L154,240" stroke="#2c3d4f" stroke-width="1.5" fill="none"/>
        <circle cx="86" cy="214" r="2.3" fill="#b9a76a"/><circle cx="86" cy="232" r="2.3" fill="#b9a76a"/>`;
    },
    vatnik(p, nx1, nx2) {
      let quilt = '';
      for (const x of [26, 44, 62, 80, 120, 138, 156, 174]) quilt += `M${x},${x < 50 || x > 150 ? 182 : 168} L${x},240 `;
      return `<path d="${torso(nx1, nx2)}" fill="#414b4f"/>
        <path d="${quilt}" stroke="#343d41" stroke-width="1.5" fill="none"/>
        <path d="M${nx1},148 L100,174 L${nx2},148 Z" fill="#6a5a48"/>
        <path d="M${nx1 - 2},146 L${nx1 - 10},160 L100,176 L${nx2 + 10},160 L${nx2 + 2},146 L100,164 Z" fill="#374148"/>
        <path d="M100,176 L100,240" stroke="#2b3337" stroke-width="2.2"/>
        <circle cx="107" cy="194" r="2.8" fill="#20262a"/><circle cx="107" cy="220" r="2.8" fill="#20262a"/>`;
    },
    oldcoat(p, nx1, nx2) {
      return `<path d="${torso(nx1, nx2)}" fill="#3a333e"/>
        <path d="M64,158 C78,150 122,150 136,158 C132,178 116,190 100,192 C84,190 68,178 64,158 Z" fill="#5b4c41"/>
        <path d="M72,162 l3,6 M82,170 l2,7 M94,176 l1,7 M106,176 l-1,7 M118,170 l-2,7 M128,162 l-3,6" stroke="#463a31" stroke-width="1.6" fill="none"/>
        <circle cx="100" cy="208" r="4.2" fill="#231f27"/><circle cx="100" cy="232" r="4.2" fill="#231f27"/>`;
    },
    cook(p, nx1, nx2) {
      return `<path d="${torso(nx1, nx2)}" fill="#4b4b40"/>
        <path d="M${nx1},148 L78,160 L86,240 L114,240 L122,160 L${nx2},148 L100,160 Z" fill="#dcd8cc"/>
        <path d="M${nx1},146 L${nx1},157 L100,166 L${nx2},157 L${nx2},146 L100,157 Z" fill="#ebe8de" stroke="#b9b5a8" stroke-width=".8"/>
        <g fill="#b3ae9f"><circle cx="93" cy="184" r="2.4"/><circle cx="107" cy="184" r="2.4"/><circle cx="93" cy="204" r="2.4"/><circle cx="107" cy="204" r="2.4"/><circle cx="93" cy="224" r="2.4"/><circle cx="107" cy="224" r="2.4"/></g>
        <path d="M${nx1},148 L60,158 L74,184 L80,163 Z" fill="#5b5b4e"/>
        <path d="M${nx2},148 L140,158 L126,184 L120,163 Z" fill="#5b5b4e"/>
        <path d="M78,160 L86,240 M122,160 L114,240" stroke="#34342b" stroke-width="2" fill="none"/>`;
    },
    overcoat(p, nx1, nx2) {
      return `<path d="${torso(nx1, nx2)}" fill="#55524c"/>
        <path d="M${nx1},148 L100,198 L${nx2},148 Z" fill="#cfcabd"/>
        <g transform="rotate(10 100 154)"><path d="M96,156 L104,156 L107,188 L100,196 L93,188 Z" fill="#5d2732"/><path d="M95,150 L105,150 L104,159 L96,159 Z" fill="#4a1e27"/></g>
        <path d="M${nx1},147 L${nx1 - 3},161 L95,161 L100,152 Z" fill="#e2ddd1"/>
        <path d="M${nx2},147 L${nx2 + 3},161 L105,161 L100,152 Z" fill="#e2ddd1"/>
        <path d="M${nx1},148 L60,159 L85,210 L100,198 Z" fill="#646059"/>
        <path d="M${nx2},148 L140,159 L115,210 L100,198 Z" fill="#646059"/>
        <path d="M64,172 L76,168 M136,172 L124,168 M85,210 L82,240 M115,210 L118,240" stroke="#3f3d38" stroke-width="1.5" fill="none"/>`;
    },
    leather(p, nx1, nx2) {
      return `<path d="${torso(nx1, nx2)}" fill="#211e1d"/>
        <path d="M${nx1},150 L100,206 L${nx2},150 Z" fill="#3b434c"/>
        <path d="M${nx1 + 3},150 L100,182 L${nx2 - 3},150 Z" fill="${p.skin}"/>
        <path d="M${nx1 + 3},150 L100,182 L${nx2 - 3},150 L100,160 Z" fill="${p.shade}" opacity=".55"/>
        <path d="M${nx1},148 L${nx1 - 5},163 L91,172 L${nx1 + 6},151 Z" fill="#485360"/>
        <path d="M${nx2},148 L${nx2 + 5},163 L109,172 L${nx2 - 6},151 Z" fill="#485360"/>
        <path d="M${nx1},150 L57,160 L82,214 L100,206 Z" fill="#2c2826"/>
        <path d="M${nx2},150 L143,160 L118,214 L100,206 Z" fill="#2c2826"/>
        <path d="M59,163 L82,212 M141,163 L118,212 M30,176 Q22,200 20,240 M170,176 Q178,200 180,240" stroke="#5c5450" stroke-width="1.4" fill="none" opacity=".7"/>
        <path d="M100,206 L100,240" stroke="#77726d" stroke-width="1.6" stroke-dasharray="2 2"/>`;
    },
    blazer(p, nx1, nx2) {
      return `<g transform="translate(100 0) scale(1.07 1) translate(-100 0)"><path d="${torso(nx1, nx2)}" fill="#7b2032"/>
        <path d="M${nx1},148 L100,208 L${nx2},148 Z" fill="#17171a"/>
        <path d="M${nx1 + 3},153 Q100,190 ${nx2 - 3},153" stroke="#d2a93e" stroke-width="2.8" stroke-dasharray="3.2 1.4" fill="none"/>
        <path d="M${nx1},148 L55,159 L80,216 L100,208 Z" fill="#8e2a3e"/>
        <path d="M${nx2},148 L145,159 L120,216 L100,208 Z" fill="#8e2a3e"/>
        <path d="M60,174 L73,169 M140,174 L127,169 M80,216 L78,240 M120,216 L122,240" stroke="#5a1525" stroke-width="1.6" fill="none"/>
        <path d="M134,198 l13,-3 l1,7 l-13,3 Z" fill="#d9d4c6"/></g>`;
    },
    uniform(p, nx1, nx2) {
      return `<path d="${torso(nx1, nx2)}" fill="#4c5358"/>
        <path d="M${nx1},148 L100,184 L${nx2},148 Z" fill="#828d93"/>
        <path d="M96,154 L104,154 L103,180 L100,185 L97,180 Z" fill="#2f3439"/>
        <path d="M${nx1},146 L64,158 L88,188 L100,174 Z" fill="#596167"/>
        <path d="M${nx2},146 L136,158 L112,188 L100,174 Z" fill="#596167"/>
        <path d="M70,161 L82,158 L86,171 L76,173 Z" fill="#7d2620"/><path d="M130,161 L118,158 L114,171 L124,173 Z" fill="#7d2620"/>
        <path d="M22,180 L58,161 L62,169 L27,189 Z" fill="#383e43"/><path d="M178,180 L142,161 L138,169 L173,189 Z" fill="#383e43"/>
        <path d="M34,174 l4,8 M41,170 l4,8 M48,166 l4,8 M166,174 l-4,8 M159,170 l-4,8 M152,166 l-4,8" stroke="#a68c3e" stroke-width="2"/>
        <circle cx="100" cy="204" r="3" fill="#a68c3e"/><circle cx="100" cy="228" r="3" fill="#a68c3e"/>`;
    },
  };

  function hairBack(p) {
    if (p.hairStyle === 'kerchief') {
      return `<path d="M50,104 C34,-2 166,-2 150,104 C152,128 132,146 100,154 C68,146 48,128 50,104 Z" fill="${p.hat}"/>`;
    }
    return '';
  }

  function hairFront(p) {
    const h = p.hair;
    switch (p.hairStyle) {
      case 'short':
        return `<path d="M59,80 C50,6 150,6 141,80 L138,66 C132,52 118,47 100,47 C82,47 68,52 62,66 Z" fill="${h}"/>`;
      case 'shaggy':
        return `<path d="M54,98 C40,0 160,0 146,98 L139,74 C134,60 126,56 118,60 C110,50 98,50 90,58 C80,50 68,58 62,74 Z" fill="${h}"/>
          <path d="M72,34 Q90,22 112,28 M84,44 Q100,36 122,42" stroke="#fff" stroke-opacity=".12" stroke-width="2" fill="none"/>`;
      case 'crew':
        return `<path d="M61,74 C54,12 146,12 139,74 C134,54 120,43 100,43 C80,43 66,54 61,74 Z" fill="${h}" opacity=".92"/>`;
      case 'slick':
        return `<path d="M60,78 C50,8 150,8 140,78 C138,58 128,42 104,40 C84,39 66,52 60,78 Z" fill="${h}"/>
          <path d="M70,56 Q76,46 86,44 Q79,50 76,60 Z M130,56 Q124,46 114,44 Q121,50 124,60 Z" fill="${p.skin}"/>
          <path d="M76,32 Q100,22 126,34 M84,26 Q102,19 120,27" stroke="#fff" stroke-opacity=".16" stroke-width="1.6" fill="none"/>`;
      case 'balding':
        return `<path d="M57,92 C52,74 55,58 65,50 C63,64 63,78 64,92 Z" fill="${h}"/><path d="M143,92 C148,74 145,58 135,50 C137,64 137,78 136,92 Z" fill="${h}"/>
          <ellipse cx="96" cy="44" rx="17" ry="5" fill="#fff" opacity=".14"/>`;
      case 'cap':
        return `<path d="M59,86 L59,62 L65,62 L65,82 Z M141,86 L141,62 L135,62 L135,82 Z" fill="${h}"/>
          <path d="M54,62 C48,14 152,14 146,62 C124,52 76,52 54,62 Z" fill="${p.hat}"/>
          <path d="M56,61 C78,52 122,52 144,61 C150,64 147,71 140,70 C116,62 84,62 60,70 C53,71 50,64 56,61 Z" fill="${p.hat}"/>
          <path d="M56,61 C78,52 122,52 144,61 C150,64 147,71 140,70 C116,62 84,62 60,70 C53,71 50,64 56,61 Z" fill="#000" opacity=".35"/>
          <circle cx="100" cy="27" r="2.4" fill="#000" opacity=".3"/>`;
      case 'kerchief':
        return `<path d="M80,50 Q100,41 120,50 Q100,47 80,50 Z" fill="${h}" stroke="${h}" stroke-width="3"/>
          <path fill-rule="evenodd" d="M50,104 C34,-2 166,-2 150,104 C152,128 132,146 100,154 C68,146 48,128 50,104 Z M100,46 C123,46 136,63 136,88 C136,113 120,131 100,131 C80,131 64,113 64,88 C64,63 77,46 100,46 Z" fill="${p.hat}"/>
          <g fill="#d9c27a" opacity=".8"><circle cx="66" cy="50" r="2"/><circle cx="84" cy="26" r="2"/><circle cx="112" cy="20" r="2"/><circle cx="136" cy="44" r="2"/><circle cx="146" cy="78" r="2"/><circle cx="56" cy="84" r="2"/><circle cx="62" cy="122" r="2"/><circle cx="140" cy="118" r="2"/><circle cx="100" cy="14" r="2"/></g>
          <path d="M90,151 L100,145 L110,151 L115,176 L100,163 L85,176 Z" fill="${p.hat}"/>
          <path d="M90,151 L100,145 L110,151 L100,158 Z" fill="#000" opacity=".25"/>`;
      case 'peaked':
        return `<path d="M59,88 L59,66 L65,66 L65,84 Z M141,88 L141,66 L135,66 L135,84 Z" fill="${h}"/>
          <path d="M48,50 C48,14 152,14 152,50 L143,60 L57,60 Z" fill="#4f565c"/>
          <path d="M57,59 L143,59 L141,70 L59,70 Z" fill="#7d2620"/>
          <path d="M59,70 L141,70 C138,84 62,84 59,70 Z" fill="#101214"/>
          <ellipse cx="100" cy="60" rx="5" ry="6.5" fill="#a68c3e"/><ellipse cx="100" cy="60" rx="2.2" ry="3" fill="#7d2620"/>`;
      default:
        return '';
    }
  }

  function glasses(kind) {
    const st = 'stroke="#241f1b" stroke-width="2.1"';
    const lens = 'fill="#bcd6dd" fill-opacity=".16"';
    if (kind === 'round') {
      return `<circle cx="84" cy="81" r="10.5" ${lens} ${st}/><circle cx="116" cy="81" r="10.5" ${lens} ${st}/>
        <path d="M94.5,80 Q100,76.5 105.5,80 M73.5,80 L62,77 M126.5,80 L138,77" fill="none" ${st}/>
        <path d="M78,76 l5,-3 M110,76 l5,-3" stroke="#fff" stroke-opacity=".5" stroke-width="1.4"/>`;
    }
    return `<rect x="73" y="74" width="21" height="14" rx="3" ${lens} ${st}/><rect x="106" y="74" width="21" height="14" rx="3" ${lens} ${st}/>
      <path d="M94,79 L106,79 M73,78 L62,76 M127,78 L138,76" fill="none" ${st}/>
      <path d="M77,78 l6,-2 M110,78 l6,-2" stroke="#fff" stroke-opacity=".5" stroke-width="1.4"/>`;
  }

  /* Поясной портрет в коробке 200×240. uid нужен для clipPath (несколько портретов на странице). */
  function person(p, uid) {
    const wide = p.jaw === 'wide';
    const nw = wide ? 21 : 16;
    const nx1 = 100 - nw, nx2 = 100 + nw;
    const face = FACE[p.jaw || 'mid'];
    const brow = p.brow || p.hair;
    const b = BROWS[p.brows || 'neutral'];
    const clip = 'dzf_' + uid;
    const eye = (ex) => `<ellipse cx="${ex}" cy="81" rx="6" ry="3.8" fill="#ddd6c6"/>
      <circle cx="${ex}" cy="81.3" r="2.6" fill="#231b17"/><circle cx="${ex + 0.9}" cy="80.3" r=".75" fill="#fff"/>
      ${p.lids ? `<path d="M${ex - 6},81 A6,3.8 0 0 1 ${ex + 6},81 Z" fill="${p.skin}"/>` : ''}
      <path d="M${ex - 6.5},${p.lids ? 81 : 80.2} Q${ex},${p.lids ? 78.6 : 75.6} ${ex + 6.5},${p.lids ? 81 : 80.2}" stroke="#2a1f1a" stroke-width="1.5" fill="none"/>`;

    let s = `<defs><clipPath id="${clip}"><path d="${face}"/></clipPath></defs>`;
    s += hairBack(p);
    // шея и тень от подбородка
    s += `<path d="M${nx1},106 L${nx1},152 L${nx2},152 L${nx2},106 Z" fill="${p.skin}"/>
      <path d="M${nx1},110 L${nx2},110 L${nx2},139 Q100,151 ${nx1},139 Z" fill="${p.shade}" opacity=".62"/>`;
    if (p.tattoo) {
      const cx = nx2 - 8, cy = 141;
      s += `<g class="dz-tattoo" stroke="#22405e" stroke-width="1.5" fill="none" stroke-linecap="round"><circle cx="${cx}" cy="${cy - 6}" r="1.7"/>
        <path d="M${cx},${cy - 4.3} L${cx},${cy + 5.5} M${cx - 3.2},${cy - 1.6} L${cx + 3.2},${cy - 1.6} M${cx - 4.8},${cy + 2} Q${cx},${cy + 8.5} ${cx + 4.8},${cy + 2}"/></g>`;
    }
    s += CLOTHES[p.clothes](p, nx1, nx2);
    // голова
    s += `<ellipse cx="60" cy="85" rx="6" ry="10" fill="${p.shade}"/><ellipse cx="140" cy="85" rx="6" ry="10" fill="${p.skin}"/>`;
    s += `<path d="${face}" fill="${p.skin}"/>`;
    s += `<g clip-path="url(#${clip})">
      <path d="M56,20 L98,20 C78,34 70,56 70,92 C70,114 84,128 100,136 L56,136 Z" fill="${p.shade}" opacity=".42"/>
      <path d="M70,77 Q84,70 97,77 L97,85 Q84,89 70,85 Z M103,77 Q116,70 130,77 L130,85 Q116,89 103,85 Z" fill="#000" opacity=".1"/>
      ${p.stubble ? `<path d="M56,92 C60,112 78,120 100,120 C122,120 140,112 144,92 L144,140 L56,140 Z" fill="#1c1815" opacity=".24"/>` : ''}
      ${p.blush ? `<ellipse cx="79" cy="99" rx="8" ry="5" fill="#c6584e" opacity=".34"/><ellipse cx="121" cy="99" rx="8" ry="5" fill="#c6584e" opacity=".34"/><circle cx="100" cy="101" r="5.5" fill="#c6584e" opacity=".38"/>` : ''}
    </g>`;
    if (p.wrinkles) {
      s += `<path d="M75,90 Q84,93 92,90 M108,90 Q116,93 125,90 M89,100 Q85,108 88,116 M111,100 Q115,108 112,116 M82,59 Q100,56 118,59" stroke="${p.shade}" stroke-width="1.2" fill="none"/>`;
    }
    s += `<g class="dz-eyes">${eye(84)}${eye(116)}</g>`;
    s += `<path d="${b[0]} ${b[1]}" stroke="${brow}" stroke-width="3.3" stroke-linecap="round" fill="none"/>`;
    s += `<path d="M101,84 Q97,97 94,102 Q100,106.5 106,102" stroke="${p.shade}" stroke-width="1.9" fill="none" stroke-linecap="round"/>`;
    s += `<path d="${MOUTH[p.mouth || 'neutral']}" stroke="#5a362d" stroke-width="2.3" fill="none" stroke-linecap="round"/>`;
    if (p.moustache) {
      s += `<path d="M79,107 C88,98 96,100 100,103.5 C104,100 112,98 121,107 C114,113 106,111 100,109 C94,111 86,113 79,107 Z" fill="${p.moustache}"/>`;
    }
    if (p.scar) {
      s += `<g class="dz-scar" stroke-linecap="round"><path d="M121,57 L113,80" stroke="${p.shade}" stroke-width="4.2"/><path d="M121,57 L113,80" stroke="#efcfc0" stroke-width="2.2"/>
        <path d="M116.5,62 l5,1.8 M114.6,68 l5,1.8 M112.8,74 l5,1.8" stroke="#efcfc0" stroke-width="1.2"/></g>`;
    }
    s += hairFront(p);
    if (p.glasses) s += glasses(p.glasses);
    return s;
  }

  const SERGEANT = { jaw: 'mid', skin: '#a8846c', shade: '#7d5f4d', hair: '#2a231e', hairStyle: 'peaked', moustache: '#2a231e',
    brows: 'neutral', mouth: 'flat', clothes: 'uniform' };

  function actors(look, uid) {
    const sc = look.scale || 1;
    const dx = 100 + (1 - sc) * 100, dy = 36 + (1 - sc) * 240;
    return `<g class="dz-actor dz-srg"><g transform="translate(22,62) scale(.76)"><g class="dz-breath dz-breath--slow">${person(SERGEANT, 'srg')}</g></g></g>
      <g class="dz-actor dz-det"><g transform="translate(${dx},${dy}) scale(${sc})"><g class="dz-breath">${person(look, uid)}</g></g></g>`;
  }

  /* Маленькое фото в документ: тот же портрет, обрезанный по плечи. */
  function photo(look, uid) {
    return `<svg viewBox="40 14 120 150" aria-hidden="true" focusable="false">${person(look, 'ph_' + uid)}</svg>`;
  }

  // ————————————————————————————————————————————— вестибюль и окно дежурки

  function scene(glassText, exitText, boardText) {
    const bar = (x) => `<rect x="${x - 1.6}" y="0" width="3.2" height="250" fill="#0f1213"/><rect x="${x - 1.6}" y="0" width="1" height="250" fill="#3a4246"/>`;
    const mug = (x) => `<rect x="${x}" y="45" width="14" height="19" fill="#d3c9b0"/><circle cx="${x + 7}" cy="52" r="3.4" fill="#4b4640"/><path d="M${x + 1.5},64 q5.5,-9 11,0 z" fill="#4b4640"/><rect x="${x}" y="66" width="14" height="1.6" fill="#8f8672"/><rect x="${x}" y="69" width="10" height="1.4" fill="#8f8672"/>`;
    return `<svg class="dz-svg" viewBox="0 0 400 250" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
<defs>
  <linearGradient id="dzWallUp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a5aa93"/><stop offset="1" stop-color="#7c8170"/></linearGradient>
  <linearGradient id="dzPanel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#43645a"/><stop offset="1" stop-color="#34504a"/></linearGradient>
  <radialGradient id="dzGlow" cx=".5" cy="0" r=".8"><stop offset="0" stop-color="#f1f8e6" stop-opacity=".55"/><stop offset="1" stop-color="#f1f8e6" stop-opacity="0"/></radialGradient>
  <radialGradient id="dzVig" cx=".5" cy=".42" r=".78"><stop offset=".5" stop-color="#050707" stop-opacity="0"/><stop offset="1" stop-color="#050707" stop-opacity=".78"/></radialGradient>
  <radialGradient id="dzDeskLamp" cx=".86" cy="1.02" r=".5"><stop offset="0" stop-color="#e9b949" stop-opacity=".22"/><stop offset="1" stop-color="#e9b949" stop-opacity="0"/></radialGradient>
</defs>
<g class="dz-zoom">
  <g class="dz-lobby">
    <rect x="0" y="0" width="400" height="134" fill="url(#dzWallUp)"/>
    <path d="M210,60 q30,-8 60,6 q-20,12 -60,-6 Z M20,96 q22,-6 40,4 q-18,8 -40,-4 Z" fill="#6f7464" opacity=".35"/>
    <rect x="0" y="132" width="400" height="66" fill="url(#dzPanel)"/>
    <rect x="0" y="130" width="400" height="3.2" fill="#28403a"/>
    <path d="M0,150 h400 M0,176 h400" stroke="#2f4a43" stroke-width=".8" opacity=".5"/>
    <rect x="0" y="194" width="400" height="5" fill="#1c1b19"/>
    <rect x="0" y="198" width="400" height="52" fill="#272522"/>
    <!-- камера слева -->
    <rect x="0" y="42" width="46" height="156" fill="#0e1011"/>
    <path d="M7,42 V198 M17,42 V198 M27,42 V198 M37,42 V198" stroke="#4d5456" stroke-width="2.6"/>
    <path d="M0,90 H46 M0,152 H46" stroke="#4d5456" stroke-width="3"/>
    <rect x="33" y="112" width="12" height="18" rx="1.5" fill="#2e3335" stroke="#5c6467" stroke-width="1"/><circle cx="39" cy="121" r="2" fill="#0e1011"/>
    <rect x="46" y="38" width="5" height="160" fill="#262b2c"/>
    <!-- стенд -->
    <rect x="62" y="30" width="86" height="46" fill="#6c5b46" stroke="#3a2f25" stroke-width="1.4"/>
    <rect x="62" y="30" width="86" height="10" fill="#7d2620"/>
    <text x="105" y="37.6" text-anchor="middle" font-family="Oswald, 'Arial Narrow', sans-serif" font-size="6.4" letter-spacing="1.6" fill="#eadfc6">${boardText}</text>
    ${mug(67)}${mug(87)}${mug(107)}${mug(127)}
    <!-- часы -->
    <circle cx="268" cy="42" r="14.5" fill="#e6e0cd" stroke="#2a2a28" stroke-width="2.6"/>
    <path d="M268,30.5 v3 M268,50.5 v3 M256.5,42 h3 M276.5,42 h3" stroke="#2a2a28" stroke-width="1.5"/>
    <line class="dz-clock-h" x1="268" y1="42" x2="268" y2="34.5" stroke="#1b1b1a" stroke-width="2.2" stroke-linecap="round"/>
    <line class="dz-clock-m" x1="268" y1="42" x2="268" y2="31.5" stroke="#1b1b1a" stroke-width="1.4" stroke-linecap="round"/>
    <circle cx="268" cy="42" r="1.5" fill="#7d2620"/>
    <!-- выход справа -->
    <rect x="318" y="30" width="50" height="13" rx="2" fill="#173524" stroke="#0c1c13" stroke-width="1.2"/>
    <text x="343" y="39.8" text-anchor="middle" font-family="Oswald, 'Arial Narrow', sans-serif" font-size="8" letter-spacing="1.8" fill="#8fe0a3">${exitText}</text>
    <rect x="300" y="50" width="86" height="148" fill="#2c241e"/>
    <rect x="305" y="55" width="76" height="143" fill="#5b4735"/>
    <rect x="313" y="64" width="60" height="56" fill="none" stroke="#45362a" stroke-width="2"/>
    <rect x="313" y="128" width="60" height="62" fill="none" stroke="#45362a" stroke-width="2"/>
    <circle cx="312" cy="126" r="2.8" fill="#b89a45"/>
    <rect x="288" y="104" width="7" height="10" rx="1" fill="#d9d4c3" stroke="#6f6c60" stroke-width=".8"/><path d="M291.5,104 V0" stroke="#6f6c60" stroke-width="1"/>
    <!-- лампа дневного света -->
    <rect x="128" y="1" width="144" height="8" rx="2" fill="#bcc3b8"/>
    <rect class="dz-tube" x="133" y="3.4" width="134" height="3.2" rx="1.6" fill="#f8fdf2"/>
  </g>
  <g class="dz-actors"></g>
  <rect class="dz-light" x="0" y="0" width="400" height="190" fill="url(#dzGlow)"/>
</g>
<g class="dz-front">
  <rect x="0" y="0" width="400" height="250" fill="url(#dzVig)"/>
  <rect x="0" y="0" width="400" height="250" fill="#a8d3cb" opacity=".045"/>
  <path d="M64,0 L112,0 L40,250 L-8,250 Z M128,0 L142,0 L70,250 L56,250 Z" fill="#fff" opacity=".035"/>
  <rect x="0" y="0" width="400" height="250" fill="url(#dzDeskLamp)"/>
  <g transform="translate(400,0) scale(-1,1)"><text x="200" y="22" text-anchor="middle" font-family="Oswald, 'Arial Narrow', sans-serif" font-size="11" letter-spacing="5" fill="#e6d7b0" opacity=".34">${glassText}</text></g>
  ${bar(50)}${bar(150)}${bar(250)}${bar(350)}
  <rect x="0" y="221" width="400" height="3.2" fill="#0f1213"/><rect x="0" y="221" width="400" height="1" fill="#3a4246"/>
  <path fill-rule="evenodd" d="M0,0 H400 V250 H0 Z M7,7 V236 H393 V7 Z" fill="#0b0d0e"/>
  <rect x="7" y="7" width="386" height="229" fill="none" stroke="#343c3f" stroke-width="1"/>
  <rect x="0" y="236" width="400" height="14" fill="#181b1c"/><rect x="0" y="236" width="400" height="1" fill="#414a4d"/>
  <rect x="138" y="239" width="124" height="7" rx="2" fill="#030404"/><rect x="138" y="245.4" width="124" height="1" fill="#5c6569" opacity=".35"/>
</g>
</svg>`;
  }

  // ————————————————————————————————————————————— вещи (64×64)

  const GOLD = '#d8b65e';
  const ITEMS = {
    passport: `<rect x="17" y="7" width="31" height="50" rx="3" fill="#8d2626" ${OUT}/><rect x="17.7" y="7.7" width="4.6" height="48.6" rx="2" fill="#6c1b1b"/>
      <circle cx="35" cy="24" r="7.5" fill="none" stroke="${GOLD}" stroke-width="1.4"/><path d="M31,27.5 q4,-9.5 8,0 M35,18.5 v3.4" stroke="${GOLD}" stroke-width="1.2" fill="none"/>
      <rect x="26" y="38" width="18" height="3" rx="1" fill="${GOLD}"/><rect x="29" y="44" width="12" height="2" rx="1" fill="${GOLD}" opacity=".75"/>`,
    student: `<rect x="9" y="16" width="46" height="32" rx="3" fill="#2f4c6e" ${OUT}/><rect x="9.7" y="16.7" width="44.6" height="4.6" rx="2" fill="#243c58"/>
      <rect x="18" y="27" width="28" height="2.8" rx="1" fill="${GOLD}"/><rect x="22" y="33" width="20" height="2" rx="1" fill="${GOLD}" opacity=".8"/><path d="M32,38.5 l1.5,3 3.2,.4 -2.4,2.2 .6,3.2 -2.9,-1.6 -2.9,1.6 .6,-3.2 -2.4,-2.2 3.2,-.4 z" fill="${GOLD}" opacity=".8"/>`,
    pension: `<rect x="10" y="18" width="44" height="28" rx="3" fill="#5a3a2e" ${OUT}/><rect x="18" y="26" width="28" height="2.8" rx="1" fill="${GOLD}"/><rect x="22" y="32" width="20" height="2" rx="1" fill="${GOLD}" opacity=".8"/><circle cx="32" cy="39.5" r="2.6" fill="none" stroke="${GOLD}" stroke-width="1.2"/>
      <rect x="6" y="13" width="52" height="38" rx="5" fill="#fff" fill-opacity=".1" stroke="#fff" stroke-opacity=".35" stroke-width="1"/><path d="M11,17 l8,6 M46,46 l8,-5" stroke="#fff" stroke-opacity=".3" stroke-width="1"/>`,
    bag: `<path d="M20,24 Q22,9 32,9 Q42,9 44,24" fill="none" stroke="#1d2a3d" stroke-width="3.4"/>
      <path d="M7,31 Q7,22 16,22 L48,22 Q57,22 57,31 L57,46 Q57,53 50,53 L14,53 Q7,53 7,46 Z" fill="#2c3f5c" ${OUT}/>
      <rect x="7.8" y="34" width="48.4" height="5.5" fill="#d9d6cb"/><path d="M14,27 H50" stroke="#101824" stroke-width="1.6" stroke-dasharray="2 1.6"/>`,
    bag_open: `<path d="M7,33 Q7,26 16,26 L48,26 Q57,26 57,33 L57,48 Q57,55 50,55 L14,55 Q7,55 7,48 Z" fill="#2c3f5c" ${OUT}/>
      <ellipse cx="32" cy="27" rx="22" ry="6.5" fill="#0d131c" ${OUT}/>
      <rect x="14" y="10" width="15" height="20" rx="1" fill="#3f7a57" ${OUT} transform="rotate(-8 21 20)"/><rect x="18" y="8" width="15" height="20" rx="1" fill="#7a3f3f" ${OUT} transform="rotate(4 25 18)"/>
      <path d="M36,28 L40,11 Q44,6 49,10 L47,28 Z" fill="#d2a561" ${OUT}/><path d="M40.5,15 l6,1.4 M39.6,20 l6.2,1.4" stroke="#9c7238" stroke-width="1.4"/>
      <path d="M10,31 Q32,38 54,31" fill="none" stroke="#0e0c0a" stroke-width="1.4"/><rect x="7.8" y="40" width="48.4" height="5" fill="#d9d6cb"/>`,
    pass: `<rect x="11" y="17" width="42" height="30" rx="2.5" fill="#cbbd94" ${OUT}/><rect x="11.7" y="17.7" width="40.6" height="7.6" rx="1.8" fill="#3f6d86"/>
      <text x="32" y="42" text-anchor="middle" font-family="Oswald, 'Arial Narrow', sans-serif" font-size="15" fill="#3a332a">10</text><path d="M15,45 h8 M41,45 h8" stroke="#8d8263" stroke-width="1.2"/>`,
    radio: `<path d="M56,26 q5,-3 6,3 M56,31 q6,1 5,7 M56,36 q4,4 2,9" fill="none" stroke-width="1.8" stroke="#a23b2a"/><path d="M56,31 q6,1 5,7" fill="none" stroke-width="1.8" stroke="#c9a54a"/>
      <rect x="4" y="18" width="52" height="28" rx="2.5" fill="#2b2d30" ${OUT}/><rect x="15" y="23" width="26" height="9" rx="1" fill="#090a0b"/><rect x="17" y="26.5" width="22" height="2" fill="#3b3f43"/>
      <circle cx="10" cy="28" r="3.6" fill="#55595e" ${OUT}/><circle cx="10" cy="39" r="2.6" fill="#55595e" ${OUT}/><rect x="44" y="23" width="9" height="7" rx="1" fill="#6f9c68"/>
      <g fill="#8a8f95"><rect x="16" y="37" width="5" height="4" rx=".8"/><rect x="23" y="37" width="5" height="4" rx=".8"/><rect x="30" y="37" width="5" height="4" rx=".8"/><rect x="37" y="37" width="5" height="4" rx=".8"/><rect x="45" y="36" width="7" height="5" rx=".8"/></g>`,
    radio_back: `<path d="M4,26 q-4,-1 -3,-6 M4,32 q-5,2 -3,7 M4,38 q-3,4 0,8" fill="none" stroke-width="1.8" stroke="#a23b2a"/><path d="M4,32 q-5,2 -3,7" fill="none" stroke-width="1.8" stroke="#c9a54a"/>
      <rect x="4" y="16" width="56" height="32" rx="2.5" fill="#33363a" ${OUT}/><path d="M9,21 h12 M9,24.5 h12 M9,28 h12 M43,21 h12 M43,24.5 h12 M43,28 h12" stroke="#17191b" stroke-width="1.6"/>
      <circle cx="9.5" cy="43" r="1.6" fill="#17191b"/><circle cx="54.5" cy="43" r="1.6" fill="#17191b"/>
      <rect x="15" y="31" width="34" height="13" rx="1" fill="#d6d0bd" ${OUT}/><text x="32" y="40.6" text-anchor="middle" font-family="'PT Mono', 'Courier New', monospace" font-size="7.6" fill="#1a1a18">№ 0417</text>`,
    screwdriver: `<path d="M27,37 L52,12" stroke="#0e0c0a" stroke-width="6" stroke-linecap="round"/><path d="M27,37 L52,12" stroke="#aeb4b8" stroke-width="3.4" stroke-linecap="round"/>
      <path d="M48.5,15.5 L53,11" stroke="#7b2032" stroke-width="3.4" stroke-linecap="round"/>
      <path d="M8,50 Q6,46 10,42 L21,31 Q25,29 28,32 L32,36 Q35,39 33,43 L22,54 Q18,58 14,56 Z" fill="#b8862c" ${OUT}/><path d="M13,45 L24,34 M17,50 L29,38" stroke="#7d5a1b" stroke-width="1.5"/>`,
    keys: `<circle cx="22" cy="20" r="10" fill="none" stroke="#0e0c0a" stroke-width="5"/><circle cx="22" cy="20" r="10" fill="none" stroke="#b9bdc1" stroke-width="2.4"/>
      <g ${OUT}><path d="M26,28 L30,26 L50,50 L48,54 L45,53 L44,49 L41,49 L40,45 L37,45 Z" fill="#c9a54a"/><path d="M18,29 L22,30 L22,56 L19,59 L16,56 L18,53 L16,50 L18,47 Z" fill="#aeb4b8"/>
      <path d="M30,22 L34,19 L54,24 Q58,27 55,31 Q51,34 47,30 L33,26 Z" fill="#8a8f95"/></g><circle cx="52" cy="27.5" r="2" fill="#0e0c0a"/>`,
    seeds: `<path d="M38,27 L60,27 L57,56 L41,56 Z" fill="#a9c9cf" fill-opacity=".42" ${OUT}/><path d="M44,27 L45.5,56 M49,27 L49,56 M54,27 L52.5,56" stroke="#dff1f3" stroke-opacity=".6" stroke-width="1"/><path d="M40,38 L58.6,38 L57,56 L41,56 Z" fill="#1b1917" opacity=".85"/>
      <path d="M8,17 L40,15 L26,58 Z" fill="#cfc9b5" ${OUT}/><path d="M14,24 l18,-1 M16,30 l15,-1 M19,37 l10,-1 M21,44 l6,-.6" stroke="#8c8672" stroke-width="1.1"/>
      <ellipse cx="24" cy="15.5" rx="15.6" ry="4.6" fill="#1b1917" ${OUT}/><path d="M14,14 l2,2 M20,13 l2,2.4 M27,13 l-2,2.6 M33,14 l-2,2" stroke="#6b665c" stroke-width="1.3" stroke-linecap="round"/>`,
    coins: `<path d="M24,22 L14,9 L27,14 Z M38,22 L50,10 L36,13 Z" fill="#bfb7a2" ${OUT}/>
      <path d="M12,40 Q9,24 28,23 Q50,20 51,38 Q53,56 32,56 Q13,56 12,40 Z" fill="#cdc5b0" ${OUT}/><path d="M18,30 L46,50 M28,25 L50,42 M14,42 L32,55 M44,26 L16,50 M34,24 L12,40 M50,34 L26,55" stroke="#7d8fa3" stroke-width="1" opacity=".6"/>
      <ellipse cx="31" cy="23" rx="6.5" ry="3" fill="#a79f8b" ${OUT}/><circle cx="54" cy="52" r="5.6" fill="#b89a45" ${OUT}/><circle cx="54" cy="52" r="3" fill="none" stroke="#7d6a2c" stroke-width="1"/>`,
    ticket: `<g transform="rotate(-9 32 32)"><rect x="8" y="20" width="48" height="24" rx="1.5" fill="#d8c9a3" ${OUT}/><path d="M42,20 V44" stroke="#0e0c0a" stroke-width="1" stroke-dasharray="1.6 1.8"/>
      <rect x="12" y="25" width="24" height="2.6" fill="#3a332a"/><rect x="12" y="31" width="18" height="1.8" fill="#7d7460"/><rect x="12" y="36" width="22" height="1.8" fill="#7d7460"/><rect x="45.5" y="26" width="7" height="12" fill="#a23b2a" opacity=".75"/></g>`,
    knives: `<rect x="50" y="29" width="11" height="6" rx="2" fill="#5b3d27" ${OUT}/>
      <rect x="5" y="22" width="48" height="20" rx="10" fill="#9a8d73" ${OUT}/><path d="M12,24 q-4,8 0,16 M44,23 q5,9 0,18" fill="none" stroke="#7d7159" stroke-width="1.3"/>
      <path d="M22,22 V42 M36,22 V42" stroke="#4f3f30" stroke-width="2.6"/><path d="M22,42 l-3,7 M22,42 l4,6" stroke="#4f3f30" stroke-width="1.8" stroke-linecap="round"/>`,
    knives_open: `<rect x="5" y="6" width="54" height="52" rx="2" fill="#9a8d73" ${OUT}/>
      <g ${OUT}><path d="M13,9 L22,9 L22,37 L14,37 Q11,22 13,9 Z" fill="#d3d8da"/><path d="M30,9 L34.2,12 L34.2,37 L30,37 Z" fill="#d3d8da"/><path d="M45,20 L49.4,23 L49.4,37 L45,37 Z" fill="#d3d8da"/>
      <rect x="14.6" y="37" width="6.8" height="17" rx="1.5" fill="#5b3d27"/><rect x="29" y="37" width="6" height="17" rx="1.5" fill="#5b3d27"/><rect x="44" y="37" width="6.2" height="15" rx="1.5" fill="#5b3d27"/></g>
      <path d="M5.7,41 H58.3" stroke="#0e0c0a" stroke-width="1.2"/><rect x="5.7" y="41.6" width="52.6" height="15.8" fill="#8a7d64" opacity=".82"/><path d="M26,42 V57 M40,42 V57" stroke="#6d624d" stroke-width="1.2"/>`,
    apron: `<path d="M24,12 Q32,2 40,12" fill="none" stroke="#b9b5a8" stroke-width="2.4"/>
      <path d="M23,11 L41,11 L45,24 L53,56 L11,56 L19,24 Z" fill="#dedacd" ${OUT}/><path d="M19,24 L7,28 M45,24 L57,28" stroke="#b9b5a8" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M24,31 q5,-4 9,1 q3,6 -3,8 q-8,1 -6,-9 Z M36,43 q4,-2 6,2 q0,5 -5,4 q-3,-2 -1,-6 Z M22,47 q3,-1 3,2 q-2,3 -4,1 Z" fill="#7b2238" opacity=".9"/>
      <rect x="26" y="15" width="12" height="8" fill="none" stroke="#b9b5a8" stroke-width="1"/>`,
    workpass: `<rect x="10" y="14" width="44" height="36" rx="3" fill="#d9d6cb" ${OUT}/><rect x="10.7" y="14.7" width="42.6" height="6.6" rx="2" fill="#5d2732"/>
      <rect x="14" y="25" width="13" height="17" fill="#8b8f93" ${OUT}/><circle cx="20.5" cy="31" r="3.2" fill="#55595e"/><path d="M15,42 q5.5,-9 11,0 z" fill="#55595e"/>
      <rect x="31" y="26" width="19" height="2.4" fill="#3a332a"/><rect x="31" y="32" width="15" height="1.8" fill="#7d7460"/><rect x="31" y="37" width="17" height="1.8" fill="#7d7460"/><circle cx="46" cy="44" r="3.4" fill="none" stroke="#3b5a86" stroke-width="1.2"/>`,
    jar: `<rect x="16" y="19" width="32" height="38" rx="6" fill="#c8d6cc" fill-opacity=".4" ${OUT}/><rect x="18.5" y="29" width="27" height="25.5" rx="4" fill="#e5e0c4"/>
      <rect x="14.5" y="11" width="35" height="9" rx="2.5" fill="#d8d2c0" ${OUT}/><path d="M18,14 v4 M23,14 v4 M28,14 v4 M33,14 v4 M38,14 v4 M43,14 v4" stroke="#a8a290" stroke-width="1"/>
      <rect x="21" y="34" width="22" height="12" fill="#f3efe2" ${OUT}/><path d="M24,39 q3,-3 5,0 q2,3 5,0 q2,-2 6,0 M25,43 h10" fill="none" stroke="#3b5a86" stroke-width="1.2"/>
      <path d="M21,24 v20" stroke="#fff" stroke-opacity=".5" stroke-width="1.6" stroke-linecap="round"/>`,
    wallet: `<rect x="9" y="17" width="46" height="31" rx="4.5" fill="#6b4426" ${OUT}/><path d="M9.7,27 H54.3" stroke="#3f2715" stroke-width="1.4"/>
      <rect x="12" y="20" width="40" height="25" rx="3" fill="none" stroke="#a37548" stroke-width="1" stroke-dasharray="2.2 1.8"/><path d="M39,27 h9 v9 q-4.5,4 -9,0 z" fill="#5a381f" ${OUT}/><circle cx="43.5" cy="33" r="2" fill="#b89a45"/>`,
    wallet_open: `<path d="M4,19 L32,15 L60,19 L60,50 L32,54 L4,50 Z" fill="#6b4426" ${OUT}/><path d="M32,15 V54" stroke="#3f2715" stroke-width="1.6"/>
      <g ${OUT}><path d="M8,18 L27,15.4 L27,26 L8,28 Z" fill="#86a37f"/><path d="M10,21 L29,18.4 L29,29 L10,31 Z" fill="#9fb898"/><path d="M7,29 L30,26.6 L30,50 L7,47.6 Z" fill="#7a5131"/>
      <path d="M37,19 L56,21.4 L56,37 L37,35 Z" fill="#e3ded0"/><rect x="40" y="23" width="6" height="8" fill="#8b8f93" transform="skewY(7)"/><path d="M35,31 L58,33.6 L58,48 L35,50.6 Z" fill="#7a5131"/></g>
      <path d="M48.5,26.6 l5.4,.7 M48.5,29.6 l4,.5" stroke="#3a332a" stroke-width="1.1"/>`,
    watch: `<rect x="26" y="2" width="12" height="60" rx="3.5" fill="#4a3122" ${OUT}/><path d="M32,5 v8 M32,51 v8" stroke="#2d1d13" stroke-width="1" stroke-dasharray="1.4 1.6"/>
      <rect x="45" y="29.5" width="4" height="5" rx="1" fill="#b89a45" ${OUT}/><circle cx="32" cy="32" r="14.5" fill="#d1ab4c" ${OUT}/><circle cx="32" cy="32" r="11" fill="#f0ead8" ${OUT}/>
      <path d="M32,23 v2 M32,39 v2 M23,32 h2 M39,32 h2" stroke="#3a332a" stroke-width="1.3"/><path d="M32,32 L32,25.6 M32,32 L36.6,34.4" stroke="#1b1b1a" stroke-width="1.6" stroke-linecap="round"/>`,
    watch_back: `<rect x="26" y="2" width="12" height="60" rx="3.5" fill="#3d281b" ${OUT}/><rect x="15" y="29.5" width="4" height="5" rx="1" fill="#b89a45" ${OUT}/>
      <circle cx="32" cy="32" r="14.5" fill="#c9a445" ${OUT}/><circle cx="32" cy="32" r="11.4" fill="#b8953d" stroke="#8c6f2a" stroke-width="1"/>
      <path d="M25,28 q2,-2 4,0 t4,0 t4,0 t2,0 M24.6,32 q2,-2 4,0 t4,0 t4,0 t3,0 M27,36 q2,-2 4,0 t4,0 t2,0" fill="none" stroke="#6a5320" stroke-width="1.1"/>`,
    coin: `<circle cx="32" cy="32" r="18" fill="#b0763a" ${OUT}/><circle cx="32" cy="32" r="14" fill="none" stroke="#8c5a29" stroke-width="1.2"/>
      <text x="32" y="39.4" text-anchor="middle" font-family="Oswald, 'Arial Narrow', sans-serif" font-size="20" fill="#6d451f">5</text>
      <path d="M42.5,17.4 A18,18 0 0 1 46.6,42.6" fill="none" stroke="#f4f6f7" stroke-width="2.6" stroke-linecap="round"/>`,
    money: `<rect x="10" y="27" width="47" height="23" rx="1.5" fill="#5d7d63" ${OUT}/><rect x="8.5" y="24" width="47" height="23" rx="1.5" fill="#6f8f6f" ${OUT}/><rect x="7" y="20" width="47" height="23" rx="1.5" fill="#8aa883" ${OUT}/>
      <ellipse cx="24" cy="31.5" rx="8" ry="6" fill="#6e8c6a"/><rect x="10" y="23" width="6" height="3.6" fill="#55755a"/><rect x="45" y="36.4" width="6" height="3.6" fill="#55755a"/>
      <rect x="35" y="18" width="5.4" height="34" rx="1.5" fill="#b9623e" ${OUT}/>`,
    smokes: `<path d="M43,21 L59,24 L58,29.6 L42,26.6 Z" fill="#b9c0c4" ${OUT}/><path d="M47,24.4 l6,1.2" stroke="#5c6569" stroke-width="1.2"/>
      <rect x="38" y="31" width="19" height="25" rx="1.5" fill="#c9a54a" ${OUT}/><rect x="38.7" y="31.7" width="4.4" height="23.6" fill="#5b3a2a"/><rect x="46" y="37" width="8" height="8" fill="#9b2d25"/>
      <g ${OUT}><rect x="13" y="6" width="5" height="9" fill="#efe9d8"/><rect x="19" y="5" width="5" height="10" fill="#efe9d8"/><rect x="25" y="6.5" width="5" height="8.5" fill="#efe9d8"/></g>
      <rect x="9" y="13" width="25" height="40" rx="2" fill="#dcd7c6" ${OUT}/><rect x="9.7" y="13.7" width="23.6" height="9.6" rx="1.4" fill="#9b2d25"/><circle cx="21.5" cy="37" r="5.6" fill="none" stroke="#9b2d25" stroke-width="1.4"/>`,
    gloves: `<path d="M26,58 L26,34 Q26,30 29,30 L29,19 Q31,16 33,19 L33,28 L35,28 L35,15 Q37,12 39,15 L39,28 L41,28 L41,17 Q43,14 45,17 L45,30 L47,30 L47,23 Q49,20.6 51,23.6 L50,44 L48,58 Z" fill="#171514" stroke="#3d3936" stroke-width="1.3" stroke-linejoin="round"/>
      <path d="M11,56 L11,32 Q11,28 14,28 L14,15 Q16,12 18,15 L18,26 L20,26 L20,11 Q22,8 24,11 L24,26 L26,26 L26,13 Q28,10 30,13 L30,28 L32,28 L32,20 Q34,17.6 36,20.6 L35,42 L33,56 Z" fill="#221f1d" stroke="#4a4541" stroke-width="1.3" stroke-linejoin="round"/>
      <path d="M11,49 H34" stroke="#4a4541" stroke-width="1.2"/>`,
    pistol: `<path d="M22,30 Q19,44 33,42 L35,30" fill="none" stroke="#0e0c0a" stroke-width="4.6"/><path d="M22,30 Q19,44 33,42 L35,30" fill="none" stroke="#3a3e42" stroke-width="2.2"/>
      <path d="M36,29 L50,29 L56,54 Q56,58 52,58 L44,59 Q41,59 40,56 Z" fill="#3b2d24" ${OUT}/><path d="M42,36 l9,-1 M43.4,42 l9,-1 M44.8,48 l9,-1" stroke="#22190f" stroke-width="1.3"/>
      <path d="M5,19 L49,19 L52,22 L52,31 L5,31 Z" fill="#2c2f32" ${OUT}/><rect x="3" y="21.5" width="3.4" height="6" fill="#0a0b0c"/>
      <path d="M40,21 v8 M43,21 v8 M46,21 v8" stroke="#15171a" stroke-width="1.3"/><rect x="12" y="21.6" width="20" height="2" fill="#4a4f54"/><path d="M28,32 l-1,6" stroke="#0e0c0a" stroke-width="2" stroke-linecap="round"/>`,
    card: `<g transform="rotate(-6 32 32)"><rect x="7" y="19" width="50" height="27" rx="2" fill="#e8e3d3" ${OUT}/><circle cx="16.5" cy="28.5" r="4.4" fill="#c9a445"/><path d="M14,28.5 h5 M16.5,26 v5" stroke="#8c6f2a" stroke-width="1"/>
      <rect x="25" y="25" width="26" height="2.8" fill="#2b2620"/><rect x="25" y="31" width="18" height="1.8" fill="#6b655a"/><rect x="12" y="38" width="40" height="1.5" fill="#6b655a"/><rect x="12" y="41.4" width="26" height="1.5" fill="#6b655a"/></g>`,
    carkeys: `<circle cx="24" cy="17" r="8.5" fill="none" stroke="#0e0c0a" stroke-width="4.6"/><circle cx="24" cy="17" r="8.5" fill="none" stroke="#b9bdc1" stroke-width="2.2"/>
      <g ${OUT}><path d="M30,20 L37,17 L43,24 L58,40 L57,45 L52,45 L51,41 L47,41 L46,37 L39,31 L33,28 Z" fill="#aeb4b8"/><path d="M29,19 L38,15 L44,23 L35,30 Z" fill="#1c1e20"/>
      <circle cx="20" cy="43" r="12.5" fill="#26282b"/></g><circle cx="20" cy="43" r="9" fill="none" stroke="#b9bdc1" stroke-width="1.6"/>
      <path d="M20,43 L20,34.4 M20,43 L12.6,47.4 M20,43 L27.4,47.4" stroke="#b9bdc1" stroke-width="1.8" stroke-linecap="round"/><path d="M22,25 L21,31" stroke="#b9bdc1" stroke-width="2"/>`,
  };

  function item(key) {
    return `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">${ITEMS[key] || ''}</svg>`;
  }

  const ICONS = {
    zoom: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15,15 L21,21" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    sound_on: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4,9.5 H8 L13,5.5 V18.5 L8,14.5 H4 Z" fill="currentColor"/><path d="M16,9 q2.4,3 0,6 M18.6,6.6 q4.4,5.4 0,10.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    sound_off: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4,9.5 H8 L13,5.5 V18.5 L8,14.5 H4 Z" fill="currentColor"/><path d="M16.5,9.5 l5,5 M21.5,9.5 l-5,5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    home: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6,3 H16 V21 H6 Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="13.2" cy="12.4" r="1.2" fill="currentColor"/><path d="M19,9 l3,3 l-3,3 M22,12 H17.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    cell: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="3" width="18" height="18" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8,3 V21 M12,3 V21 M16,3 V21" stroke="currentColor" stroke-width="1.8"/></svg>',
  };

  DZ.art = { scene, actors, person, photo, item, has: (k) => !!ITEMS[k], icon: (k) => ICONS[k] || '' };
})(typeof window !== 'undefined' ? window : globalThis);
