# Unity Shader Lab

一个零依赖的静态网页：把 Unity ShaderLab 的 vertex / fragment 着色器转换成 **GLSL ES 1.00**，在 WebGL 画布中实时预览，并支持下载 `.shader` 与生成的 `.glsl`。

## 运行

OBJ 模型通过 `fetch` 加载，需要 HTTP 服务（直接双击 `index.html` 只能转换和下载，模型会加载失败）：

```bash
cd unity-shader-lab
python -m http.server 8123
# 打开 http://localhost:8123
```

任意静态服务器都可以（VSCode Live Server、`npx serve` 等）。

## 使用

1. 在左侧编辑 Unity Shader（或右上角切换内置示例）。
2. 点击 **转换并编译**，或按 `Ctrl + Enter`。
3. 右侧拖动旋转、滚轮缩放、双击复位；底部胶囊按钮切换预制的球体 / 立方体 / 圆环 / 宝石。
4. **下载 .shader** 保存当前 Unity Shader；**下载 GLSL** 保存转换结果。
5. 出错时：
   - 转换错误会给出原因和修改建议；
   - GLSL 编译错误会列出「生成代码行号 + 出错行源码」，并自动在 **GLSL 输出** 标签页高亮该行；
   - 失败不会清空上一份可用预览，修好后重新编译即可恢复。

## 转换覆盖范围

- ShaderLab：`Shader` / `Properties` / `SubShader` / `Pass` / `CGPROGRAM…ENDCG`，取第一个同时含 `#pragma vertex` 与 `#pragma fragment` 的代码块。
- 类型：`fixed / half / float / int / bool` 及 2/3/4 维向量、`mat2/3/4`、`sampler2D`、`samplerCube`。
- 语义：`POSITION / NORMAL / TANGENT / TEXCOORD0-2 / COLOR`、`SV_POSITION / SV_Target`，struct 输入，内置 `appdata_base / appdata_tan / appdata_full`。
- 常用内置：`UnityObjectToClipPos`、`UnityObjectToWorldNormal`、`WorldSpaceViewDir`、`UnityWorldSpaceLightDir`、`TRANSFORM_TEX`、`mul`、`saturate`、`lerp`、`frac`、`atan2`、`tex2D`、`texCUBE`、`_Time / _SinTime / _CosTime`、`_WorldSpaceCameraPos`、`_WorldSpaceLightPos0`、`_LightColor0`、`UNITY_MATRIX_*` 等。
- 清理：`#pragma`、`#include`、`UNITY_SETUP_INSTANCE_ID`、`UNITY_APPLY_FOG`、`[unroll]`、`static` 等。
- 自动补齐 `_ST` / `_TexelSize` 并沿用 `Properties` 中的默认值。

## 已知限制

- 不支持 Surface Shader、Compute Shader、Geometry / Tessellation、多 Pass 叠加、实例化、内置光照与阴影。
- 纹理统一绑定为程序生成的棋盘图；Cube 采样为纯色。
- 数组 uniform 不会赋值；非方阵矩阵、`uint`、MRT 等 WebGL1 不支持的特性会编译失败并给出报错。
- 预览是近似实现，不保证与 Unity 逐像素一致。

## 结构

```
index.html            页面
css/style.css         样式
js/converter.js       ShaderLab/HLSL → GLSL 转换器（含诊断）
js/renderer.js        WebGL 预览器、OBJ 加载、轨道相机
js/samples.js         内置示例
js/app.js             界面交互、日志、下载
models/*.obj          预制模型
tools/gen_models.py   模型生成脚本
tools/test-convert.js Node 下的转换器冒烟测试
```

测试转换器：

```bash
node tools/test-convert.js           # 概要
node tools/test-convert.js --print   # 打印生成的 GLSL
```