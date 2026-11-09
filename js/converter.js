/* Unity ShaderLab / HLSL subset -> GLSL ES 1.00 converter.
 * window.ShaderConverter.convert(source) -> { glsl, uniforms, warnings, meta }
 * Throws ShaderConverter.ConvertError for anything it cannot translate. */
(function (root) {
  'use strict';

  function ConvertError(message, hint) {
    this.name = 'ConvertError';
    this.message = message;
    this.hint = hint || '';
    this.stack = (new Error(message)).stack;
  }
  ConvertError.prototype = Object.create(Error.prototype);
  ConvertError.prototype.constructor = ConvertError;

  var TYPE_MAP = {
    void: 'void', float: 'float', int: 'int', bool: 'bool',
    fixed: 'float', fixed1: 'float', fixed2: 'vec2', fixed3: 'vec3', fixed4: 'vec4',
    fixed2x2: 'mat2', fixed3x3: 'mat3', fixed4x4: 'mat4',
    half: 'float', half1: 'float', half2: 'vec2', half3: 'vec3', half4: 'vec4',
    half2x2: 'mat2', half3x3: 'mat3', half4x4: 'mat4',
    min16float: 'float', min10float: 'float', float1: 'float',
    float2: 'vec2', float3: 'vec3', float4: 'vec4',
    float2x2: 'mat2', float3x3: 'mat3', float4x4: 'mat4',
    int1: 'int', int2: 'ivec2', int3: 'ivec3', int4: 'ivec4',
    uint: 'int', uint1: 'int', uint2: 'ivec2', uint3: 'ivec3', uint4: 'ivec4',
    bool1: 'bool', bool2: 'bvec2', bool3: 'bvec3', bool4: 'bvec4',
    sampler2D: 'sampler2D', samplerCUBE: 'samplerCube'
  };

  var TYPE_KEYS = Object.keys(TYPE_MAP).sort(function (a, b) { return b.length - a.length; });
  var TYPE_RE = new RegExp('\\b(' + TYPE_KEYS.join('|') + ')\\b', 'g');

  var PRELUDE_UNIFORMS = ['uMVP', 'uModel', 'uInvModel', 'uView', 'uProj', 'uVP', 'uNormalMatrix',
    'uCameraPos', '_Time', '_SinTime', '_CosTime', '_WorldSpaceCameraPos', '_WorldSpaceLightPos0',
    '_LightColor0', '_ProjectionParams', '_ScreenParams'];

  var PRELUDE = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    '',
    'uniform mat4 uMVP;',
    'uniform mat4 uModel;',
    'uniform mat4 uInvModel;',
    'uniform mat4 uView;',
    'uniform mat4 uProj;',
    'uniform mat4 uVP;',
    'uniform mat3 uNormalMatrix;',
    'uniform vec3 uCameraPos;',
    'uniform vec4 _Time;',
    'uniform vec4 _SinTime;',
    'uniform vec4 _CosTime;',
    'uniform vec3 _WorldSpaceCameraPos;',
    'uniform vec4 _WorldSpaceLightPos0;',
    'uniform vec4 _LightColor0;',
    'uniform vec4 _ProjectionParams;',
    'uniform vec4 _ScreenParams;',
    '',
    '#define unity_ObjectToWorld uModel',
    '#define unity_WorldToObject uInvModel',
    '#define unity_MatrixVP uVP',
    '#define UNITY_MATRIX_MVP uMVP',
    '#define UNITY_MATRIX_M uModel',
    '#define UNITY_MATRIX_V uView',
    '#define UNITY_MATRIX_P uProj',
    '#define UNITY_MATRIX_VP uVP',
    '#define UNITY_PI 3.14159265359',
    '#define lerp mix',
    '#define frac fract',
    '#define atan2 atan',
    '#define rsqrt inversesqrt',
    '#define fmod mod',
    '',
    'float saturate(float x) { return clamp(x, 0.0, 1.0); }',
    'vec2 saturate(vec2 x) { return clamp(x, 0.0, 1.0); }',
    'vec3 saturate(vec3 x) { return clamp(x, 0.0, 1.0); }',
    'vec4 saturate(vec4 x) { return clamp(x, 0.0, 1.0); }',
    '#ifdef SHADER_LAB_FRAGMENT',
    'void clip(float x) { if (x < 0.0) discard; }',
    'void clip(vec2 x) { if (any(lessThan(x, vec2(0.0)))) discard; }',
    'void clip(vec3 x) { if (any(lessThan(x, vec3(0.0)))) discard; }',
    'void clip(vec4 x) { if (any(lessThan(x, vec4(0.0)))) discard; }',
    '#endif',
    '',
    'vec4 mul(mat4 m, vec4 v) { return m * v; }',
    'vec3 mul(mat3 m, vec3 v) { return m * v; }',
    'vec2 mul(mat2 m, vec2 v) { return m * v; }',
    'mat4 mul(mat4 a, mat4 b) { return a * b; }',
    'vec4 mul(vec4 v, mat4 m) { return v * m; }',
    'float mul(float a, float b) { return a * b; }',
    '',
    'vec4 UnityObjectToClipPos(vec4 p) { return uMVP * p; }',
    'vec4 UnityObjectToClipPos(vec3 p) { return uMVP * vec4(p, 1.0); }',
    'vec4 UnityObjectToHClip(vec3 p) { return uMVP * vec4(p, 1.0); }',
    'vec3 UnityObjectToWorldNormal(vec3 n) { return normalize(uNormalMatrix * n); }',
    'vec3 UnityObjectToWorldDir(vec3 d) { return normalize(mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * d); }',
    'vec3 UnityWorldToObjectDir(vec3 d) { return normalize(mat3(uInvModel[0].xyz, uInvModel[1].xyz, uInvModel[2].xyz) * d); }',
    'vec3 TransformObjectToWorld(vec3 p) { return (uModel * vec4(p, 1.0)).xyz; }',
    'vec3 TransformWorldToView(vec3 p) { return (uView * vec4(p, 1.0)).xyz; }',
    'vec4 TransformWorldToHClip(vec3 p) { return uVP * vec4(p, 1.0); }',
    'vec3 TransformViewToProjection(vec3 p) { return (uProj * vec4(p, 1.0)).xyz; }',
    'vec3 UnityWorldSpaceViewDir(vec3 wp) { return normalize(uCameraPos - wp); }',
    'vec3 WorldSpaceViewDir(vec3 op) { return UnityWorldSpaceViewDir((uModel * vec4(op, 1.0)).xyz); }',
    'vec3 ObjSpaceViewDir(vec3 op) { return uCameraPos - (uModel * vec4(op, 1.0)).xyz; }',
    'vec3 UnityWorldSpaceLightDir(vec3 wp) { return normalize(_WorldSpaceLightPos0.xyz - wp * _WorldSpaceLightPos0.w); }',
    'vec3 WorldSpaceLightDir(vec3 op) { return UnityWorldSpaceLightDir((uModel * vec4(op, 1.0)).xyz); }',
    'vec4 ComputeScreenPos(vec4 pos) { vec4 o = pos * 0.5; o.xy = vec2(o.x, o.y * _ProjectionParams.x) + o.w; o.zw = pos.zw; return o; }',
    'vec3 UnpackNormal(vec4 n) { return n.xyz * 2.0 - 1.0; }',
    'vec3 ShadeSH9(vec4 n) { return vec3(0.0); }',
    'vec3 SafeNormalize(vec3 v) { float l = length(v); return l > 1e-6 ? v / l : vec3(0.0, 0.0, 1.0); }',
    'vec3 Unity_SafeNormalize(vec3 v) { return SafeNormalize(v); }'
  ].join('\n');

  function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function warn(list, msg) { if (list.indexOf(msg) < 0) list.push(msg); }

  function mapType(t) {
    var key = String(t).trim();
    if (!TYPE_MAP[key]) {
      throw new ConvertError('不支持的类型 “' + t + '”',
        '支持 float/fixed/half 的标量与 2/3/4 维向量、int、bool、mat2/3/4、sampler2D、samplerCube。');
    }
    return TYPE_MAP[key];
  }

  function convertTypes(code) {
    return code.replace(TYPE_RE, function (m) { return TYPE_MAP[m]; });
  }

  function splitTop(s, sep) {
    var out = [], depth = 0, cur = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      if (c === sep && depth === 0) { out.push(cur); cur = ''; }
      else cur += c;
    }
    if (cur.trim()) out.push(cur);
    return out;
  }

  function braceMatch(s, open) {
    var depth = 0;
    for (var i = open; i < s.length; i++) {
      var c = s[i];
      if (c === '/' && s[i + 1] === '/') { var nl = s.indexOf('\n', i); if (nl < 0) return -1; i = nl; continue; }
      if (c === '/' && s[i + 1] === '*') { var end = s.indexOf('*/', i + 2); if (end < 0) return -1; i = end + 1; continue; }
      if (c === '"') { i++; while (i < s.length && s[i] !== '"') { if (s[i] === '\\') i++; i++; } continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return i; }
    }
    return -1;
  }

  /* ---------------- ShaderLab ---------------- */

  function parseTuple(raw, n, fallback) {
    var m = /\(([^)]*)\)/.exec(raw);
    if (!m) return fallback.slice();
    var parts = m[1].split(',').map(function (x) { return parseFloat(x.trim()); });
    var out = fallback.slice();
    for (var i = 0; i < n; i++) if (isFinite(parts[i])) out[i] = parts[i];
    return out;
  }

  var COLOR_NAMES = {
    white: [1, 1, 1, 1], black: [0, 0, 0, 1], gray: [0.5, 0.5, 0.5, 1], grey: [0.5, 0.5, 0.5, 1],
    red: [1, 0, 0, 1], green: [0, 1, 0, 1], blue: [0, 0, 1, 1], yellow: [1, 1, 0, 1],
    cyan: [0, 1, 1, 1], magenta: [1, 0, 1, 1], orange: [1, 0.5, 0, 1]
  };

  function parseColor(raw) {
    var key = raw.replace(/[()\s]/g, '').toLowerCase();
    if (COLOR_NAMES[key]) return COLOR_NAMES[key].slice();
    return parseTuple(raw, 4, [1, 1, 1, 1]);
  }

  function parseProperties(src) {
    var props = [];
    var m = /Properties\s*\{/.exec(src);
    if (!m) return props;
    var open = src.indexOf('{', m.index);
    var close = braceMatch(src, open);
    if (close < 0) return props;
    var body = src.slice(open + 1, close);
    var re = /([A-Za-z_]\w*)\s*\(\s*"([^"]*)"\s*,\s*([\s\S]*?)\)\s*=\s*([^\n\r]+)/g, pm;
    while ((pm = re.exec(body))) {
      var name = pm[1], label = pm[2], typeText = pm[3].trim();
      var raw = pm[4].trim().replace(/[{}]/g, '').trim();
      var kind = 'Float', value = [0], texture = null, def = 0;
      if (/^Range/i.test(typeText)) {
        kind = 'Range';
        def = parseFloat(raw);
        if (!isFinite(def)) def = 0;
        value = [def];
      } else if (/^Float/i.test(typeText)) {
        def = parseFloat(raw) || 0; value = [def];
      } else if (/^Int/i.test(typeText)) {
        kind = 'Int'; def = parseInt(raw, 10) || 0; value = [def];
      } else if (/^Color/i.test(typeText)) {
        kind = 'Color'; value = parseColor(raw);
      } else if (/^Vector/i.test(typeText)) {
        kind = 'Vector'; value = parseTuple(raw, 4, [0, 0, 0, 0]);
      } else if (/^2D/i.test(typeText)) {
        kind = '2D'; texture = raw.replace(/"/g, ''); value = null;
      } else if (/^3D/i.test(typeText)) {
        kind = '3D'; texture = raw.replace(/"/g, ''); value = null;
      } else if (/^Cube/i.test(typeText)) {
        kind = 'Cube'; texture = raw.replace(/"/g, ''); value = null;
      } else {
        kind = 'Unsupported';
      }
      props.push({ name: name, label: label, kind: kind, typeText: typeText, value: value, texture: texture, def: def });
    }
    return props;
  }

  function extractCG(src) {
    var re = /CGPROGRAM/g, m, best = null;
    while ((m = re.exec(src))) {
      var end = src.indexOf('ENDCG', m.index);
      if (end < 0) continue;
      var code = src.slice(m.index + 'CGPROGRAM'.length, end);
      if (/#pragma\s+vertex\s+\w+/.test(code) && /#pragma\s+fragment\s+\w+/.test(code)) return code;
      if (best === null) best = code;
    }
    if (best === null) {
      throw new ConvertError('没有找到 CGPROGRAM / ENDCG 代码块',
        '需要一个包含顶点与片元着色器的 Pass，例如：#pragma vertex vert / #pragma fragment frag。');
    }
    return best;
  }

  function structMembers(body) {
    body = body.replace(/\/\*[\s\S]*?\*\//g, '');
    var members = [];
    body.split(';').forEach(function (line) {
      line = line.replace(/\/\/.*$/, '').trim();
      if (!line) return;
      if (/^UNITY_[A-Z0-9_]+$/.test(line)) return;
      var m = /^([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(?::\s*([A-Za-z_]\w*))?$/.exec(line);
      if (!m) {
        throw new ConvertError('无法解析结构体成员：' + line,
          '结构体成员需要写成 “类型 名称 : 语义;”，例如 float4 vertex : POSITION;');
      }
      members.push({ type: m[1], name: m[2], semantic: m[3] || '' });
    });
    return members;
  }

  function findFunction(code, name) {
    var re = new RegExp('\\b([A-Za-z_]\\w*)\\s+' + esc(name) + '\\s*\\(([^)]*)\\)', 'g'), m;
    var bad = { return: 1, else: 1, if: 1, while: 1, for: 1, switch: 1, case: 1, discard: 1 };
    while ((m = re.exec(code))) {
      if (bad[m[1]]) continue;
      return {
        name: name,
        index: m.index,
        length: m[0].length,
        retType: m[1],
        params: splitTop(m[2], ',').map(function (p) {
          p = p.trim();
          if (!p) return null;
          var q = /^(?:(in|out|inout)\s+)?([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(?::\s*([A-Za-z_]\w*))?$/.exec(p);
          if (!q) throw new ConvertError('无法解析函数参数：' + p, '参数请写成 “类型 名称 : 语义” 的形式。');
          return { qual: q[1] || '', type: q[2], name: q[3], semantic: q[4] || '' };
        }).filter(Boolean)
      };
    }
    return null;
  }

  function cutFunction(code, fn) {
    var open = code.indexOf('{', fn.index + fn.length);
    if (open < 0) return code;
    var close = braceMatch(code, open);
    if (close < 0) throw new ConvertError('函数体大括号不匹配：' + code.slice(fn.index, fn.index + 40) + '…', '检查是否有漏写的 }。');
    return code.slice(0, fn.index) + code.slice(close + 1);
  }

  function attrName(sem) {
    if (sem === 'POSITION') return 'a_position';
    if (sem === 'NORMAL') return 'a_normal';
    if (sem === 'TANGENT') return 'a_tangent';
    if (sem === 'COLOR' || /^COLOR\d+$/.test(sem)) return 'a_color';
    var m = /^TEXCOORD(\d+)$/.exec(sem);
    if (m) return parseInt(m[1], 10) === 0 ? 'a_texcoord' : 'a_texcoord' + m[1];
    return null;
  }

  function zeroFor(type) {
    var t = mapType(type);
    if (t === 'float') return '0.0';
    if (t === 'int') return '0';
    if (t === 'bool') return 'false';
    if (/^mat/.test(t)) return t + '(0.0)';
    return t + '(0.0)';
  }

  /* ---------------- stage cleanup ---------------- */

  function addUniformQualifiers(code, names) {
    var lines = code.split('\n'), depth = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var clean = line.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '');
      if (depth === 0 && !/\buniform\b/.test(clean)) {
        var m = /^([ \t]*)(?:(?:lowp|mediump|highp)\s+)?(sampler2D|samplerCube|mat[234]|vec[234]|float|int|bool|ivec[234]|bvec[234])\s+([A-Za-z_]\w*)\s*;/.exec(clean);
        if (m) {
          var name = m[3];
          if (names[name] || /^sampler/.test(m[2]) || /_ST$|_TexelSize$/.test(name)) {
            lines[i] = m[1] + 'uniform ' + line.trim();
          }
        }
      }
      depth += (clean.match(/\{/g) || []).length - (clean.match(/\}/g) || []).length;
      if (depth < 0) depth = 0;
    }
    return lines.join('\n');
  }

  function cleanStage(code, warnings, uniformNames) {
    code = code.replace(/\bTRANSFORM_TEX\s*\(\s*([^,()]+?)\s*,\s*([A-Za-z_]\w*)\s*\)/g, function (m, tex, t) {
      warn(warnings, 'TRANSFORM_TEX 已展开为 * _ST.xy + _ST.zw。');
      return '(' + tex + ' * ' + t + '_ST.xy + ' + t + '_ST.zw)';
    });
    code = code.replace(/\btex2Dlod\s*\(\s*([^,]+),\s*([^)]+)\)/g, function (m, s, uv) {
      warn(warnings, 'tex2Dlod 已降级为 texture2D，LOD 参数被忽略。');
      return 'texture2D(' + s + ', (' + uv + ').xy)';
    });
    code = code.replace(/\btex2Dbias\s*\(\s*([^,]+),\s*([^)]+)\)/g, function (m, s, uv) {
      warn(warnings, 'tex2Dbias 已降级为 texture2D，bias 参数被忽略。');
      return 'texture2D(' + s + ', (' + uv + ').xy)';
    });
    code = code.replace(/\btexCUBE\b/g, 'textureCube');
    code = code.replace(/\btex2D\b/g, 'texture2D');
    code = code.replace(/\bUNITY_SAMPLE_TEX2D\s*\(\s*([^,]+),\s*([^)]+)\)/g, 'texture2D($1, $2)');
    code = code.replace(/\bUNITY_DECLARE_TEX2D\s*\(\s*([A-Za-z_]\w*)\s*\)/g, 'uniform sampler2D $1;');
    code = code.replace(/\bTEXTURE2D\s*\(\s*([A-Za-z_]\w*)\s*\)/g, 'sampler2D $1');
    code = code.replace(/\bSAMPLER\s*\(\s*[A-Za-z_]\w*\s*\)/g, '');

    code = code.replace(/\bUNITY_(?:SETUP_INSTANCE_ID|TRANSFER_INSTANCE_ID|INITIALIZE_VERTEX_OUTPUT_STEREO|SETUP_STEREO_EYE_INDEX_POST_VERTEX|INITIALIZE_OUTPUT)\s*\([^;]*\)\s*;?/g, function () {
      warn(warnings, '已移除 Unity 的实例化/立体渲染辅助宏（WebGL 预览不需要）。');
      return '';
    });
    code = code.replace(/\bUNITY_(?:TRANSFER_FOG|APPLY_FOG|APPLY_FOG_COLOR)\s*\([^;]*\)\s*;?/g, function () {
      warn(warnings, '已移除雾效宏（预览中不计算雾）。');
      return '';
    });
    code = code.replace(/\bUNITY_FOG_COORDS\s*\([^)]*\)/g, '');
    code = code.replace(/\[(?:unroll|loop|branch|forcecase|call|fastopt)\]/gi, '');
    code = code.replace(/\bstatic\s+const\b/g, 'const').replace(/\bstatic\b/g, '')
      .replace(/\binline\b/g, '').replace(/\bprecise\b/g, '').replace(/\bnointerpolation\b/g, '')
      .replace(/\bshared\b/g, '');

    // Drop duplicate declarations of built-in uniforms (they come from the prelude).
    PRELUDE_UNIFORMS.forEach(function (name) {
      var re = new RegExp('^[ \\t]*uniform\\s+\\w+\\s+' + esc(name) + '\\s*;\\s*$', 'gm');
      if (re.test(code)) {
        code = code.replace(re, '');
        warn(warnings, '已移除重复声明的内置 uniform “' + name + '”，统一使用预览器提供的值。');
      }
    });

    code = convertTypes(code);
    code = addUniformQualifiers(code, uniformNames || {});
    code = code.replace(/[ \t]+$/gm, '').replace(/\n{4,}/g, '\n\n\n');
    return code;
  }

  /* ---------------- main ---------------- */

  function convert(source) {
    if (!source || !source.trim()) {
      throw new ConvertError('编辑器里没有代码', '先粘贴一段 Unity Shader，或从右上角选择一个示例。');
    }
    var src = String(source).replace(/\r\n?/g, '\n');
    var warnings = [];

    if (/#pragma\s+surface/.test(src)) {
      throw new ConvertError('不支持 Surface Shader（#pragma surface）',
        '请改成 vertex / fragment 写法：在 Pass 中声明 #pragma vertex vert 和 #pragma fragment frag。');
    }
    if (/#pragma\s+kernel/.test(src)) {
      throw new ConvertError('不支持 Compute Shader（#pragma kernel）', '本工具只转换渲染用的 vertex / fragment 着色器。');
    }
    if (/\b(Texture2D|SamplerState|StructuredBuffer|RWStructuredBuffer|ByteAddressBuffer)\b/.test(src)) {
      throw new ConvertError('检测到 DX 风格的资源类型声明',
        '请把 Texture2D/SamplerState 改成 sampler2D，并用 tex2D() 采样。');
    }
    if (/\b(?:fixed|float|half|int)[1-4]x[1-4]\b/.test(src) && !/\b(?:fixed|float|half|int)[1-4]x\1\b/.test(src)) {
      // Non-square matrices are rejected by mapType later with a clear message.
    }

    var props = parseProperties(src);
    var nameMatch = /Shader\s+"([^"]+)"/.exec(src);
    var shaderName = nameMatch ? nameMatch[1] : 'Custom/Untitled';

    var cg = extractCG(src);
    var vm = /#pragma\s+vertex\s+(\w+)/.exec(cg);
    var fm = /#pragma\s+fragment\s+(\w+)/.exec(cg);
    if (!vm || !fm) {
      throw new ConvertError('缺少 #pragma vertex / #pragma fragment',
        '两者都必须存在，例如：#pragma vertex vert 和 #pragma fragment frag。');
    }
    var vertName = vm[1], fragName = fm[1];

    var code = cg.replace(/^[ \t]*#(pragma|include|line)\b[^\n]*$/gm, function (line, kind) {
      if (kind === 'include') {
        var inc = /"([^"]*)"/.exec(line);
        warn(warnings, '已忽略 #include "' + (inc ? inc[1] : '?') + '"，对应功能由转换器内置函数近似提供。');
      }
      return '';
    });
    var defines = [];
    code = code.replace(/^[ \t]*#define\b[^\n]*$/gm, function (line) {
      defines.push(convertTypes(line.trim()));
      return '';
    });

    var builtinStructs = {
      appdata_base: [
        { type: 'float4', name: 'vertex', semantic: 'POSITION' },
        { type: 'float3', name: 'normal', semantic: 'NORMAL' },
        { type: 'float4', name: 'texcoord', semantic: 'TEXCOORD0' }
      ],
      appdata_tan: [
        { type: 'float4', name: 'vertex', semantic: 'POSITION' },
        { type: 'float4', name: 'tangent', semantic: 'TANGENT' },
        { type: 'float3', name: 'normal', semantic: 'NORMAL' },
        { type: 'float4', name: 'texcoord', semantic: 'TEXCOORD0' }
      ],
      appdata_full: [
        { type: 'float4', name: 'vertex', semantic: 'POSITION' },
        { type: 'float4', name: 'tangent', semantic: 'TANGENT' },
        { type: 'float3', name: 'normal', semantic: 'NORMAL' },
        { type: 'float4', name: 'texcoord', semantic: 'TEXCOORD0' },
        { type: 'float4', name: 'texcoord1', semantic: 'TEXCOORD1' },
        { type: 'float4', name: 'texcoord2', semantic: 'TEXCOORD2' },
        { type: 'float4', name: 'color', semantic: 'COLOR' }
      ]
    };

    var structs = {};
    var structRe = /\bstruct\s+(\w+)\s*\{([\s\S]*?)\}\s*;/g, sm, rebuilt = '', last = 0;
    while ((sm = structRe.exec(code))) {
      structs[sm[1]] = structMembers(sm[2]);
      rebuilt += code.slice(last, sm.index);
      last = sm.index + sm[0].length;
    }
    rebuilt += code.slice(last);
    code = rebuilt;

    Object.keys(builtinStructs).forEach(function (k) {
      if (!structs[k]) structs[k] = builtinStructs[k];
    });

    // Strip all HLSL semantics (params and return types) now that structs are gone.
    code = code.replace(/\s*:\s*(?:SV_[A-Za-z0-9_]+|COLOR\d*|TEXCOORD\d*)\b/g, '');
    code = code.replace(/\)\s*:\s*(?:SV_\w+|COLOR\d*|TEXCOORD\d*)/g, ')');

    var vertFn = findFunction(code, vertName);
    var fragFn = findFunction(code, fragName);
    if (!vertFn) throw new ConvertError('找不到顶点函数 ' + vertName + '()', '检查 #pragma vertex 的名字是否与函数名一致。');
    if (!fragFn) throw new ConvertError('找不到片元函数 ' + fragName + '()', '检查 #pragma fragment 的名字是否与函数名一致。');

    if (vertFn.params.length !== 1) {
      throw new ConvertError('顶点函数需要且只能有一个 struct 输入参数',
        '例如：struct appdata { float4 vertex : POSITION; }; v2f vert(appdata v) { ... }');
    }
    var vp = vertFn.params[0];
    if (vp.semantic) {
      throw new ConvertError('顶点参数使用了行内语义：' + vp.name + ' : ' + vp.semantic,
        '请改用 struct 形式的输入：struct appdata { float4 vertex : POSITION; ... };');
    }
    if (!structs[vp.type]) {
      throw new ConvertError('顶点输入类型 “' + vp.type + '” 不是已定义的 struct',
        '需要一个 struct，例如 struct appdata { float4 vertex : POSITION; float3 normal : NORMAL; };');
    }
    var vertIn = { type: vp.type, name: vp.name, members: structs[vp.type] };

    var vertOut = null;
    if (structs[vertFn.retType]) {
      vertOut = { type: vertFn.retType, members: structs[vertFn.retType] };
    } else if (mapType(vertFn.retType) !== 'vec4') {
      throw new ConvertError('顶点函数必须返回 float4 或包含 SV_POSITION 的 struct，当前返回 “' + vertFn.retType + '”',
        '常见写法：struct v2f { float4 pos : SV_POSITION; ... };');
    }

    if (!vertIn.members.some(function (m) { return m.semantic === 'POSITION'; })) {
      throw new ConvertError('顶点输入结构体缺少 POSITION 语义成员',
        '例如：float4 vertex : POSITION;');
    }

    var posMember = null;
    if (vertOut) {
      vertOut.members.forEach(function (m) { if (m.semantic === 'SV_POSITION') posMember = m.name; });
      if (!posMember) {
        throw new ConvertError('顶点输出结构体缺少 SV_POSITION 成员',
          '例如：struct v2f { float4 pos : SV_POSITION; float2 uv : TEXCOORD0; };');
      }
    }

    var fragIn = null;
    for (var i = 0; i < fragFn.params.length; i++) {
      var fp = fragFn.params[i];
      if (fp.qual === 'out' || fp.qual === 'inout') continue;
      if (structs[fp.type]) { fragIn = { type: fp.type, name: fp.name, members: structs[fp.type] }; break; }
      if (fp.semantic) {
        throw new ConvertError('片元参数使用了行内语义：' + fp.name + ' : ' + fp.semantic,
          '请改用 struct 形式的输入：fixed4 frag(v2f i) : SV_Target。');
      }
    }
    if (fragIn && !vertOut) {
      throw new ConvertError('片元函数需要 struct 输入，但顶点函数只返回了 float4',
        '请让顶点函数返回 struct v2f，把 uv/normal 等通过 struct 传递。');
    }
    if (!fragIn && vertOut) warn(warnings, '片元函数没有 struct 输入，顶点输出中的插值数据不会被使用。');

    var varyings = [], usedNames = {};
    if (vertOut) {
      vertOut.members.forEach(function (m) {
        if (m.semantic === 'SV_POSITION' || m.semantic === posMember) return;
        var vname = 'v_' + m.name;
        while (usedNames[vname]) vname += '_';
        usedNames[vname] = true;
        varyings.push({ glslName: vname, member: m.name, type: mapType(m.type) });
      });
      if (varyings.length > 8) {
        warn(warnings, '插值变量有 ' + varyings.length + ' 个，超过 WebGL1 保证的 8 个 vec4 上限，部分设备会编译失败。');
      }
    }

    var attrs = [], attrSeen = {}, skippedIn = {};
    vertIn.members.forEach(function (m) {
      var a = attrName(m.semantic);
      if (!a) { skippedIn[m.name] = true; return; }
      if (!attrSeen[a]) { attrSeen[a] = true; attrs.push({ name: a, type: mapType(m.type) }); }
    });
    Object.keys(skippedIn).forEach(function (n) {
      warn(warnings, '顶点成员 “' + n + '” 的语义 WebGL 预览无法提供，将使用 0 填充。');
    });

    // Names that must become uniforms: properties plus Unity's auto _ST/_TexelSize values.
    var uniformNames = {};
    props.forEach(function (p) {
      uniformNames[p.name] = true;
      if (p.kind === '2D' || p.kind === 'Cube') {
        uniformNames[p.name + '_ST'] = true;
        uniformNames[p.name + '_TexelSize'] = true;
      }
    });
    (code.match(/\b[A-Za-z_]\w*_(?:ST|TexelSize)\b/g) || []).forEach(function (n) { uniformNames[n] = true; });

    // Split stages first: indexes from findFunction must not go stale.
    var vertBody = cleanStage(cutFunction(code, fragFn), warnings, uniformNames);
    var fragBody = cleanStage(cutFunction(code, vertFn), warnings, uniformNames);

    var both = vertBody + '\n' + fragBody;
    var leftovers = both.match(/\b(?:UNITY_[A-Z0-9_]+|unity_[A-Za-z0-9_]+)\b/g) || [];
    var knownIds = /^(?:unity_ObjectToWorld|unity_WorldToObject|unity_MatrixVP|UNITY_MATRIX_[MVP]+|UNITY_PI|UNITY_SAMPLE_TEX2D|UNITY_DECLARE_TEX2D)$/;
    leftovers.forEach(function (n) {
      if (!knownIds.test(n)) warn(warnings, '未识别的 Unity 标识符 “' + n + '”，如果编译失败请手动替换。');
    });

    var header = PRELUDE;
    if (defines.length) header += '\n' + defines.join('\n');

    var structSrc = Object.keys(structs).map(function (name) {
      return 'struct ' + name + ' {\n' + structs[name].map(function (m) {
        return '  ' + mapType(m.type) + ' ' + m.name + ';';
      }).join('\n') + '\n};';
    }).join('\n\n');

    var varyingSrc = varyings.map(function (v) { return 'varying mediump ' + v.type + ' ' + v.glslName + ';'; }).join('\n');
    var attrSrc = attrs.map(function (a) { return 'attribute ' + a.type + ' ' + a.name + ';'; }).join('\n');

    // Auto uniforms (_ST / _TexelSize), matching Unity's auto-provided values.
    var autoUniforms = [], known = {};
    var declRe = /\buniform\s+\w+\s+([A-Za-z_]\w*)\s*;/g, dm;
    while ((dm = declRe.exec(both))) known[dm[1]] = true;
    (both.match(/\b[A-Za-z_]\w*_ST\b/g) || []).forEach(function (tok) {
      if (!known[tok]) { known[tok] = true; autoUniforms.push({ name: tok, type: 'vec4', value: [1, 1, 0, 0] }); }
    });
    (both.match(/\b[A-Za-z_]\w*_TexelSize\b/g) || []).forEach(function (tok) {
      if (!known[tok]) { known[tok] = true; autoUniforms.push({ name: tok, type: 'vec4', value: [1 / 64, 1 / 64, 64, 64] }); }
    });
    if (autoUniforms.length) {
      header += '\n' + autoUniforms.map(function (u) { return 'uniform ' + u.type + ' ' + u.name + ';'; }).join('\n');
    }

    var vsSrc = header + '\n\n' + structSrc + '\n\n' + varyingSrc + '\n' + attrSrc + '\n\n' + vertBody + '\n\n' +
      buildVertexWrapper(vertFn, vertIn, vertOut, posMember, varyings) + '\n';
    var fsSrc = header + '\n\n' + structSrc + '\n\n' + varyingSrc + '\n\n' + fragBody + '\n\n' +
      buildFragmentWrapper(fragFn, fragIn, varyings) + '\n';

    if (/\b(?:ddx|ddy)\b/.test(fsSrc)) {
      fsSrc = fsSrc.replace(/\bddx\b/g, 'dFdx').replace(/\bddy\b/g, 'dFdy');
      warn(warnings, 'ddx/ddy 已映射为 dFdx/dFdy，需要 GL_OES_standard_derivatives 支持。');
    }
    if (/\b(?:dFdx|dFdy|fwidth)\b/.test(fsSrc)) {
      fsSrc = '#extension GL_OES_standard_derivatives : enable\n' + fsSrc;
    }
    fsSrc = '#define SHADER_LAB_FRAGMENT 1\n' + fsSrc;

    // Uniforms for the renderer.
    var uniforms = [], uSeen = {};
    var uRe = /\buniform\s+(?:(?:lowp|mediump|highp)\s+)?([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(?:\[\s*(\d+)\s*\])?\s*;/g, um;
    while ((um = uRe.exec(both))) {
      if (uSeen[um[2]]) continue;
      uSeen[um[2]] = true;
      var prop = null;
      for (var pi = 0; pi < props.length; pi++) if (props[pi].name === um[2]) { prop = props[pi]; break; }
      if (um[3]) warn(warnings, 'uniform 数组 “' + um[2] + '” 未在预览器中赋值，将保持 0。');
      var value = prop && prop.value ? prop.value : null;
      if (!value) {
        if (/_ST$/.test(um[2])) value = [1, 1, 0, 0];
        else if (/_TexelSize$/.test(um[2])) value = [1 / 64, 1 / 64, 64, 64];
      }
      uniforms.push({
        name: um[2], type: um[1], array: um[3] ? parseInt(um[3], 10) : 0,
        value: value,
        property: prop ? prop.kind : null
      });
    }
    autoUniforms.forEach(function (u) {
      if (uSeen[u.name]) return;
      uSeen[u.name] = true;
      uniforms.push({ name: u.name, type: u.type, value: u.value, array: 0, property: null });
    });

    if (!uniforms.some(function (u) { return u.type === 'sampler2D'; }) && /\btexture2D\s*\(/.test(both)) {
      warn(warnings, '代码调用了 texture2D()，但没有声明 sampler2D 类型的 uniform。');
    }

    return {
      shaderName: shaderName,
      glsl: { vertex: vsSrc, fragment: fsSrc },
      uniforms: uniforms,
      attributes: attrs,
      varyings: varyings,
      warnings: warnings,
      meta: { vertName: vertName, fragName: fragName, props: props, structs: Object.keys(structs) }
    };
  }

  function buildVertexWrapper(vertFn, vertIn, vertOut, posMember, varyings) {
    var L = ['void main() {'];
    L.push('  ' + vertIn.type + ' vIn;');
    vertIn.members.forEach(function (m) {
      var a = attrName(m.semantic);
      if (a) L.push('  vIn.' + m.name + ' = ' + a + ';');
      else L.push('  vIn.' + m.name + ' = ' + zeroFor(m.type) + ';');
    });
    if (vertOut) {
      L.push('  ' + vertOut.type + ' vOut = ' + vertFn.name + '(vIn);');
      L.push('  gl_Position = vOut.' + posMember + ';');
      varyings.forEach(function (v) { L.push('  ' + v.glslName + ' = vOut.' + v.member + ';'); });
    } else {
      L.push('  gl_Position = ' + vertFn.name + '(vIn);');
    }
    L.push('}');
    return L.join('\n');
  }

  function buildFragmentWrapper(fragFn, fragIn, varyings) {
    var L = ['void main() {'];
    if (fragIn) {
      L.push('  ' + fragIn.type + ' fIn;');
      fragIn.members.forEach(function (m) {
        if (m.semantic === 'SV_POSITION') { L.push('  fIn.' + m.name + ' = gl_FragCoord;'); return; }
        var v = null;
        for (var i = 0; i < varyings.length; i++) if (varyings[i].member === m.name) { v = varyings[i]; break; }
        if (!v) {
          throw new ConvertError('片元输入成员 “' + m.name + '” 在顶点输出结构体中不存在',
            '请让 vert 返回的 struct 与 frag 接收的 struct 成员一一对应。');
        }
        L.push('  fIn.' + m.name + ' = ' + v.glslName + ';');
      });
    }
    var args = [], outName = null;
    fragFn.params.forEach(function (p) {
      if (p.qual === 'out' || p.qual === 'inout') {
        L.push('  ' + mapType(p.type) + ' ' + p.name + ';');
        if (!outName) outName = p.name;
        args.push(p.name);
        return;
      }
      if (fragIn && p.name === fragIn.name) { args.push('fIn'); return; }
      throw new ConvertError('不支持的片元参数：' + p.name,
        '片元函数只支持一个 struct 输入参数，以及可选的 SV_Target out 参数。');
    });
    var ret = mapType(fragFn.retType);
    if (ret === 'void') {
      if (!outName) {
        throw new ConvertError('片元函数 ' + fragFn.name + '() 没有返回值也没有 SV_Target 输出参数',
          '请返回 float4，例如：fixed4 frag(v2f i) : SV_Target { ... }。');
      }
      L.push('  ' + fragFn.name + '(' + args.join(', ') + ');');
      L.push('  gl_FragColor = ' + outName + ';');
    } else {
      L.push('  gl_FragColor = ' + fragFn.name + '(' + args.join(', ') + ');');
    }
    L.push('}');
    return L.join('\n');
  }

  root.ShaderConverter = { convert: convert, ConvertError: ConvertError, PRELUDE: PRELUDE };
})(typeof window !== 'undefined' ? window : globalThis);