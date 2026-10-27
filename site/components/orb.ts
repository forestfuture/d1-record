// The home page's orb: a forest-green ball of moving light, drawn with WebGL over the
// static logo. Where WebGL is missing the static logo stays, and for readers who ask for reduced
// motion the orb holds one still frame.

const VERTEX = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

// A sphere of deep green glass with light moving inside it. Seven layers of soft strands, each a
// set of bent parallel lines, turn and drift through the ball and fade in and out, glowing teal,
// green, or magenta. A burst at the lower right pulses and turns, and strands brighten near it;
// the brightest light turns magenta, then white. Only the light rolls off towards white, so the
// green body keeps its color.
const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 resolution;
uniform float time;

const vec3 SHADE = vec3(0.02, 0.13, 0.04);
const vec3 FOREST = vec3(0.1, 0.42, 0.1);
const vec3 TEAL = vec3(0.2, 0.85, 0.7);
const vec3 LEAF = vec3(0.45, 0.9, 0.3);
const vec3 MAGENTA = vec3(0.84, 0.23, 0.69);
const vec3 CORE = vec3(1.0, 0.97, 0.92);

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float bottom = mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x);
  float top = mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x);
  return mix(bottom, top, u.y);
}

float layers(vec2 p) {
  float sum = 0.0;
  float weight = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += weight * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    weight *= 0.5;
  }
  return sum;
}

vec3 strandColor(float i) {
  float k = mod(i, 3.0);
  if (k < 0.5) return TEAL;
  if (k < 1.5) return LEAF;
  return MAGENTA;
}

// One layer of strands: parallel lines across the ball at an angle that turns over time, bent
// by a wave along them, glowing with a long soft tail, and fading in and out.
vec3 strand(vec2 q, float i, float t) {
  float spin = (mod(i, 2.0) * 2.0 - 1.0) * (0.12 + 0.04 * i);
  float turn = i * 2.39996 + t * spin;
  vec2 across = vec2(cos(turn), sin(turn));
  float bend = 0.35 * sin(dot(q, vec2(-across.y, across.x)) * 1.4 + t * 0.8 + i);
  float lane = abs(fract((dot(q, across) + bend) * 0.9 + 0.17 * i + t * 0.06) - 0.5) * 2.0;
  float line = 0.035 / (lane + 0.035) - 0.034;
  float life = 0.5 + 0.5 * sin(t * 0.55 + i * 1.7);
  return strandColor(i) * max(line, 0.0) * life * life;
}

void main() {
  float side = min(resolution.x, resolution.y);
  vec2 p = (2.0 * gl_FragCoord.xy - resolution) / side * 1.02;
  float r = length(p);
  float coverage = 1.0 - smoothstep(1.0 - 2.5 / side, 1.0, r);
  if (coverage <= 0.0) { gl_FragColor = vec4(0.0); return; }

  float z = sqrt(max(1.0 - r * r, 0.0));
  float t = time * 0.35;
  // Seen through the glass: stretched towards the rim, and bent smoothly by slow noise.
  vec2 q = p / (z + 0.5) * 1.4;
  vec2 warp = vec2(noise(q * 0.9 + vec2(0.3 * t, 0.0)), noise(q * 0.9 + vec2(4.1, 0.3 * t))) - 0.5;
  q += 1.1 * warp;

  // The burst sits halfway from the center to the edge, down and to the right, at time 0 (the
  // still frame), and wanders around that point. It pulses, and its smeared glow turns.
  vec2 center = vec2(0.35, -0.35) + 0.12 * vec2(sin(t * 0.5), sin(t * 0.37));
  vec2 fromCenter = p - center;
  float d = length(fromCenter);
  float pulse = 0.75 + 0.25 * sin(t * 1.1) * sin(t * 0.63 + 1.0);
  float tilt = -0.785 + 0.6 * sin(t * 0.3);
  vec2 along = vec2(cos(tilt), sin(tilt));
  float a = dot(fromCenter, along);
  float b = dot(fromCenter, vec2(-along.y, along.x));
  float smear = exp(-(a * a * 2.5 + b * b * 35.0));
  float burst = pulse * (0.8 * exp(-d * d * 30.0) + 0.5 * smear);
  float halo = pulse * exp(-d * d * 6.0);

  vec3 glow = vec3(0.0);
  for (int n = 0; n < 7; n++) glow += strand(q, float(n), t);
  glow *= 1.0 + 1.5 * exp(-d * 2.0);

  // Light turns hotter as it brightens: magenta where strands and the burst pile up, then white.
  float heat = burst + dot(glow, vec3(0.3));
  vec3 light = glow + MAGENTA * (0.9 * halo + smoothstep(0.35, 0.9, heat) * heat * 0.5);
  light += CORE * smoothstep(0.6, 1.3, heat) * heat;
  light = 1.0 - exp(-1.3 * light);

  // Deep green glass, darker towards the rim and under the burst's halo, so its magenta stays
  // vivid, with a little slow cloud and a teal edge.
  vec3 body = mix(SHADE, FOREST, 0.1 + 0.5 * z * z) * (0.7 + 0.5 * layers(q * 1.2 - 0.2 * t));
  body *= 1.0 - 0.7 * min(halo, 1.0);
  vec3 color = 1.0 - (1.0 - body) * (1.0 - light);
  color += TEAL * 0.35 * pow(1.0 - z, 3.0);
  gl_FragColor = vec4(min(color, 1.0) * coverage, coverage);
}
`;

/** The moment the still frame shows, and the animation starts from, in seconds. At 0 the burst
 * sits exactly at its point in the shader. */
const START = 0;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

function link(gl: WebGLRenderingContext): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

/** Sets up a program drawing one triangle over the whole canvas; returns its time uniform. */
function prepare(gl: WebGLRenderingContext, canvas: HTMLCanvasElement) {
  const program = link(gl);
  if (!program) return null;
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const scale = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(canvas.clientWidth * scale);
  canvas.height = Math.round(canvas.clientHeight * scale);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform2f(gl.getUniformLocation(program, "resolution"), canvas.width, canvas.height);
  return gl.getUniformLocation(program, "time");
}

/**
 * Draws the orb on `canvas`, animated while it's on screen, and marks the canvas `data-drawn`
 * once a frame shows. Returns a function that stops it and frees the WebGL context.
 */
export function startOrb(canvas: HTMLCanvasElement): () => void {
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true });
  if (!gl) return () => {};
  const release = () => gl.getExtension("WEBGL_lose_context")?.loseContext();
  const time = prepare(gl, canvas);
  if (!time) {
    release();
    return () => {};
  }

  const still = window.matchMedia("(prefers-reduced-motion: reduce)");
  let visible = true;
  let frame = 0;
  // Time only runs while the orb animates, so it resumes where it stopped.
  let elapsed = 0;
  let last = 0;
  const draw = (seconds: number) => {
    gl.uniform1f(time, seconds);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    canvas.dataset.drawn = "";
  };
  const loop = (now: number) => {
    elapsed += last ? now - last : 0;
    last = now;
    draw(START + elapsed / 1000);
    frame = requestAnimationFrame(loop);
  };
  const update = () => {
    cancelAnimationFrame(frame);
    last = 0;
    if (still.matches) draw(START);
    else if (visible) frame = requestAnimationFrame(loop);
  };
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
    update();
  });

  const stop = () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    still.removeEventListener("change", update);
  };
  // If the browser takes the context back, the canvas goes blank: stop, and show the static logo.
  const lost = () => {
    stop();
    delete canvas.dataset.drawn;
  };

  observer.observe(canvas);
  still.addEventListener("change", update);
  canvas.addEventListener("webglcontextlost", lost, { once: true });
  update();
  return () => {
    stop();
    canvas.removeEventListener("webglcontextlost", lost);
    release();
  };
}
