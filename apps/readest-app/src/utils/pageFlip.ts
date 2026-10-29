import {
  FLIP_FRAME_SIZE,
  FLIP_MIN_PRESSED_EDGE_X,
  FLIP_POINTS,
  FLIP_RUNS,
  PageFlipModel,
} from './pageFlipModel';

const QUAD_VERTEX = `#version 300 es
in vec2 aQuad;
void main() { gl_Position = vec4(aQuad, 0.0, 1.0); }
`;

// Adapted from page-turn-core's page and shadow shaders (MIT, see
// pageFlipModel.ts): each pixel inverts the side-view profile along up to
// four screen-monotonic runs and keeps the paper nearest the viewer, with a
// perspective-correct lookup. uMirror puts the spine on the right. The back
// of the sheet shows its own paper colour, read near its top-left corner.
const FLIP_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uPage;
uniform float uMirror;
uniform vec4 uProfile[65];
uniform vec4 uRuns[4];
out vec4 color;
float pscale(float depth) { return min(1.34, 4.0 / max(0.001, 4.0 - max(0.0, depth))); }
vec4 sampleRun(float bookX, vec4 run) {
  vec4 none = vec4(0.0, 1.0, -100000.0, 0.0);
  if (run.w < 0.5) return none;
  int low = int(run.x); int high = int(run.y);
  float lowX = uProfile[low].x; float highX = uProfile[high].x;
  if (bookX < min(lowX, highX) || bookX > max(lowX, highX)) return none;
  for (int i = 0; i < 7; i++) {
    if (high - low > 1) {
      int middle = (low + high) / 2;
      float middleX = uProfile[middle].x;
      if (run.z > 0.0 ? middleX <= bookX : middleX >= bookX) low = middle; else high = middle;
    }
  }
  vec4 before = uProfile[low]; vec4 after = uProfile[high];
  float deltaX = after.x - before.x;
  if (abs(deltaX) < 0.000001) return none;
  float t = clamp((bookX - before.x) / deltaX, 0.0, 1.0);
  float a = pscale(before.y); float b = pscale(after.y);
  float d = (1.0 - t) * a + t * b;
  float progress = d <= 0.000001 ? t : t * b / d;
  float material = (float(low) + progress) / 64.0;
  float depth = mix(before.y, after.y, progress);
  float normalZ = abs(mix(before.w, after.w, progress));
  bool frontFacing = deltaX > 0.0;
  float deformation = 1.0 - normalZ;
  float shade = deformation * 0.16 + (frontFacing ? 0.0 : deformation * 0.055);
  return vec4(material, 1.0 - min(0.2, shade), depth, frontFacing ? 1.0 : -1.0);
}
void main() {
  vec2 position = vec2(gl_FragCoord.x, uPage.y - gl_FragCoord.y);
  float bookX = mix(position.x / uPage.x, 1.0 - position.x / uPage.x, uMirror);
  vec4 visible = vec4(0.0, 1.0, -100000.0, 0.0);
  for (int r = 0; r < 4; r++) {
    vec4 candidate = sampleRun(bookX, uRuns[r]);
    if (candidate.z > visible.z) visible = candidate;
  }
  if (visible.z < -99999.0) { color = vec4(0.0); return; }
  if (visible.w < 0.0) { color = vec4(texelFetch(uTex, ivec2(2), 0).rgb * visible.y, 1.0); return; }
  float sourceX = mix(visible.x, 1.0 - visible.x, uMirror);
  float sourceY = 0.5 + (position.y / uPage.y - 0.5) / pscale(visible.z);
  vec4 paper = texture(uTex, vec2(clamp(sourceX, 0.0, 1.0), clamp(sourceY, 0.0, 1.0)));
  color = vec4(paper.rgb * visible.y, 1.0);
}
`;

const SHADOW_FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uPage;
uniform float uMirror;
uniform vec4 uShadow;
out vec4 color;
void main() {
  float bookX = mix(gl_FragCoord.x / uPage.x, 1.0 - gl_FragCoord.x / uPage.x, uMirror);
  float distanceFromRoll = (bookX - uShadow.x) / max(0.035, uShadow.y);
  float castShadow = exp(-distanceFromRoll * distanceFromRoll * 2.4) * uShadow.z;
  float spineShadow = exp(-abs(bookX) * 44.0) * min(0.07, uShadow.z * 0.32);
  color = vec4(0.0, 0.0, 0.0, clamp(castShadow + spineShadow, 0.0, 0.42));
}
`;

const now = () => performance.now() / 1000;

/**
 * Page Flip for the captured-turn canvas: the whole sheet lifts over the
 * spine, driven by `PageFlipModel` and drawn per pixel. A backward sheet
 * arrives from beyond the spine. Needs WebGL 2 for the shader's dynamic
 * profile lookups.
 */
export class PageFlipLayer {
  private model = new PageFlipModel();
  private frame = new Float32Array(FLIP_FRAME_SIZE);
  private sheet: WebGLProgram;
  private shadow: WebGLProgram;
  private quad: WebGLVertexArrayObject;
  private backward = false;
  private held = false;
  private endsOffPage = false;

  constructor(private gl: WebGL2RenderingContext) {
    const link = (fragment: string) => {
      const program = gl.createProgram()!;
      for (const [type, source] of [
        [gl.VERTEX_SHADER, QUAD_VERTEX],
        [gl.FRAGMENT_SHADER, fragment],
      ] as const) {
        const shader = gl.createShader(type)!;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        gl.attachShader(program, shader);
        gl.deleteShader(shader);
      }
      gl.bindAttribLocation(program, 0, 'aQuad');
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`Page Flip program: ${gl.getProgramInfoLog(program)}`);
      }
      return program;
    };
    this.sheet = link(FLIP_FRAGMENT);
    this.shadow = link(SHADOW_FRAGMENT);
    // Its own vertex array, so the curl's attribute setup stays intact.
    this.quad = gl.createVertexArray()!;
    gl.bindVertexArray(this.quad);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  /** Let go of the sheet before a new turn. */
  reset() {
    this.held = false;
    this.model.reset();
  }

  /**
   * Pose the sheet at a finger-driven `progress`. 0 and 1 lay it flat where
   * the turn starts and ends; a forward sheet is held near its free edge. A
   * `backward` sheet waits beyond the spine and arrives past its fold, so it
   * shows from the first move.
   */
  pose(progress: number, grabY: number, backward: boolean) {
    this.backward = backward;
    if (!this.held && (progress <= 0 || progress >= 1)) {
      this.model.reset();
      this.model.frame(this.frame, progress >= 1 !== this.backward);
      return;
    }
    const grabX = this.backward ? 1 : 0.9;
    if (!this.held) this.model.beginDrag(grabX, grabY, now());
    this.held = true;
    const x = this.backward
      ? FLIP_MIN_PRESSED_EDGE_X - (1 + FLIP_MIN_PRESSED_EDGE_X) * progress
      : grabX - progress;
    this.model.moveDrag(x, grabY, now());
    this.model.frame(this.frame, this.backward);
  }

  /** Release the last posed sheet to turn (`commit`) or return; a tap plays the whole turn. */
  release(commit: boolean) {
    this.model.release(commit, now());
    this.held = false;
    // A turned page leaves over the spine, and a cancelled backward sheet
    // returns there: the settle ends once nothing of it is left on the page.
    this.endsOffPage = commit !== this.backward;
    // A backward sheet arrives from there: skip the poses before it shows.
    for (let skipped = 0; !this.endsOffPage && skipped < 240; skipped++) {
      if (this.model.frame(this.frame, this.backward) || !this.model.advance(1 / 120)) break;
    }
    this.model.frame(this.frame, this.backward);
  }

  /** Step the released sheet; false once it has settled or left the page. */
  advance(seconds: number) {
    const moving = this.model.advance(seconds);
    const visible = this.model.frame(this.frame, this.backward);
    return moving && (visible || !this.endsOffPage);
  }

  /** Draw the cast shadow, then the sheet in texture `unit`, over what is already drawn. */
  draw(unit: number, rtl: boolean) {
    const gl = this.gl;
    const page = [gl.drawingBufferWidth, gl.drawingBufferHeight] as const;
    const runs = FLIP_POINTS * 4;
    const shadow = runs + FLIP_RUNS * 4;
    const mirror = rtl ? 1 : 0;
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.quad);
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API, not a React hook
    gl.useProgram(this.shadow);
    gl.uniform2f(gl.getUniformLocation(this.shadow, 'uPage'), ...page);
    gl.uniform1f(gl.getUniformLocation(this.shadow, 'uMirror'), mirror);
    gl.uniform4fv(gl.getUniformLocation(this.shadow, 'uShadow'), this.frame, shadow, 4);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API, not a React hook
    gl.useProgram(this.sheet);
    gl.uniform1i(gl.getUniformLocation(this.sheet, 'uTex'), unit);
    gl.uniform2f(gl.getUniformLocation(this.sheet, 'uPage'), ...page);
    gl.uniform1f(gl.getUniformLocation(this.sheet, 'uMirror'), mirror);
    gl.uniform4fv(gl.getUniformLocation(this.sheet, 'uProfile'), this.frame, 0, runs);
    gl.uniform4fv(gl.getUniformLocation(this.sheet, 'uRuns'), this.frame, runs, FLIP_RUNS * 4);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
  }
}
