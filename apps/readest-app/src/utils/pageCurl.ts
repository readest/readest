import { buildPageCurlMesh } from './pageCurlMesh';

/** Captured paper rendered as 64 hinged strips, with perspective and a translucent back. */
const VERTEX_SHADER = `
attribute vec2 aPos;
attribute vec3 aSurface;
attribute float aShade;
uniform mediump vec2 uPage;
varying mediump vec2 vUv;
varying mediump float vShade;
varying mediump float vHeight;

void main() {
  vUv = aPos;
  vShade = aShade;
  vHeight = aSurface.z;
  // eBoox's projection: camera distance 7 page widths / 2, with the
  // lifted page skewing toward the top as it approaches the camera.
  float depth = 2.0 * aSurface.z / (7.0 * uPage.x);
  float q = 1.0 - depth;
  vec2 clip = aSurface.xy / uPage * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y + depth, -depth, q);
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D uTex;
uniform sampler2D uIncoming;
uniform float uHasIncoming;
uniform vec2 uIncomingMap; // incoming u = uIncomingMap.x + uIncomingMap.y * page u
uniform mediump vec2 uPage;
varying mediump vec2 vUv;
varying mediump float vShade;
varying mediump float vHeight;

void main() {
  vec4 c = texture2D(uTex, vUv);
  if (!gl_FrontFacing) {
    if (uHasIncoming > 0.5) {
      c = texture2D(uIncoming, vec2(uIncomingMap.x + uIncomingMap.y * vUv.x, vUv.y));
    } else {
      // The paper in eBoox transmits 60% of the mirrored printing. Its
      // neutral grey tint is independent of the book's background colour.
      c.rgb = mix(c.rgb, vec3(0.5), 0.4);
    }
  }
  c.rgb = mix(c.rgb, vec3(0.5), vShade);
  if (vHeight > 10.0) {
    vec2 edge = min(vUv, 1.0 - vUv) * uPage / 2.0;
    float border = clamp(1.0 - min(edge.x, edge.y), 0.0, 1.0);
    c.rgb = mix(c.rgb, vec3(0.5), 0.4 * border);
  }
  gl_FragColor = c;
}
`;

// Without an incoming texture a two-column leaf lands showing paper; fade the
// whole canvas over the last stretch so the live page takes over smoothly.
const LEAF_FADE_START = 0.8;

export interface CurlGrab {
  /** x is the grabbed edge; y encodes 0.5 + vertical displacement / page height. */
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
  private incomingTex: WebGLTexture | null = null;
  private pageTex: WebGLTexture | null = null;
  private returningTex: WebGLTexture | null = null;
  private returning = false;
  private hasIncoming = false;
  private columns = 1;
  private destinationTex: WebGLTexture | null = null;
  private adjacentPrevious = false;
  private adjacentNext = false;
  private destination = false;
  private vertexBuffer: WebGLBuffer | null = null;
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

    this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    for (const [name, size, offset] of [
      ['aPos', 2, 0],
      ['aSurface', 3, 8],
      ['aShade', 1, 20],
    ] as const) {
      const location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 24, offset);
    }

    for (const name of ['uPage', 'uTex', 'uIncoming', 'uHasIncoming', 'uIncomingMap']) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }
    gl.uniform2f(this.uniforms['uPage']!, width, height);

    // Incoming page on unit 2: unused until setIncoming supplies it.
    this.incomingTex = this.createPlaceholderTexture(gl, 2, [0, 0, 0, 0]);
    this.returningTex = this.createPlaceholderTexture(gl, 1, [0, 0, 0, 0]);
    gl.uniform1i(this.uniforms['uIncoming']!, 2);
    gl.uniform1f(this.uniforms['uHasIncoming']!, 0);
    gl.uniform2f(this.uniforms['uIncomingMap']!, 0, 1);
    gl.activeTexture(gl.TEXTURE0);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    // The vertex shader flips Y into clip space, mirroring triangle winding:
    // the paper's triangles come out clockwise. render() mirrors this for RTL.
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
    this.returning = false;
    this.hasIncoming = false;
    this.destination = false;
    this.adjacentPrevious = false;
    this.adjacentNext = false;
    const tex = this.pageTex ?? (this.pageTex = gl.createTexture());
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

  /** Kept for the shared captured-turn interface; the paper tint comes from the printing itself. */
  setBackdrop(_source: TexImageSource) {}

  /** Upload the neighbouring sheets while idle, before any gesture. */
  prepareAdjacent(previous: TexImageSource | null, next: TexImageSource | null) {
    this.adjacentPrevious = previous !== null;
    this.adjacentNext = next !== null;
    if (previous) this.setReturning(previous);
    this.returning = false;
    const gl = this.gl;
    if (gl && next) {
      this.destinationTex ??= this.createPlaceholderTexture(gl, 3, [0, 0, 0, 0]);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.destinationTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, next);
      gl.activeTexture(gl.TEXTURE0);
    }
  }

  /** Select the buffered sheet for this navigation direction without changing reading direction. */
  selectAdjacent(forward: boolean) {
    const ready = forward ? this.adjacentNext : this.adjacentPrevious;
    this.destination = forward && ready;
    this.returning = !forward && ready;
    return ready;
  }

  /** The previous sheet returns around the book's existing spine. */
  setReturning(source: TexImageSource) {
    const gl = this.gl;
    if (!gl || !this.returningTex) return;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.returningTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.activeTexture(gl.TEXTURE0);
    this.returning = true;
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
   * the vertical finger displacement (0.5 is stationary). The diagonal
   * fold straightens as the turn completes. `rtl` mirrors the direction:
   * with rtl the page is grabbed at its left edge.
   */
  render(progress: number, grab: CurlGrab = { x: 1, y: 0.5 }, rtl = false) {
    const gl = this.gl;
    if (!gl) return;
    const { width: w, height: h } = this;
    const leaf = this.columns === 2;
    const mesh = buildPageCurlMesh(
      w,
      h,
      this.returning ? 1 - progress : progress,
      grab.y,
      rtl,
      this.columns,
      !this.returning,
    );
    gl.frontFace(rtl ? gl.CCW : gl.CW);

    // The leaf's back shows the incoming inner column mirrored about the
    // spine: page u in [0.5, 1] maps to incoming u in [1, 0] for a right
    // leaf, page u in [0, 0.5] to incoming u in [1, 0] for a left leaf.
    const showIncoming = leaf && (this.hasIncoming || this.returning);
    gl.uniform1f(this.uniforms['uHasIncoming']!, showIncoming ? 1 : 0);
    gl.uniform1i(this.uniforms['uIncoming']!, this.returning ? 0 : 2);
    gl.uniform2f(
      this.uniforms['uIncomingMap']!,
      this.returning ? 1 : rtl ? 1 : 2,
      this.returning ? -1 : -2,
    );
    if (this.canvas) {
      const opacity =
        leaf && !this.hasIncoming && !this.returning
          ? 1 - smoothstep(LEAF_FADE_START, 1, progress)
          : 1;
      this.canvas.style.opacity = opacity < 1 ? String(opacity) : '';
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const draw = (vertices: Float32Array, texture: number) => {
      gl.uniform1i(this.uniforms['uTex']!, texture);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 6);
    };
    if (this.destination) draw(buildPageCurlMesh(w, h, 0, 0.5, rtl, 1), 3);
    if (this.returning) {
      // Keep the current page underneath the sheet until it returns. In a
      // spread the returning sheet's back is the current inner column; as
      // it lifts, the previous inner column is uncovered underneath it.
      draw(buildPageCurlMesh(w, h, 0, 0.5, rtl, 1), 0);
      if (leaf) draw(buildPageCurlMesh(w, h, 0, 0.5, rtl, 2).subarray(0, 36), 1);
    }
    draw(mesh, this.returning ? 1 : 0);
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

  /** Delete retained GL resources and detach the rendering surface. */
  dispose() {
    const gl = this.gl;
    this.canvas?.remove();
    this.canvas = null;
    this.gl = null;
    this.vertexBuffer = null;
    this.pageTex = null;
    this.returningTex = null;
    this.incomingTex = null;
    this.destinationTex = null;
    if (gl) {
      const release = () => gl.getExtension('WEBGL_lose_context')?.loseContext();
      // Context loss clears the compositor's existing texture immediately.
      // Let the detached DOM layer leave a painted frame first, otherwise
      // Android can briefly composite a cleared sheet over the live reader.
      if (document.hidden) release();
      else requestAnimationFrame(() => requestAnimationFrame(release));
    }
  }
}
