/* UI wiring: editor, conversion, WebGL preview, model switching, downloads. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var codeEl = $('code'), gutterEl = $('gutter'), logEl = $('log'), glslEl = $('glslOut');
  var statusEl = $('status'), nameEl = $('shaderName'), emptyEl = $('stageEmpty');
  var canvas = $('view');
  var samples = window.SHADER_SAMPLES || [];

  var MODELS = [
    { key: 'sphere', label: '球体' },
    { key: 'cube', label: '立方体' },
    { key: 'torus', label: '圆环' },
    { key: 'gem', label: '多面宝石' }
  ];

  var viewer = null, result = null, currentSample = samples[0] ? samples[0].id : null;
  var modelCache = {}, currentModel = 'sphere', modelRequest = 0;
  var lastErrors = { vertex: new Set(), fragment: new Set() };

  /* ---------- editor ---------- */

  function updateGutter() {
    var n = codeEl.value.split('\n').length;
    var out = new Array(n);
    for (var i = 0; i < n; i++) out[i] = i + 1;
    gutterEl.textContent = out.join('\n');
    gutterEl.scrollTop = codeEl.scrollTop;
  }

  function setCode(text) {
    codeEl.value = text;
    updateGutter();
    codeEl.scrollTop = 0;
  }

  codeEl.addEventListener('input', updateGutter);
  codeEl.addEventListener('scroll', function () { gutterEl.scrollTop = codeEl.scrollTop; });
  codeEl.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      var s = codeEl.selectionStart, t = codeEl.selectionEnd;
      codeEl.setRangeText('    ', s, t, 'end');
      updateGutter();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      compile();
    }
  });

  /* ---------- log / status ---------- */

  function addLog(kind, message, detail) {
    var row = document.createElement('div');
    row.className = 'row ' + kind;
    var ico = document.createElement('span');
    ico.className = 'ico';
    ico.textContent = kind === 'error' ? '✕' : kind === 'warn' ? '!' : kind === 'ok' ? '✓' : '›';
    var body = document.createElement('div');
    body.className = 'body';
    var msg = document.createElement('div');
    msg.className = 'msg';
    msg.textContent = message;
    body.appendChild(msg);
    if (detail) {
      var d = document.createElement('div');
      d.className = 'detail';
      d.textContent = detail;
      body.appendChild(d);
    }
    row.appendChild(ico);
    row.appendChild(body);
    logEl.appendChild(row);
    while (logEl.children.length > 220) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function clearLog() { logEl.textContent = ''; }

  function setStatus(kind, text) {
    statusEl.className = 'status ' + kind;
    statusEl.querySelector('b').textContent = text;
  }

  /* ---------- GLSL viewer ---------- */

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderGLSL(info, errors) {
    if (!info) return;
    var out = [];
    [['vertex', '顶点着色器 · VERTEX'], ['fragment', '片元着色器 · FRAGMENT']].forEach(function (pair) {
      out.push('<div class="glsl-file">// ' + pair[1] + '</div>');
      var lines = info.glsl[pair[0]].split('\n');
      for (var i = 0; i < lines.length; i++) {
        var bad = errors && errors[pair[0]] && errors[pair[0]].has(i + 1);
        out.push('<span class="glsl-line' + (bad ? ' bad' : '') + '"><em>' + (i + 1) + '</em>' + escapeHtml(lines[i]) + '</span>');
      }
    });
    glslEl.innerHTML = out.join('');
    glslEl.scrollTop = 0;
  }

  /* ---------- compile ---------- */

  function reportCompileError(err) {
    var stage = err.stage;
    var label = stage === 'vertex' ? '顶点着色器' : stage === 'fragment' ? '片元着色器' : '着色器链接';
    var log = (err.log || err.message || '未知错误').trim();
    addLog('error', label + '编译失败', '');
    var parsed = 0;
    log.split('\n').forEach(function (line) {
      var m = /(ERROR|WARNING)\s*:\s*\d+:(\d+)\s*:\s*(.*)/i.exec(line);
      if (!m) return;
      parsed++;
      var no = parseInt(m[2], 10);
      var srcLine = err.src ? (err.src.split('\n')[no - 1] || '').trim() : '';
      if (stage && lastErrors[stage]) lastErrors[stage].add(no);
      addLog(m[1].toLowerCase() === 'warning' ? 'warn' : 'error', '第 ' + no + ' 行：' + m[3], srcLine);
    });
    if (!parsed) addLog('error', log, '');
    addLog('info', '行号对应“GLSL 输出”标签页中生成代码的行号。', '');
    renderGLSL(result, lastErrors);
  }

  function compile() {
    clearLog();
    lastErrors = { vertex: new Set(), fragment: new Set() };
    var source = codeEl.value;
    if (!source.trim()) {
      setStatus('error', '没有代码');
      addLog('error', '编辑器是空的', '粘贴 Unity Shader 代码，或从右上角选择一个示例。');
      return;
    }

    var t0 = performance.now();
    try {
      result = window.ShaderConverter.convert(source);
    } catch (e) {
      result = null;
      setStatus('error', '转换失败');
      glslEl.textContent = '';
      nameEl.textContent = '—';
      nameEl.title = '';
      if (e instanceof window.ShaderConverter.ConvertError) {
        addLog('error', e.message, e.hint);
      } else {
        addLog('error', '转换器内部错误：' + (e && e.message ? e.message : e), '请检查代码结构，或换一个示例再试。');
        if (e && e.stack) console.error(e);
      }
      return;
    }

    nameEl.textContent = result.shaderName;
    nameEl.title = result.shaderName;
    renderGLSL(result, lastErrors);

    if (viewer) {
      try {
        viewer.setShader(result);
      } catch (e) {
        setStatus('error', '编译失败');
        reportCompileError(e);
        return;
      }
    }

    result.warnings.forEach(function (w) { addLog('warn', w); });

    var ms = performance.now() - t0;
    if (viewer && !viewer.gl.isContextLost()) {
      setStatus('ok', '编译成功 · ' + ms.toFixed(1) + ' ms');
      emptyEl.classList.add('hidden');
      addLog('ok', '编译成功', 'uniform × ' + result.uniforms.length + ' · varying × ' + result.varyings.length + ' · ' + ms.toFixed(1) + ' ms');
    } else {
      setStatus('warn', '已转换（无预览）');
      addLog('warn', 'GLSL 已生成，但当前没有可用的 WebGL 预览。');
    }
  }

  /* ---------- models ---------- */

  function buildModelButtons() {
    var wrap = $('models');
    MODELS.forEach(function (m) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'model-btn' + (m.key === currentModel ? ' on' : '');
      b.dataset.model = m.key;
      b.textContent = m.label;
      b.addEventListener('click', function () { selectModel(m.key); });
      wrap.appendChild(b);
    });
  }

  function selectModel(key) {
    currentModel = key;
    Array.prototype.forEach.call(document.querySelectorAll('.model-btn'), function (b) {
      b.classList.toggle('on', b.dataset.model === key);
    });
    if (!viewer) return;
    if (modelCache[key]) {
      viewer.setMesh(modelCache[key]);
      addLog('info', '已切换模型：' + labelOf(key));
      return;
    }
    var token = ++modelRequest;
    var btn = document.querySelector('.model-btn[data-model="' + key + '"]');
    if (btn) btn.classList.add('loading');
    addLog('info', '正在加载模型：models/' + key + '.obj');
    fetch('models/' + key + '.obj')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (text) {
        if (token !== modelRequest) return;
        var mesh = window.ShaderPreview.parseOBJ(text);
        modelCache[key] = mesh;
        viewer.setMesh(mesh);
        emptyEl.classList.add('hidden');
        addLog('ok', '模型已加载：' + labelOf(key) + ' · ' + (mesh.count / 3) + ' 个三角面');
      })
      .catch(function (err) {
        if (token !== modelRequest) return;
        addLog('error', '模型加载失败：models/' + key + '.obj', String(err.message || err) +
          (location.protocol === 'file:' ? '（file:// 下浏览器禁止 fetch，请用本地 HTTP 服务打开）' : ''));
        setStatus('warn', '模型加载失败');
      })
      .finally(function () { if (btn) btn.classList.remove('loading'); });
  }

  function labelOf(key) {
    for (var i = 0; i < MODELS.length; i++) if (MODELS[i].key === key) return MODELS[i].label;
    return key;
  }

  /* ---------- downloads ---------- */

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function baseName() {
    var n = (result && result.shaderName) || 'shader';
    n = n.split('/').pop().replace(/[^\w.\-]+/g, '_');
    return n || 'shader';
  }

  $('btnDownloadShader').addEventListener('click', function () {
    if (!codeEl.value.trim()) { addLog('warn', '没有可下载的代码'); return; }
    download(baseName() + '.shader', codeEl.value, 'text/plain;charset=utf-8');
    addLog('ok', '已下载 ' + baseName() + '.shader');
  });

  $('btnDownloadGLSL').addEventListener('click', function () {
    if (!result) { addLog('warn', '请先点击“转换并编译”'); return; }
    var text = '// ' + result.shaderName + '\n// Generated GLSL ES 1.00 by Unity Shader Lab\n\n' +
      '// ==================== VERTEX ====================\n' + result.glsl.vertex +
      '\n// ==================== FRAGMENT ====================\n' + result.glsl.fragment;
    download(baseName() + '.glsl', text, 'text/plain;charset=utf-8');
    addLog('ok', '已下载 ' + baseName() + '.glsl');
  });

  /* ---------- tabs ---------- */

  var tabs = document.querySelectorAll('.tab');
  Array.prototype.forEach.call(tabs, function (tab) {
    tab.addEventListener('click', function () {
      Array.prototype.forEach.call(tabs, function (t) { t.classList.toggle('on', t === tab); });
      var isGlsl = tab.dataset.tab === 'glsl';
      logEl.hidden = isGlsl;
      glslEl.hidden = !isGlsl;
    });
  });
  $('btnClear').addEventListener('click', clearLog);

  /* ---------- samples ---------- */

  var select = $('samples');
  samples.forEach(function (s) {
    var o = document.createElement('option');
    o.value = s.id;
    o.textContent = s.name;
    select.appendChild(o);
  });
  select.addEventListener('change', function () {
    var s = null;
    for (var i = 0; i < samples.length; i++) if (samples[i].id === select.value) s = samples[i];
    if (!s) return;
    currentSample = s.id;
    setCode(s.code);
    compile();
  });

  $('btnReset').addEventListener('click', function () {
    var s = null;
    for (var i = 0; i < samples.length; i++) if (samples[i].id === currentSample) s = samples[i];
    if (!s) s = samples[0];
    if (!s) return;
    setCode(s.code);
    addLog('info', '已重置为示例：' + s.name);
  });

  $('btnCompile').addEventListener('click', compile);
  canvas.addEventListener('dblclick', function () { if (viewer) viewer.resetView(); });

  /* ---------- boot ---------- */

  buildModelButtons();
  if (samples.length) setCode(samples[0].code);

  try {
    viewer = window.ShaderPreview.createViewer(canvas, {
      onError: function (msg) { addLog('warn', msg); }
    });
    emptyEl.classList.add('hidden');
  } catch (e) {
    viewer = null;
    setStatus('error', 'WebGL 不可用');
    emptyEl.innerHTML = '<p class="empty-title">无法创建 WebGL 上下文</p><p>请换用支持 WebGL 的浏览器，或检查是否禁用了硬件加速。</p>';
    addLog('error', 'WebGL 初始化失败：' + e.message);
  }

  if (location.protocol === 'file:') {
    addLog('warn', '当前以 file:// 打开，浏览器会阻止 fetch 加载 OBJ 模型。',
      '在该目录运行 python -m http.server 8123，然后访问 http://localhost:8123');
  }

  if (viewer) selectModel('sphere');
  compile();

  // Small debug surface, handy for the tools/ test pages.
  window.ShaderLab = {
    compile: compile,
    get result() { return result; },
    get viewer() { return viewer; },
    models: modelCache
  };
})();