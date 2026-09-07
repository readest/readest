/**
 * WebGL page-curl renderer (readest#555, mesh curl for Tauri apps).
 *
 * Draws a captured page bitmap as a grid mesh deformed around a cylinder —
 * the classic page curl: content before the fold stays flat, content past the
 * fold wraps over the cylinder and comes out mirrored on top, showing the
 * back of the page: the content bleeding through the theme paper (see
 * setBackdrop). The canvas is transparent wherever the page has curled
 * away, so the live (already turned) page shows through underneath.
 *
 * With two columns on screen (setColumns), only the outer column is a leaf:
 * it is hinged at the spine like a real book page, the fold stops at the
 * spine, and the leaf lands on the inner column as an exact mirror. Its back
 * shows the incoming page (setIncoming) so that the moment the overlay is
 * removed matches the live page underneath; without an incoming texture the
 * back is theme paper and the canvas fades out over the last stretch.
 *
 * The renderer knows nothing about capture or gestures: callers provide an
 * ImageBitmap of the outgoing page and drive `render(progress, grab)`.
 */

const VERTEX_SHADER = `
attribute vec2 aPos;      // page coords in [0,1]x[0,1]
uniform vec2 uPage;       // page size in px
uniform vec2 uFold;       // a point on the fold line, page px
uniform vec2 uDir;        // fold normal (unit): points toward the curled side
uniform float uRadius;    // cylinder radius, px
uniform vec2 uLeaf;       // open x interval (page px) of the leaf that may deform
varying vec2 vUv;
varying float vLift;      // 0 flat .. 1 on top of the cylinder / landed
varying float vShade;     // 0 flat or landed .. 1 at the top of the roll

const float PI = 3.141592653589793;

void main() {
  vec2 p = aPos * uPage;
  float s = dot(p - uFold, uDir);
  float lift = 0.0;
  float shade = 0.0;
  // Vertices on the spine itself never move: they are the hinge shared with
  // the flat inner column, which must not stretch.
  if (p.x > uLeaf.x && p.x < uLeaf.y && s > 0.0) {
    float r = max(uRadius, 1.0e-3);
    if (s < PI * r) {
      float wrapped = r * sin(s / r);
      float z = r * (1.0 - cos(s / r));
      p -= uDir * (s - wrapped);
      lift = z / (2.0 * r);
      shade = sin(s / r);
    } else {
      // Past the half turn: lies flat on top, mirrored about the fold. With
      // a zero radius this is an exact reflection, which is how a leaf lands
      // on the facing page.
      p -= uDir * (2.0 * s - PI * r);
      lift = 1.0;
    }
  }
  // Texture row 0 is the top of the captured page and aPos.y = 0 is the top
  // of the page, so page coordinates are texture coordinates as-is. Do NOT
  // rely on UNPACK_FLIP_Y_WEBGL to reconcile them: WebKit ignores it for
  // ImageBitmap uploads, which turned the curl upside down on iOS.
  vUv = aPos;
  vLift = lift;
  vShade = shade;
  vec2 clip = (p / uPage) * 2.0 - 1.0;
  // Lifted parts draw on top of flat parts.
  gl_Position = vec4(clip.x, -clip.y, -vLift * 0.5, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D uTex;
uniform sampler2D uBack;
uniform sampler2D uIncoming;
uniform float uHasIncoming;
uniform vec2 uIncomingMap; // incoming u = uIncomingMap.x + uIncomingMap.y * page u
varying vec2 vUv;
varying float vLift;
varying float vShade;

void main() {
  vec4 c = texture2D(uTex, vUv);
  if (gl_FrontFacing) {
    // Slight contact shading as the page lifts.
    c.rgb *= 1.0 - 0.18 * vLift;
  } else if (uHasIncoming > 0.5) {
    // The back of a leaf: the incoming page, mirrored about the spine so it
    // reads correctly once the leaf has landed. Shaded only on the roll so
    // the landed part matches the live page pixel for pixel.
    c = texture2D(uIncoming, vec2(uIncomingMap.x + uIncomingMap.y * vUv.x, vUv.y));
    c.rgb *= 1.0 - 0.22 * vShade;
  } else {
    // The back of the page: the mirrored content bleeding through the
    // paper — the theme background supplied via setBackdrop.
    vec3 paper = texture2D(uBack, vUv).rgb;
    c.rgb = mix(c.rgb, paper, 0.72);
    c.rgb *= 1.0 - 0.08 * vLift;
  }
  gl_FragColor = vec4(c.rgb, c.a);
}
`;

const GRID = 64;
// Without an incoming texture a two-column leaf lands showing paper; fade the
// whole canvas over the last stretch so the live page takes over smoothly.
const LEAF_FADE_START = 0.8;

export interface CurlGrab {
  /** Normalized grab point on the page, 0..1 in both axes. */
  x: number;
  y: number;
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export class PageCurlRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | null = null;
  private backTex: WebGLTexture | null = null;
  private incomingTex: WebGLTexture | null = null;
  private hasIncoming = false;
  private columns = 1;
  private indexCount = 0;
  private width = 0;
  private height = 0;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private preserveDrawingBuffer: boolean;

  constructor(options: { preserveDrawingBuffer?: boolean } = {}) {
    // Standalone pixel/readback users retain the historical default. The
    // captured-turn pipeline opts out because its idle surface can stay alive
    // much longer and redraws before reveal.
    this.preserveDrawingBuffer = options.preserveDrawingBuffer ?? true;
  }

  /** Mount the overlay canvas covering `rect` (CSS px) inside `container`. */
  attach(container: HTMLElement, width: number, height: number, dpr = window.devicePixelRatio) {
    this.width = width;
    this.height = height;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    Object.assign(canvas.style, {
      position: 'absolute',
      inset: '0',
      width: `${width}px`,
      height: `${height}px`,
      pointerEvents: 'none',
      zIndex: '50',
    });
    container.appendChild(canvas);
    this.canvas = canvas;

    // preserveDrawingBuffer is only needed by readback callers. Long-lived
    // prepared turn surfaces disable it to avoid retaining another full-size
    // color buffer while idle.
    const gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: this.preserveDrawingBuffer,
    });
    if (!gl) {
      this.dispose();
      throw new Error('WebGL unavailable');
    }
    this.gl = gl;

    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`shader: ${gl.getShaderInfoLog(shader)}`);
      }
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`program: ${gl.getProgramInfoLog(program)}`);
    }
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API, not a React hook
    gl.useProgram(program);

    // Grid mesh of GRID x GRID quads over the unit page. GRID is even, so a
    // two-column spine falls on a grid line and no quad straddles the hinge.
    const verts: number[] = [];
    for (let y = 0; y <= GRID; y++) {
      for (let x = 0; x <= GRID; x++) {
        verts.push(x / GRID, y / GRID);
      }
    }
    const indices: number[] = [];
    const at = (x: number, y: number) => y * (GRID + 1) + x;
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        indices.push(at(x, y), at(x + 1, y), at(x, y + 1));
        indices.push(at(x + 1, y), at(x + 1, y + 1), at(x, y + 1));
      }
    }
    this.indexCount = indices.length;

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

    for (const name of [
      'uPage',
      'uFold',
      'uDir',
      'uRadius',
      'uLeaf',
      'uTex',
      'uBack',
      'uIncoming',
      'uHasIncoming',
      'uIncomingMap',
    ]) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }
    gl.uniform2f(this.uniforms['uPage']!, width, height);

    // Back-face paper on unit 1: plain white until setBackdrop supplies the
    // theme background.
    this.backTex = this.createPlaceholderTexture(gl, 1, [255, 255, 255, 255]);
    gl.uniform1i(this.uniforms['uBack']!, 1);
    // Incoming page on unit 2: unused until setIncoming supplies it.
    this.incomingTex = this.createPlaceholderTexture(gl, 2, [0, 0, 0, 0]);
    gl.uniform1i(this.uniforms['uIncoming']!, 2);
    gl.uniform1f(this.uniforms['uHasIncoming']!, 0);
    gl.uniform2f(this.uniforms['uIncomingMap']!, 0, 1);
    gl.activeTexture(gl.TEXTURE0);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    // The vertex shader flips Y into clip space, mirroring triangle winding:
    // the grid's quads come out clockwise, so declare CW as front-facing or
    // gl_FrontFacing (front page vs whitened back) is inverted.
    gl.frontFace(gl.CW);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  private createPlaceholderTexture(gl: WebGLRenderingContext, unit: number, rgba: number[]) {
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(rgba),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /** Upload the captured page (drawn at progress 0 it exactly covers). */
  setTexture(source: TexImageSource) {
    const gl = this.gl;
    if (!gl) return;
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // Upload unflipped; the vertex shader samples page coordinates directly.
    // (WebKit ignores UNPACK_FLIP_Y_WEBGL for ImageBitmap sources, so any
    // orientation scheme built on it breaks on iOS.)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.uniforms['uTex']!, 0);
  }

  /** Paper drawn on the back of the page (theme background color + texture). */
  setBackdrop(source: TexImageSource) {
    const gl = this.gl;
    if (!gl || !this.backTex) return;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.backTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.activeTexture(gl.TEXTURE0);
  }

  /**
   * How many page columns the captured page holds. With 2, only the outer
   * column turns, hinged at the spine (the middle of the page); the inner
   * column stays flat until the leaf lands on it.
   */
  setColumns(columns: number) {
    this.columns = columns >= 2 ? 2 : 1;
  }

  /**
   * The incoming page shown on the back of a two-column leaf: a capture of
   * the inner column of the page the live view has already turned to (the
   * column the leaf lands on), at the same height as the captured page.
   * `null` reverts to the paper back.
   */
  setIncoming(source: TexImageSource | null) {
    const gl = this.gl;
    if (!gl || !this.incomingTex) return;
    this.hasIncoming = source !== null;
    if (source) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.incomingTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.activeTexture(gl.TEXTURE0);
    }
  }

  /**
   * Draw the curl at `progress` (0 = flat, 1 = fully turned). `grab` picks
   * where the reader lifted the page: y near 1 curls from the bottom corner
   * (a diagonal fold that straightens as the turn completes), y near 0.5
   * folds straight. `rtl` mirrors the direction: with rtl the page is
   * grabbed at its left edge.
   */
  render(progress: number, grab: CurlGrab = { x: 1, y: 0.5 }, rtl = false) {
    const gl = this.gl;
    if (!gl) return;
    const { width: w, height: h } = this;
    const leaf = this.columns === 2;
    // The sheet being turned: the whole page, or the outer column of a
    // two-column spread.
    const leafWidth = leaf ? w / 2 : w;
    // Only the spine is a hinge; the outer edge (and a single page) is open.
    const leafMin = leaf && !rtl ? w / 2 : -1e9;
    const leafMax = leaf && rtl ? w / 2 : 1e9;

    // Fold normal: mostly horizontal, tilted by how far the grab sits from
    // the vertical middle. The tilt decays with progress — a corner grab
    // starts as a steep diagonal pinch at that corner and flattens out, so
    // the far side of the page stays flat early in the turn yet the whole
    // page still clears by the end.
    const tilt = (grab.y - 0.5) * 1.8 * (1 - progress);
    const dx = rtl ? -1 : 1;
    const len = Math.hypot(1, tilt);
    const dir: [number, number] = [dx / len, tilt / len];

    let radius: number;
    let travel: number;
    if (leaf) {
      // The roll tightens all the way to nothing so the leaf lands flat on
      // the inner column, and the fold stops exactly at the spine.
      radius = 0.16 * leafWidth * (1 - progress * progress);
      travel = leafWidth;
    } else {
      // The cylinder tightens slightly as the page lifts off.
      radius = Math.max(24, 0.16 * w * (1 - 0.4 * progress));
      // The fold sweeps from the grabbed edge along the grab row; by progress 1
      // (tilt 0) it must cross the page plus the final half-circumference so
      // the spine-side column has fully wrapped off.
      const endRadius = Math.max(24, 0.16 * w * 0.6);
      travel = w + Math.PI * endRadius;
    }
    const start: [number, number] = [rtl ? 0 : w, grab.y * h];
    const foldX = start[0] - dir[0] * travel * progress;
    const foldY = start[1] - dir[1] * travel * progress;

    // The leaf's back shows the incoming inner column mirrored about the
    // spine: page u in [0.5, 1] maps to incoming u in [1, 0] for a right
    // leaf, page u in [0, 0.5] to incoming u in [1, 0] for a left leaf.
    const showIncoming = leaf && this.hasIncoming;
    gl.uniform1f(this.uniforms['uHasIncoming']!, showIncoming ? 1 : 0);
    gl.uniform2f(this.uniforms['uIncomingMap']!, rtl ? 1 : 2, -2);
    gl.uniform2f(this.uniforms['uLeaf']!, leafMin, leafMax);
    if (this.canvas) {
      const opacity = leaf && !this.hasIncoming ? 1 - smoothstep(LEAF_FADE_START, 1, progress) : 1;
      this.canvas.style.opacity = opacity < 1 ? String(opacity) : '';
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform2f(this.uniforms['uFold']!, foldX, foldY);
    gl.uniform2f(this.uniforms['uDir']!, dir[0], dir[1]);
    gl.uniform1f(this.uniforms['uRadius']!, radius);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
  }

  /** Read back a pixel (device px, origin top-left) — used by tests. */
  readPixel(x: number, y: number): [number, number, number, number] {
    const gl = this.gl;
    const canvas = this.canvas;
    if (!gl || !canvas) return [0, 0, 0, 0];
    const data = new Uint8Array(4);
    gl.readPixels(x, canvas.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return [data[0]!, data[1]!, data[2]!, data[3]!];
  }

  /** The canvas opacity the last render applied ('' when fully opaque). */
  get canvasOpacity(): string {
    return this.canvas?.style.opacity ?? '';
  }

  /** An idle prepared surface may lose its WebGL context under memory pressure. */
  isUsable() {
    return !!this.gl && !this.gl.isContextLost();
  }

  dispose() {
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.canvas?.remove();
    this.canvas = null;
    this.gl = null;
  }
}
