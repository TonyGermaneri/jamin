/**
 * The effects layer.
 *
 * A single full-screen fragment shader sitting behind the text.  It is told
 * where the interesting words are -- the chord playing now, the one coming next,
 * the one that just finished -- as rectangles in CSS pixels, and lights them
 * accordingly: a breathing halo and a sweep that tracks the bar on the active
 * chord, a charge that builds under the next one, embers on the last one.
 *
 * Readability comes first, so nothing paints opaquely over a glyph: the effects
 * are halos, underlights and background motion.  Every term is scaled by a
 * parameter the user can turn down to zero.
 */

export const MAX_REGIONS = 8

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
#define MAX 8

uniform vec2 uRes;
uniform float uDpr;
uniform float uTime;
uniform float uBeat;
uniform float uBar;
uniform float uAttack;
uniform float uRunning;
uniform vec3 uBg;
uniform vec3 uAccent;
uniform vec3 uAccentAlt;
uniform vec4 uP1;   // intensity, bloom, preRoll, trail
uniform vec4 uP2;   // warp, chroma, scan, grain
uniform vec4 uP3;   // speed, pulse, hue, unused
uniform int uCount;
uniform vec4 uRects[MAX];
uniform vec4 uMeta[MAX];

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

// Signed distance to a rounded box; negative inside.
float sdBox(vec2 p, vec2 b, float r) {
  vec2 d = abs(p) - b + r;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}

vec3 hueRotate(vec3 c, float h) {
  if (h == 0.0) return c;
  const vec3 k = vec3(0.57735);
  float a = h * 6.2831853;
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

// Accent and secondary light gathered at one point, over every region.
vec2 lightAt(vec2 p) {
  float accent = 0.0;
  float alt = 0.0;

  for (int i = 0; i < MAX; i++) {
    float live = step(float(i) + 0.5, float(uCount));
    vec4 r = uRects[i];
    vec4 m = uMeta[i];
    vec2 centre = r.xy + r.zw * 0.5;
    vec2 halfSize = r.zw * 0.5;
    float radius = min(halfSize.y, 14.0);
    float d = sdBox(p - centre, halfSize + vec2(4.0, 2.0), radius);
    float near = exp(-max(d, 0.0) / (18.0 + halfSize.y * 0.6));
    float state = m.x;
    float progress = m.y;
    float energy = m.z;

    // Active chord: halo that breathes on the beat, plus a sweep that tracks
    // how far through the chord we are.
    float isActive = 1.0 - min(abs(state), 1.0);
    float breathe = 0.72 + 0.28 * pow(1.0 - uBeat, 2.0) * uRunning;
    float sweepX = r.x + r.z * progress;
    float sweep = exp(-abs(p.x - sweepX) / (6.0 + r.z * 0.05)) * exp(-max(d, 0.0) / 26.0);
    float ring = exp(-abs(d - uAttack * 150.0) / (12.0 + 70.0 * uAttack)) * (1.0 - uAttack);
    accent += live * isActive * (near * uP1.y * breathe * 0.9 + sweep * 0.5 + ring * uP1.y * 0.8) * energy;

    // Next chord: a charge that fills from the left as the current chord runs out.
    float isNext = max(0.0, -state);
    float fill = step(p.x, r.x + r.z * progress) * step(abs(d), 3.0);
    float under = exp(-abs(p.y - (r.y + r.w * 0.94)) / 5.0) * step(r.x, p.x) * step(p.x, r.x + r.z * progress);
    alt += live * isNext * (near * 0.22 + under * 1.1 + fill * 0.1) * uP1.z * energy;

    // Previous chord: embers drifting up out of the word.
    float isPast = max(0.0, state);
    float drift = fbm(vec2(p.x * 0.06, p.y * 0.05 - uTime * 1.4 * uP3.x) + m.w);
    float embers = near * smoothstep(0.45, 0.95, drift);
    alt += live * isPast * (near * 0.16 + embers * 0.7) * uP1.w * energy;
  }

  return vec2(accent, alt);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  float speed = uP3.x;
  float t = uTime * speed;

  // Heat shimmer.
  if (uP2.x > 0.0) {
    vec2 wobble = vec2(fbm(p * 0.006 + vec2(t * 0.2, 0.0)), fbm(p * 0.006 + vec2(0.0, t * 0.17)));
    p += (wobble - 0.5) * uP2.x * 26.0;
  }

  vec3 accent = hueRotate(uAccent, uP3.z);
  vec3 accentAlt = hueRotate(uAccentAlt, uP3.z);

  vec2 offset = vec2(uP2.y * 5.0, 0.0);
  vec2 lightG = lightAt(p);
  vec2 lightR = uP2.y > 0.0 ? lightAt(p + offset) : lightG;
  vec2 lightB = uP2.y > 0.0 ? lightAt(p - offset) : lightG;

  vec3 col = uBg;

  // Slow field in the background so the page is never completely dead.
  float field = fbm(p * 0.0022 + vec2(t * 0.035, t * 0.021));
  col += (accent * 0.10 + accentAlt * 0.06) * field * uP3.y;

  // A gentle shove on every beat.
  col += accent * 0.05 * uP3.y * pow(1.0 - uBeat, 4.0) * uRunning;

  col += accent * vec3(lightR.x, lightG.x, lightB.x);
  col += accentAlt * vec3(lightR.y, lightG.y, lightB.y);

  col = mix(uBg, col, clamp(uP1.x, 0.0, 2.0));

  if (uP2.z > 0.0) {
    col *= 1.0 - uP2.z * 0.3 * (0.5 + 0.5 * sin(gl_FragCoord.y * 2.2));
  }
  if (uP2.w > 0.0) {
    col += (hash(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) * uP2.w * 0.13;
  }

  vec2 uv = gl_FragCoord.xy / uRes;
  float vignette = 1.0 - 0.3 * pow(length((uv - 0.5) * vec2(1.15, 1.0)) * 1.35, 2.2);
  col *= vignette;

  gl_FragColor = vec4(col, 1.0);
}
`

export class GlRenderer {
  constructor(canvas) {
    this.canvas = canvas
    this.ok = false
    this.error = null
    this.gl = null
    this._lost = false

    const attrs = { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' }
    const gl = canvas.getContext('webgl2', attrs) || canvas.getContext('webgl', attrs)
    if (!gl) {
      this.error = 'WebGL is not available; effects are off.'
      return
    }
    this.gl = gl

    const program = link(gl, VERTEX, FRAGMENT)
    if (!program) {
      this.error = 'Shader failed to compile; effects are off.'
      return
    }
    this.program = program

    this.buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    // One oversized triangle covers the viewport with no seam down the middle.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    this.position = gl.getAttribLocation(program, 'aPos')

    this.u = {}
    for (const name of ['uRes', 'uDpr', 'uTime', 'uBeat', 'uBar', 'uAttack', 'uRunning', 'uBg', 'uAccent', 'uAccentAlt', 'uP1', 'uP2', 'uP3', 'uCount']) {
      this.u[name] = gl.getUniformLocation(program, name)
    }
    this.u.uRects = gl.getUniformLocation(program, 'uRects[0]')
    this.u.uMeta = gl.getUniformLocation(program, 'uMeta[0]')

    this.rects = new Float32Array(MAX_REGIONS * 4)
    this.meta = new Float32Array(MAX_REGIONS * 4)

    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault()
      this._lost = true
      this.ok = false
    })
    canvas.addEventListener('webglcontextrestored', () => {
      this._lost = false
    })

    this.ok = true
  }

  resize(width, height, dpr) {
    if (!this.ok) return
    const w = Math.max(1, Math.round(width * dpr))
    const h = Math.max(1, Math.round(height * dpr))
    if (this.canvas.width === w && this.canvas.height === h) return
    this.canvas.width = w
    this.canvas.height = h
    this.gl.viewport(0, 0, w, h)
  }

  /**
   * @param {object} frame
   * @param {Array<{x,y,w,h,state,progress,energy,seed}>} frame.regions state is
   *        -1 for the chord coming up, 0 for the one playing, 1 for the last one
   */
  render(frame) {
    if (!this.ok || this._lost) return
    const gl = this.gl
    const { colors, params, regions = [] } = frame

    gl.useProgram(this.program)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    gl.enableVertexAttribArray(this.position)
    gl.vertexAttribPointer(this.position, 2, gl.FLOAT, false, 0, 0)

    gl.uniform2f(this.u.uRes, this.canvas.width, this.canvas.height)
    gl.uniform1f(this.u.uDpr, frame.dpr)
    gl.uniform1f(this.u.uTime, frame.time)
    gl.uniform1f(this.u.uBeat, frame.beat)
    gl.uniform1f(this.u.uBar, frame.bar)
    gl.uniform1f(this.u.uAttack, frame.attack)
    gl.uniform1f(this.u.uRunning, frame.running ? 1 : 0)
    gl.uniform3fv(this.u.uBg, colors.bg)
    gl.uniform3fv(this.u.uAccent, colors.accent)
    gl.uniform3fv(this.u.uAccentAlt, colors.accentAlt)
    gl.uniform4f(this.u.uP1, params.intensity, params.bloom, params.preRoll, params.trail)
    gl.uniform4f(this.u.uP2, params.warp, params.chroma, params.scan, params.grain)
    gl.uniform4f(this.u.uP3, params.speed, params.pulse, params.hue, 0)

    const count = Math.min(regions.length, MAX_REGIONS)
    this.rects.fill(0)
    this.meta.fill(0)
    for (let i = 0; i < count; i++) {
      const region = regions[i]
      this.rects.set([region.x, region.y, region.w, region.h], i * 4)
      this.meta.set([region.state, region.progress, region.energy, region.seed || 0], i * 4)
    }
    gl.uniform1i(this.u.uCount, count)
    gl.uniform4fv(this.u.uRects, this.rects)
    gl.uniform4fv(this.u.uMeta, this.meta)

    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  dispose() {
    if (!this.gl) return
    const gl = this.gl
    if (this.program) gl.deleteProgram(this.program)
    if (this.buffer) gl.deleteBuffer(this.buffer)
    this.ok = false
  }
}

function link(gl, vertexSource, fragmentSource) {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource)
  if (!vertex || !fragment) return null
  const program = gl.createProgram()
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('jamin: shader link failed', gl.getProgramInfoLog(program))
    return null
  }
  return program
}

function compile(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('jamin: shader compile failed', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}
