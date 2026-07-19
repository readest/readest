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
 * The renderer knows nothing about capture or gestures: callers provide an
 * ImageBitmap of the outgoing page and drive `render(progress, grab)`.
 */

const VERTEX_SHADER = `
attribute vec2 aPos;      // page coords in [0,1]x[0,1]
uniform vec2 uPage;       // page size in px
uniform vec2 uFold;       // a point on the fold line, page px
uniform vec2 uDir;        // fold normal (unit): points toward the curled side
uniform float uRadius;    // cylinder radius, px
varying vec2 vUv;
varying float vLift;      // 0 flat .. 1 on top of the cylinder

const float PI = 3.141592653589793;

void main() {
  vec2 p = aPos * uPage;
  float s = dot(p - uFold, uDir);
  float z = 0.0;
  if (s > 0.0) {
    if (s < PI * uRadius) {
      float wrapped = uRadius * sin(s / uRadius);
      z = uRadius * (1.0 - cos(s / uRadius));
      p -= uDir * (s - wrapped);
    } else {
      // Past the half turn: lies flat on top, mirrored about the fold.
      p -= uDir * (2.0 * s - PI * uRadius);
      z = 2.0 * uRadius;
    }
  }
  // Texture row 0 is the top of the captured page and aPos.y = 0 is the top
  // of the page, so page coordinates are texture coordinates as-is. Do NOT
  // rely on UNPACK_FLIP_Y_WEBGL to reconcile them: WebKit ignores it for
  // ImageBitmap uploads, which turned the curl upside down on iOS.
  vUv = aPos;
  vLift = clamp(z / (2.0 * uRadius + 1.0e-4), 0.0, 1.0);
  vec2 clip = (p / uPage) * 2.0 - 1.0;
  // Lifted parts draw on top of flat parts.
  gl_Position = vec4(clip.x, -clip.y, -vLift * 0.5, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D uTex;
uniform sampler2D uBack;
varying vec2 vUv;
varying float vLift;

void main() {
  vec4 c = texture2D(uTex, vUv);
  if (gl_FrontFacing) {
    // Slight contact shading as the page lifts.
    c.rgb *= 1.0 - 0.18 * vLift;
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

export interface CurlGrab {
  /** Normalized grab point on the page, 0..1 in both axes. */
  x: number;
  y: number;
}

export class PageCurlRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | null = null;
  private backTex: WebGLTexture | null = null;
  private indexCount = 0;
  private width = 0;
  private height = 0;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};

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

    // preserveDrawingBuffer keeps readPixels valid after the browser
    // composites (readbacks otherwise silently return zeros past an await);
    // one short-lived overlay per turn, so the extra buffer copy is cheap.
    const gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
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

    // Grid mesh of GRID x GRID quads over the unit page.
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

    for (const name of ['uPage', 'uFold', 'uDir', 'uRadius', 'uTex', 'uBack']) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }
    gl.uniform2f(this.uniforms['uPage']!, width, height);

    // Back-face paper on unit 1: plain white until setBackdrop supplies the
    // theme background.
    this.backTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.backTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.uniforms['uBack']!, 1);
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

    // Fold normal: mostly horizontal, tilted by how far the grab sits from
    // the vertical middle. The tilt decays with progress — a corner grab
    // starts as a steep diagonal pinch at that corner and flattens out, so
    // the far side of the page stays flat early in the turn yet the whole
    // page still clears by the end.
    const tilt = (grab.y - 0.5) * 1.8 * (1 - progress);
    const dx = rtl ? -1 : 1;
    const len = Math.hypot(1, tilt);
    const dir: [number, number] = [dx / len, tilt / len];

    // The cylinder tightens slightly as the page lifts off.
    const radius = Math.max(24, 0.16 * w * (1 - 0.4 * progress));
    // The fold sweeps from the grabbed edge along the grab row; by progress 1
    // (tilt 0) it must cross the page plus the final half-circumference so
    // the spine-side column has fully wrapped off.
    const endRadius = Math.max(24, 0.16 * w * 0.6);
    const travel = w + Math.PI * endRadius;
    const start: [number, number] = [rtl ? 0 : w, grab.y * h];
    const foldX = start[0] - dir[0] * travel * progress;
    const foldY = start[1] - dir[1] * travel * progress;

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

  dispose() {
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.canvas?.remove();
    this.canvas = null;
    this.gl = null;
  }
}
