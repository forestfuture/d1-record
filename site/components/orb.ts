// The home page's orb: a forest-green ball of slowly drifting light, drawn with WebGL over the
// static logo. Where WebGL is missing the static logo stays, and for readers who ask for reduced
// motion the orb holds one still frame.

const VERTEX = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

// A sphere lit from the upper left. Inside it, two layers of value noise warp a third, so bands
// of light drift through the glass, seen deeper at the centre than at the rim. Magenta streaks
// cross the bands, and a burst of light rays out from the centre.
const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 resolution;
uniform float time;

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

void main() {
  float side = min(resolution.x, resolution.y);
  vec2 p = (2.0 * gl_FragCoord.xy - resolution) / side * 1.02;
  float r = length(p);
  float coverage = 1.0 - smoothstep(1.0 - 2.5 / side, 1.0, r);
  if (coverage <= 0.0) { gl_FragColor = vec4(0.0); return; }

  float z = sqrt(max(1.0 - r * r, 0.0));
  vec3 normal = vec3(p, z);
  vec2 inside = p / (z + 0.6) * 1.6;
  float t = time * 0.12;
  vec2 warp = vec2(layers(inside + vec2(t, -t)), layers(inside + vec2(5.2 - t, 1.3 + t)));
  float light = layers(inside * 1.3 + 2.4 * warp + t);

  // Thin ridges where a second, oppositely warped field crosses its midpoint: the magenta streaks,
  // each a bright line in a soft glow, shown only where a slow third field lets them through.
  float ridge = 1.0 - abs(2.0 * layers(inside * 1.1 - 1.7 * warp - t) - 1.0);
  float through = smoothstep(0.5, 0.68, layers(inside * 0.7 + vec2(3.1, 7.4) + 0.5 * t));
  float streak = (pow(ridge, 40.0) + 0.35 * pow(ridge, 8.0)) * through;

  vec3 pale = vec3(0.64, 0.87, 0.56);
  vec3 forest = vec3(0.1, 0.42, 0.1);
  vec3 shade = vec3(0.03, 0.17, 0.05);
  vec3 magenta = vec3(0.84, 0.23, 0.69);
  vec3 core = vec3(1.0, 0.97, 0.88);
  vec3 color = mix(pale, forest, smoothstep(0.2, 0.65, light));
  color = mix(color, shade, 0.8 * smoothstep(0.62, 0.9, light));

  vec3 key = normalize(vec3(-0.5, 0.6, 0.65));
  color *= 0.55 + 0.6 * clamp(dot(normal, key), 0.0, 1.0);
  color = mix(color, magenta, 0.75 * streak) + magenta * 0.25 * streak;

  // The burst: a glow at the centre, and two sets of rays turning slowly against each other.
  float angle = atan(p.y, p.x);
  float rays = pow(abs(cos(angle * 3.0 + t * 1.5)), 30.0) + 0.6 * pow(abs(cos(angle * 5.0 - t)), 60.0);
  float burst = exp(-r * r * 30.0) + 0.8 * rays * exp(-r * 3.0);
  color += mix(magenta, core, exp(-r * r * 12.0)) * burst;

  float highlight = pow(clamp(dot(normal, normalize(key + vec3(0.0, 0.0, 1.0))), 0.0, 1.0), 40.0);
  color += mix(pale, magenta, 0.35) * 0.6 * pow(1.0 - z, 3.0) + vec3(0.6 * highlight);
  gl_FragColor = vec4(min(color, 1.0) * coverage, coverage);
}
`;

/** The moment the still frame shows, and the animation starts from, in seconds. */
const START = 8;

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
  const time = gl && prepare(gl, canvas);
  if (!gl || !time) return () => {};

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

  observer.observe(canvas);
  still.addEventListener("change", update);
  update();
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    still.removeEventListener("change", update);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
}
