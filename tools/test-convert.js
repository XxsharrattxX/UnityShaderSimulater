/* Node smoke test for the converter: prints results and catches obvious breakage. */
require('../js/converter.js');
require('../js/samples.js');
const conv = globalThis.ShaderConverter;
let failed = 0;
for (const s of globalThis.SHADER_SAMPLES) {
  try {
    const r = conv.convert(s.code);
    console.log('\n=== ' + s.name + ' -> ' + r.shaderName);
    console.log('uniforms:', r.uniforms.map(u => `${u.name}:${u.type}${u.value ? '=' + JSON.stringify(u.value) : ''}`).join(', '));
    console.log('varyings:', r.varyings.map(v => v.glslName + ':' + v.type).join(', '));
    console.log('warnings:', r.warnings.length ? r.warnings : 'none');
    if (process.argv.includes('--print')) {
      console.log('\n--- VERTEX ---\n' + r.glsl.vertex);
      console.log('\n--- FRAGMENT ---\n' + r.glsl.fragment);
    }
    const bad = [];
    for (const [stage, src] of Object.entries(r.glsl)) {
      if (/\bfixed\d?\b|\bhalf\d?\b|\bfloat[234]\b|\btex2D\b|\bSV_/.test(src)) bad.push(stage + ' still has HLSL tokens');
      if (!/void main\(\)/.test(src)) bad.push(stage + ' missing main');
      const open = (src.match(/\{/g) || []).length, close = (src.match(/\}/g) || []).length;
      if (open !== close) bad.push(stage + ' brace mismatch ' + open + '/' + close);
    }
    if (bad.length) { failed++; console.log('!! ' + bad.join('; ')); }
  } catch (e) {
    failed++;
    console.log('\n!!! ' + s.name + ' FAILED: ' + e.message + (e.hint ? ' | hint: ' + e.hint : ''));
  }
}

// Negative cases: each must throw a ConvertError with a helpful message.
const badCases = [
  ['empty', ''],
  ['no cg', 'Shader "X" { SubShader { Pass { } } }'],
  ['surface', 'Shader "X" { SubShader { Pass { CGPROGRAM\n#pragma surface surf Standard\nENDCG } } }'],
  ['missing pragma', 'Shader "X" { SubShader { Pass { CGPROGRAM\nstruct a { float4 vertex : POSITION; };\nvoid vert(a v) {}\nENDCG } } }'],
  ['inline semantic', 'Shader "X" { SubShader { Pass { CGPROGRAM\n#pragma vertex vert\n#pragma fragment frag\nfloat4 vert(float4 p : POSITION) : SV_POSITION { return p; }\nfloat4 frag() : SV_Target { return 1; }\nENDCG } } }']
];
for (const [label, src] of badCases) {
  try {
    conv.convert(src);
    failed++;
    console.log('!! expected failure but succeeded: ' + label);
  } catch (e) {
    const ok = e instanceof conv.ConvertError && e.message && e.hint;
    console.log((ok ? 'ok  ' : '!!  ') + label + ' -> ' + e.message + ' | hint: ' + e.hint);
    if (!ok) failed++;
  }
}
console.log('\n' + (failed ? 'FAILED ' + failed : 'ALL OK'));
process.exit(failed ? 1 : 0);