/* Minimal WebGL1 preview renderer: orbit camera, OBJ mesh, shader compile with diagnostics. */
(function (root) {
  'use strict';

  var ATTR_NAMES = ['a_position', 'a_normal', 'a_texcoord', 'a_texcoord1', 'a_texcoord2', 'a_tangent', 'a_color'];

  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

  function mat4Mul(a, b) {
    var o = new Float32Array(16);
    for (var c = 0; c < 4; c++) {
      for (var r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }

  function perspective(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0
    ]);
  }

  function lookAt(eye, center, up) {
    var z = norm(sub3(eye, center));
    var x = norm(cross(up, z));
    var y = cross(z, x);
    return new Float32Array([
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -dot(x, eye), -dot(y, eye), -dot(z, eye), 1
    ]);
  }

  function identity() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }

  /* ---------- OBJ ---------- */

  function parseOBJ(text) {
    var pos = [], nrm = [], uv = [], map = new Map();
    var P = [], N = [], T = [], I = [];
    var lines = text.split(/\r?\n/);
    for (var li = 0; li < lines.length; li++) {
      var s = lines[li].trim();
      if (!s || s.charAt(0) === '#') continue;
      var parts = s.split(/\s+/);
      if (parts[0] === 'v') {
        pos.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
      } else if (parts[0] === 'vn') {
        nrm.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
      } else if (parts[0] === 'vt') {
        uv.push(parseFloat(parts[1]), parseFloat(parts[2]));
      } else if (parts[0] === 'f') {
        var idx = [];
        for (var k = 1; k < parts.length; k++) {
          var bits = parts[k].split('/');
          var vi = parseInt(bits[0], 10);
          if (!isFinite(vi)) continue;
          vi = vi < 0 ? pos.length / 3 + vi : vi - 1;
          var ti = bits[1] ? parseInt(bits[1], 10) : -1;
          ti = ti > 0 ? ti - 1 : (ti < 0 && bits[1] && bits[1] !== '' ? uv.length / 2 + ti : -1);
          var ni = bits[2] ? parseInt(bits[2], 10) : -1;
          ni = ni > 0 ? ni - 1 : (ni < 0 && bits[2] ? nrm.length / 3 + ni : -1);
          var key = vi + '/' + ti + '/' + ni;
          var got = map.get(key);
          if (got === undefined) {
            got = P.length / 3;
            map.set(key, got);
            P.push(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]);
            if (ni >= 0) N.push(nrm[ni * 3] || 0, nrm[ni * 3 + 1] || 0, nrm[ni * 3 + 2] || 0);
            else N.push(0, 0, 0);
            if (ti >= 0) T.push(uv[ti * 2] || 0, uv[ti * 2 + 1] || 0);
            else T.push(0, 0);
          }
          idx.push(got);
        }
        for (var f = 1; f + 1 < idx.length; f++) I.push(idx[0], idx[f], idx[f + 1]);
      }
    }
    if (!P.length || !I.length) throw new Error('OBJ 文件为空或没有三角面');
    if (P.length / 3 > 65535) throw new Error('模型顶点数超过 65535，WebGL1 索引缓冲不支持');

    if (!nrm.length) {
      N = new Array(P.length).fill(0);
      for (var t = 0; t < I.length; t += 3) {
        var a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
        var e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
        var e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
        var n = cross(e1, e2);
        for (var v = 0; v < 3; v++) {
          N[a + v] += n[v]; N[b + v] += n[v]; N[c + v] += n[v];
        }
      }
      for (var i = 0; i < N.length; i += 3) {
        var l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
        N[i] /= l; N[i + 1] /= l; N[i + 2] /= l;
      }
    }

    // Center + scale to a unit-ish sphere for consistent framing.
    var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (var p = 0; p < P.length; p += 3) {
      for (var k2 = 0; k2 < 3; k2++) {
        if (P[p + k2] < mn[k2]) mn[k2] = P[p + k2];
        if (P[p + k2] > mx[k2]) mx[k2] = P[p + k2];
      }
    }
    var center = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    var radius = 0;
    for (var q = 0; q < P.length; q += 3) {
      var d = Math.hypot(P[q] - center[0], P[q + 1] - center[1], P[q + 2] - center[2]);
      if (d > radius) radius = d;
    }
    var scale = radius > 0 ? 1 / radius : 1;
    for (var r = 0; r < P.length; r += 3) {
      P[r] = (P[r] - center[0]) * scale;
      P[r + 1] = (P[r + 1] - center[1]) * scale;
      P[r + 2] = (P[r + 2] - center[2]) * scale;
    }

    return {
      positions: new Float32Array(P),
      normals: new Float32Array(N),
      uvs: new Float32Array(T),
      indices: new Uint16Array(I),
      count: I.length
    };
  }

  /* ---------- viewer ---------- */

  function createViewer(canvas, opts) {
    opts = opts || {};
    var onError = opts.onError || function () {};
    var gl = canvas.getContext('webgl', {
      alpha: true, antialias: true, premultipliedAlpha: true, depth: true,
      preserveDrawingBuffer: false, powerPreference: 'low-power'
    });
    if (!gl) throw new Error('当前浏览器/设备无法创建 WebGL 上下文');

    var program = null, locs = {}, attribs = [], shaderInfo = null, lastShader = null;
    var buffers = {}, mesh = null, lastMesh = null, tex2d = null, texCube = null;
    var animate = false, needsDraw = true, contextLost = false;
    var yaw = 0.65, pitch = 0.28, dist = 3.25;
    var startTime = performance.now();
    var dpr = 1;

    function compileStage(type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        var log = gl.getShaderInfoLog(sh) || '未知编译错误';
        gl.deleteShader(sh);
        var err = new Error(log.trim());
        err.stage = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
        err.log = log;
        err.src = src;
        throw err;
      }
      return sh;
    }

    function makeChecker() {
      var S = 64, data = new Uint8Array(S * S * 4);
      for (var y = 0; y < S; y++) {
        for (var x = 0; x < S; x++) {
          var i = (y * S + x) * 4;
          var cell = ((x >> 4) + (y >> 4)) & 1;
          var grid = (x % 16 === 0 || y % 16 === 0) ? 30 : 0;
          data[i] = (cell ? 92 : 58) + grid;
          data[i + 1] = (cell ? 112 : 68) + grid;
          data[i + 2] = (cell ? 150 : 96) + grid;
          data[i + 3] = 255;
        }
      }
      var tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      return tex;
    }

    function makeCube() {
      var tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
      for (var f = 0; f < 6; f++) {
        var px = new Uint8Array([38, 46, 66, 255]);
        gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
      }
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return tex;
    }

    function initResources() {
      tex2d = makeChecker();
      texCube = makeCube();
    }

    function build(vsSrc, fsSrc) {
      var vs = compileStage(gl.VERTEX_SHADER, vsSrc);
      var fs;
      try {
        fs = compileStage(gl.FRAGMENT_SHADER, fsSrc);
      } catch (e) {
        gl.deleteShader(vs);
        throw e;
      }
      var p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      ATTR_NAMES.forEach(function (n, i) { gl.bindAttribLocation(p, i, n); });
      gl.linkProgram(p);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        var log = gl.getProgramInfoLog(p) || '';
        gl.deleteProgram(p);
        var err = new Error(log.trim());
        err.stage = 'link';
        err.log = log;
        throw err;
      }

      var attrList = [], seen = {};
      var are = /attribute\s+(\w+)\s+(\w+)\s*;/g, am;
      while ((am = are.exec(vsSrc))) { if (!seen[am[2]]) { seen[am[2]] = true; attrList.push(am[2]); } }

      var newLocs = {};
      ATTR_NAMES.forEach(function (n) {
        var l = gl.getAttribLocation(p, n);
        if (l >= 0) newLocs[n] = l;
      });
      var names = ['uMVP', 'uModel', 'uInvModel', 'uView', 'uProj', 'uVP', 'uNormalMatrix', 'uCameraPos',
        '_Time', '_SinTime', '_CosTime', '_WorldSpaceCameraPos', '_WorldSpaceLightPos0', '_LightColor0',
        '_ProjectionParams', '_ScreenParams'];
      (shaderInfo ? shaderInfo.uniforms : []).forEach(function (u) { names.push(u.name); });
      names.forEach(function (n) { newLocs[n] = gl.getUniformLocation(p, n); });

      if (program) gl.deleteProgram(program);
      program = p;
      locs = newLocs;
      attribs = attrList;
      needsDraw = true;
    }

    function setShader(info) {
      lastShader = info;
      shaderInfo = info;
      build(info.glsl.vertex, info.glsl.fragment);
      animate = /\b_Time\b|_SinTime\b|_CosTime\b|unity_DeltaTime\b/.test(info.glsl.vertex + info.glsl.fragment);
      needsDraw = true;
    }

    function uploadMesh(m) {
      var b = {};
      function mk(data, size) {
        var buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        return { buf: buf, size: size };
      }
      b.a_position = mk(m.positions, 3);
      b.a_normal = mk(m.normals, 3);
      if (m.uvs.length) {
        b.a_texcoord = mk(m.uvs, 2);
        b.a_texcoord1 = mk(m.uvs, 2);
        b.a_texcoord2 = mk(m.uvs, 2);
      }
      var ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW);
      Object.keys(buffers).forEach(function (k) { gl.deleteBuffer(buffers[k].buf); });
      buffers = b;
      buffers.__index = { buf: ib };
      mesh = m;
      needsDraw = true;
    }

    function setMesh(m) {
      lastMesh = m;
      uploadMesh(m);
    }

    function setBuiltIns(mvp, eye) {
      var t = (performance.now() - startTime) / 1000;
      if (locs.uMVP) gl.uniformMatrix4fv(locs.uMVP, false, mvp);
      if (locs.uModel) gl.uniformMatrix4fv(locs.uModel, false, identity());
      if (locs.uInvModel) gl.uniformMatrix4fv(locs.uInvModel, false, identity());
      if (locs.uVP) gl.uniformMatrix4fv(locs.uVP, false, mvp);
      if (locs.uNormalMatrix) gl.uniformMatrix3fv(locs.uNormalMatrix, false, new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));
      if (locs.uCameraPos) gl.uniform3fv(locs.uCameraPos, eye);
      if (locs._WorldSpaceCameraPos) gl.uniform3fv(locs._WorldSpaceCameraPos, eye);
      if (locs._Time) gl.uniform4f(locs._Time, t / 20, t, t * 2, t * 3);
      if (locs._SinTime) gl.uniform4f(locs._SinTime, Math.sin(t / 8), Math.sin(t / 4), Math.sin(t / 2), Math.sin(t));
      if (locs._CosTime) gl.uniform4f(locs._CosTime, Math.cos(t / 8), Math.cos(t / 4), Math.cos(t / 2), Math.cos(t));
      if (locs._WorldSpaceLightPos0) gl.uniform4f(locs._WorldSpaceLightPos0, 0.45, 0.8, 0.5, 0);
      if (locs._LightColor0) gl.uniform4f(locs._LightColor0, 1, 0.98, 0.95, 1);
      if (locs._ProjectionParams) gl.uniform4f(locs._ProjectionParams, 1, 0.1, 100, 0.01);
      if (locs._ScreenParams) gl.uniform4f(locs._ScreenParams, canvas.width, canvas.height, 1 / canvas.width, 1 / canvas.height);
    }

    function applyUserUniforms() {
      if (!shaderInfo) return;
      shaderInfo.uniforms.forEach(function (u) {
        var loc = locs[u.name];
        if (!loc) return;
        var v = u.value;
        if (u.array) return; // arrays are not exposed by the preview UI
        switch (u.type) {
          case 'float': gl.uniform1f(loc, v ? v[0] : 0); break;
          case 'int':
          case 'bool': gl.uniform1i(loc, v ? Math.round(v[0]) : 0); break;
          case 'vec2': gl.uniform2f(loc, v ? v[0] : 0, v ? v[1] : 0); break;
          case 'vec3': gl.uniform3f(loc, v ? v[0] : 0, v ? v[1] : 0, v ? v[2] : 0); break;
          case 'vec4': gl.uniform4f(loc, v ? v[0] : 0, v ? v[1] : 0, v ? v[2] : 0, v ? v[3] : 1); break;
          case 'mat4': gl.uniformMatrix4fv(loc, false, identity()); break;
          case 'mat3': gl.uniformMatrix3fv(loc, false, new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1])); break;
          case 'sampler2D':
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, tex2d);
            gl.uniform1i(loc, 0);
            break;
          case 'samplerCube':
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_CUBE_MAP, texCube);
            gl.uniform1i(loc, 1);
            break;
          default: break;
        }
      });
    }

    function resize() {
      var w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      var h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        needsDraw = true;
      }
    }

    function draw() {
      if (contextLost || !program || !mesh) return;
      resize();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);

      var cp = Math.cos(pitch);
      var eye = [dist * cp * Math.sin(yaw), dist * Math.sin(pitch), dist * cp * Math.cos(yaw)];
      var view = lookAt(eye, [0, 0, 0], [0, 1, 0]);
      var proj = perspective(42 * Math.PI / 180, canvas.width / canvas.height, 0.05, 100);
      var mvp = mat4Mul(proj, view);

      gl.useProgram(program);
      setBuiltIns(mvp, eye);
      applyUserUniforms();

      attribs.forEach(function (name) {
        var loc = locs[name];
        if (loc === undefined || loc < 0) return;
        var b = buffers[name];
        if (!b) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, b.size, gl.FLOAT, false, 0, 0);
      });
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.__index.buf);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
    }

    function frame() {
      requestAnimationFrame(frame);
      if (contextLost) return;
      if (!animate && !needsDraw) return;
      needsDraw = false;
      draw();
    }

    /* interaction */
    function fit() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      needsDraw = true;
    }
    fit();
    if (window.ResizeObserver) new ResizeObserver(function () { needsDraw = true; }).observe(canvas);
    else window.addEventListener('resize', fit);
    window.addEventListener('resize', fit);

    var dragging = false, lastX = 0, lastY = 0;
    canvas.addEventListener('pointerdown', function (e) {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      yaw -= (e.clientX - lastX) * 0.008;
      pitch = Math.max(-1.45, Math.min(1.45, pitch + (e.clientY - lastY) * 0.008));
      lastX = e.clientX; lastY = e.clientY;
      needsDraw = true;
    });
    function stopDrag(e) {
      dragging = false;
      if (e.pointerId !== undefined && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    }
    canvas.addEventListener('pointerup', stopDrag);
    canvas.addEventListener('pointercancel', stopDrag);
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      dist = Math.max(1.7, Math.min(8, dist * Math.exp(e.deltaY * 0.0012)));
      needsDraw = true;
    }, { passive: false });
    canvas.addEventListener('dblclick', function () {
      yaw = 0.65; pitch = 0.28; dist = 3.25; needsDraw = true;
    });

    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      contextLost = true;
      program = null;
      onError('WebGL 上下文丢失，正在等待恢复…');
    });
    canvas.addEventListener('webglcontextrestored', function () {
      contextLost = false;
      initResources();
      buffers = {};
      needsDraw = true;
      if (lastShader) {
        try { build(lastShader.glsl.vertex, lastShader.glsl.fragment); } catch (e) { onError('上下文恢复后重新编译失败：' + e.message); }
      }
      if (lastMesh) uploadMesh(lastMesh);
    });

    initResources();
    requestAnimationFrame(frame);

    return {
      setShader: setShader,
      setMesh: setMesh,
      invalidate: function () { needsDraw = true; },
      resetView: function () { yaw = 0.65; pitch = 0.28; dist = 3.25; needsDraw = true; },
      gl: gl
    };
  }

  root.ShaderPreview = { createViewer: createViewer, parseOBJ: parseOBJ };
})(typeof window !== 'undefined' ? window : globalThis);