package com.readest.native_bridge

import android.content.Context
import android.graphics.Bitmap
import android.graphics.SurfaceTexture
import android.opengl.EGL14
import android.opengl.EGLExt
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLSurface
import android.opengl.GLES20 as GL
import android.opengl.GLUtils
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.view.Surface
import android.view.TextureView
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean

/** A native ES2 scene in a separate window: Activity PixelCopy never sees it. */
internal class NativePaperView(context: Context) : TextureView(context), TextureView.SurfaceTextureListener {
    private val thread = HandlerThread("ReadestPaperGL").apply { start() }
    private val worker = Handler(thread.looper)
    private val main = Handler(Looper.getMainLooper())
    private var display: EGLDisplay = EGL14.EGL_NO_DISPLAY
    private var eglContext: EGLContext = EGL14.EGL_NO_CONTEXT
    private var eglSurface: EGLSurface = EGL14.EGL_NO_SURFACE
    private var windowSurface: Surface? = null
    private var ready = false
    @Volatile private var dead = false
    private val waiting = ArrayList<() -> Unit>()
    private val textures = LinkedHashMap<String, Int>()
    private val mesh = NativePaperMesh()
    private val buffer = ByteBuffer.allocateDirect(8192 * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()
    private val queued = AtomicBoolean(false)
    private val bitmaps = java.util.Collections.newSetFromMap(java.util.concurrent.ConcurrentHashMap<Bitmap, Boolean>())
    var onFailure: ((Exception) -> Unit)? = null
    private var program = 0
    private var pageUniform = 0
    private var textureUniform = 0
    private var backUniform = 0
    private var spreadUniform = 0
    private var posAttribute = 0
    private var surfaceAttribute = 0
    private var shadeAttribute = 0
    private var pixelsWide = 1
    private var pixelsHigh = 1
    private var current: String? = null
    private var destination: String? = null
    private var forward = true
    private var rtl = false
    private var columns = 1
    @Volatile private var progress = 0f
    @Volatile private var grabY = 0.5f
    private class PresentedFrame(val done: (Exception?) -> Unit) {
        @Volatile var timestamp = 0L
    }
    @Volatile private var presentation: PresentedFrame? = null

    init {
        isOpaque = false
        // Captures already contain the reader's final theme colours.
        if (android.os.Build.VERSION.SDK_INT >= 29) isForceDarkAllowed = false
        surfaceTextureListener = this
    }

    /** Run GL work on the EGL thread once its surface is ready. */
    private fun execute(action: () -> Unit) {
        worker.post { if (!dead) { if (ready) {
            try { action() } catch (error: Exception) { main.post { onFailure?.invoke(error) } }
        } else waiting.add(action) } }
    }
    /** Run GL work and deliver its result on the Android main thread. */
    private fun report(done: (Exception?) -> Unit, action: () -> Unit) {
        execute {
            val error = try { action(); null } catch (e: Exception) { e }
            main.post { done(error) }
        }
    }

    /** Upload a valid keyed bitmap, recycle its pixels, and retain at most three textures. */
    fun upload(key: String, bitmap: Bitmap, valid: () -> Boolean, done: (Boolean, List<String>, Exception?) -> Unit) {
        if (dead) { bitmap.recycle(); done(false, emptyList(), IllegalStateException("Paper surface disposed")); return }
        bitmaps.add(bitmap)
        execute {
            var accepted = false
            val error = try {
                if (valid()) {
                    // A replacement goes into a new texture, so a request that
                    // turns stale cannot take the resident page with it.
                    val id = IntArray(1).also { GL.glGenTextures(1, it, 0) }[0]
                    GL.glBindTexture(GL.GL_TEXTURE_2D, id)
                    GL.glTexParameteri(GL.GL_TEXTURE_2D, GL.GL_TEXTURE_MIN_FILTER, GL.GL_LINEAR)
                    GL.glTexParameteri(GL.GL_TEXTURE_2D, GL.GL_TEXTURE_MAG_FILTER, GL.GL_LINEAR)
                    GL.glTexParameteri(GL.GL_TEXTURE_2D, GL.GL_TEXTURE_WRAP_S, GL.GL_CLAMP_TO_EDGE)
                    GL.glTexParameteri(GL.GL_TEXTURE_2D, GL.GL_TEXTURE_WRAP_T, GL.GL_CLAMP_TO_EDGE)
                    GLUtils.texImage2D(GL.GL_TEXTURE_2D, 0, bitmap, 0)
                    check(GL.glGetError() == GL.GL_NO_ERROR) { "Cannot upload native page texture" }
                    if (!valid()) {
                        GL.glDeleteTextures(1, intArrayOf(id), 0)
                    } else {
                        textures.remove(key)?.let { GL.glDeleteTextures(1, intArrayOf(it), 0) }
                        textures[key] = id
                        while (textures.size > 3) {
                            val oldest = textures.keys.firstOrNull { it != current && it != destination } ?: break
                            val old = textures.remove(oldest)!!
                            GL.glDeleteTextures(1, intArrayOf(old), 0)
                        }
                        accepted = true
                    }
                }
                null
            } catch (e: Exception) { e }
            finally { bitmap.recycle(); bitmaps.remove(bitmap) }
            val keys = textures.keys.toList()
            main.post { done(accepted, keys, error) }
        }
    }

    /** Select the resident source and destination textures and draw the initial pose. */
    fun scene(from: String, to: String, forwards: Boolean, mirrored: Boolean,
              p: Float, y: Float, spreadColumns: Int, done: (Exception?) -> Unit) {
        report(done) {
            check(textures.containsKey(from) && textures.containsKey(to)) { "Native page textures are not ready" }
            current = from; destination = to; forward = forwards; rtl = mirrored; columns = spreadColumns
            progress = p; grabY = y
            render()
        }
    }

    /** Draw the newest pose, coalescing updates that do not require an acknowledgement. */
    fun draw(p: Float, y: Float, done: ((Exception?) -> Unit)? = null) {
        progress = p.coerceIn(0f, 1f); grabY = y
        if (done != null) { report(done) { render() }; return }
        if (queued.compareAndSet(false, true)) execute { queued.set(false); render() }
    }

    /** A swap submission is not yet an image acquired by TextureView. */
    fun drawPresented(p: Float, y: Float, done: (Exception?) -> Unit) {
        check(presentation == null) { "A native paper frame is still awaiting presentation" }
        val frame = PresentedFrame(done)
        presentation = frame
        report({ error ->
            if (presentation === frame) {
                if (error != null) { discardPresentation(); done(error) }
                else {
                    if (android.os.Build.VERSION.SDK_INT >= 29 && isHardwareAccelerated)
                        viewTreeObserver.registerFrameCommitCallback { main.post { acknowledgePresentation(frame) } }
                    else postOnAnimation { acknowledgePresentation(frame) }
                    postInvalidateOnAnimation()
                }
            }
        }) {
            if (presentation === frame) {
                progress = p.coerceIn(0f, 1f); grabY = y
                val stamp = System.nanoTime()
                frame.timestamp = stamp
                render(stamp)
            }
        }
    }

    /** Invalidate an old frame callback so it cannot complete a replacement submission. */
    fun discardPresentation() { presentation = null }

    /** Confirm the hardware layer acquired this request's timestamp before completing it. */
    private fun acknowledgePresentation(frame: PresentedFrame) {
        if (presentation !== frame) return
        // TextureView updates its hardware layer on RenderThread. The Java
        // onSurfaceTextureUpdated callback can still see the previous timestamp.
        if (frame.timestamp > 0L && (surfaceTexture?.timestamp ?: 0L) >= frame.timestamp) {
            discardPresentation(); frame.done(null)
        } else postOnAnimation { acknowledgePresentation(frame) }
    }

    /** Evict obsolete textures, optionally preserving both sheets of the active scene. */
    fun clear(preserveScene: Boolean) {
        execute {
            val removed = textures.filterKeys { !preserveScene || (it != current && it != destination) }
            for ((key, id) in removed) { GL.glDeleteTextures(1, intArrayOf(id), 0); textures.remove(key) }
            if (!preserveScene) { current = null; destination = null; render() }
        }
    }

    /** Remove a captured texture only if its request is still the latest owner of that key. */
    fun drop(key: String, valid: () -> Boolean, done: () -> Unit) {
        execute {
            if (valid()) textures.remove(key)?.let { GL.glDeleteTextures(1, intArrayOf(it), 0) }
            main.post { done() }
        }
    }

    /** Render one textured sheet using the reusable mesh and explicit paper-side shading.
     * A spread sheet turns only its outer column; [back] is the spread its leaf lands on. */
    private fun drawPage(key: String?, p: Float, y: Float, spreadColumns: Int = 1, back: String? = null) {
        val texture = textures[key] ?: return
        val backTexture = back?.let { textures[it] }
        val count = mesh.build(pixelsWide, pixelsHigh, p, y, rtl, spreadColumns)
        if (count == 0) return
        buffer.position(0); buffer.put(mesh.vertices, 0, mesh.count); buffer.position(0)
        // A flat physical-pixel sheet must not blend adjacent text pixels.
        // Only the projected, moving leaf needs interpolation.
        val filter = if (p <= 0f) GL.GL_NEAREST else GL.GL_LINEAR
        GL.glUniform1f(spreadUniform, if (backTexture != null) 1f else 0f)
        if (backTexture != null) {
            GL.glActiveTexture(GL.GL_TEXTURE1)
            GL.glBindTexture(GL.GL_TEXTURE_2D, backTexture)
            GL.glTexParameteri(GL.GL_TEXTURE_2D, GL.GL_TEXTURE_MIN_FILTER, filter)
            GL.glTexParameteri(GL.GL_TEXTURE_2D, GL.GL_TEXTURE_MAG_FILTER, filter)
            GL.glActiveTexture(GL.GL_TEXTURE0)
        }
        GL.glBindTexture(GL.GL_TEXTURE_2D, texture)
        GL.glTexParameteri(GL.GL_TEXTURE_2D, GL.GL_TEXTURE_MIN_FILTER, filter)
        GL.glTexParameteri(GL.GL_TEXTURE_2D, GL.GL_TEXTURE_MAG_FILTER, filter)
        buffer.position(0); GL.glVertexAttribPointer(posAttribute, 2, GL.GL_FLOAT, false, 24, buffer)
        buffer.position(2); GL.glVertexAttribPointer(surfaceAttribute, 3, GL.GL_FLOAT, false, 24, buffer)
        buffer.position(5); GL.glVertexAttribPointer(shadeAttribute, 1, GL.GL_FLOAT, false, 24, buffer)
        GL.glDrawArrays(GL.GL_TRIANGLES, 0, count)
    }

    /** Draw both layers and submit the EGL buffer with a producer presentation timestamp. */
    private fun render(stamp: Long = System.nanoTime()) {
        if (!ready) return
        GL.glViewport(0, 0, pixelsWide, pixelsHigh)
        GL.glClearColor(0f, 0f, 0f, 0f)
        GL.glClear(GL.GL_COLOR_BUFFER_BIT or GL.GL_DEPTH_BUFFER_BIT)
        GL.glUseProgram(program)
        GL.glUniform2f(pageUniform, pixelsWide.toFloat(), pixelsHigh.toFloat())
        GL.glUniform1i(textureUniform, 0)
        GL.glUniform1i(backUniform, 1)
        GL.glFrontFace(if (rtl) GL.GL_CW else GL.GL_CCW)
        GL.glActiveTexture(GL.GL_TEXTURE0)
        val base = if (forward) destination else current
        val sheet = if (forward) current else destination
        val pose = if (forward) progress else 1f - progress
        drawPage(base, 0f, 0.5f)
        // A backward spread turn is the previous spread's forward turn, reversed.
        if (columns >= 2) drawPage(sheet, pose, grabY, columns, base)
        else drawPage(sheet, pose, grabY)
        check(EGLExt.eglPresentationTimeANDROID(display, eglSurface, stamp)) { "Cannot timestamp native paper frame" }
        check(EGL14.eglSwapBuffers(display, eglSurface)) { "Native paper frame could not be presented" }
    }

    /** Compile a GL shader and surface its compile diagnostic on failure. */
    private fun shader(type: Int, source: String): Int {
        val id = GL.glCreateShader(type)
        GL.glShaderSource(id, source); GL.glCompileShader(id)
        val status = IntArray(1); GL.glGetShaderiv(id, GL.GL_COMPILE_STATUS, status, 0)
        check(status[0] != 0) { GL.glGetShaderInfoLog(id) }
        return id
    }

    /** Initialize EGL and shader resources on the worker, then drain queued GL work. */
    override fun onSurfaceTextureAvailable(texture: SurfaceTexture, width: Int, height: Int) {
        worker.post {
            if (dead) return@post
            try {
            display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
            check(EGL14.eglInitialize(display, null, 0, null, 0))
            val configs = arrayOfNulls<EGLConfig>(1); val count = IntArray(1)
            val attrs = intArrayOf(EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
                EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8,
                EGL14.EGL_ALPHA_SIZE, 8, EGL14.EGL_DEPTH_SIZE, 16, EGL14.EGL_NONE)
            check(EGL14.eglChooseConfig(display, attrs, 0, configs, 0, 1, count, 0) && count[0] > 0)
            val config = configs[0]!!
            eglContext = EGL14.eglCreateContext(display, config, EGL14.EGL_NO_CONTEXT,
                intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0)
            windowSurface = Surface(texture)
            eglSurface = EGL14.eglCreateWindowSurface(display, config, windowSurface,
                intArrayOf(EGL14.EGL_NONE), 0)
            check(EGL14.eglMakeCurrent(display, eglSurface, eglSurface, eglContext))
            pixelsWide = width; pixelsHigh = height
            val precision = IntArray(1)
            GL.glGetShaderPrecisionFormat(GL.GL_FRAGMENT_SHADER, GL.GL_HIGH_FLOAT, IntArray(2), 0, precision, 0)
            val useHighPrecision = precision[0] > 0
            val vertex = shader(GL.GL_VERTEX_SHADER, if (useHighPrecision) VERTEX.replace("mediump", "highp") else VERTEX)
            val fragment = shader(GL.GL_FRAGMENT_SHADER, if (useHighPrecision) FRAGMENT.replace("mediump", "highp") else FRAGMENT)
            program = GL.glCreateProgram()
            GL.glAttachShader(program, vertex); GL.glAttachShader(program, fragment); GL.glLinkProgram(program)
            val status = IntArray(1); GL.glGetProgramiv(program, GL.GL_LINK_STATUS, status, 0)
            check(status[0] != 0) { GL.glGetProgramInfoLog(program) }
            GL.glDeleteShader(vertex); GL.glDeleteShader(fragment)
            pageUniform = GL.glGetUniformLocation(program, "uPage")
            textureUniform = GL.glGetUniformLocation(program, "uTex")
            backUniform = GL.glGetUniformLocation(program, "uBack")
            spreadUniform = GL.glGetUniformLocation(program, "uSpread")
            posAttribute = GL.glGetAttribLocation(program, "aPos")
            surfaceAttribute = GL.glGetAttribLocation(program, "aSurface")
            shadeAttribute = GL.glGetAttribLocation(program, "aShade")
            GL.glEnableVertexAttribArray(posAttribute); GL.glEnableVertexAttribArray(surfaceAttribute)
            GL.glEnableVertexAttribArray(shadeAttribute)
            GL.glEnable(GL.GL_DEPTH_TEST); GL.glDepthFunc(GL.GL_LEQUAL)
            GL.glEnable(GL.GL_BLEND); GL.glBlendFuncSeparate(GL.GL_SRC_ALPHA, GL.GL_ONE_MINUS_SRC_ALPHA, GL.GL_ONE, GL.GL_ONE_MINUS_SRC_ALPHA)
            ready = true
            val tasks = waiting.toList(); waiting.clear(); tasks.forEach { it() }
            render()
            } catch (error: Exception) { main.post { onFailure?.invoke(error) } }
        }
    }
    /** Schedule a redraw using the resized surface dimensions. */
    override fun onSurfaceTextureSizeChanged(texture: SurfaceTexture, width: Int, height: Int) {
        execute { pixelsWide = width; pixelsHigh = height; render() }
    }
    /** Leave acquisition acknowledgement to the timestamp and frame-commit barrier. */
    override fun onSurfaceTextureUpdated(texture: SurfaceTexture) {}
    /** Dispose worker resources while allowing TextureView to release its surface. */
    override fun onSurfaceTextureDestroyed(texture: SurfaceTexture): Boolean {
        worker.post { release() }; return true
    }
    /** Clear page identities and destroy EGL resources on the rendering worker. */
    private fun release() {
        ready = false; textures.clear(); current = null; destination = null
        if (display != EGL14.EGL_NO_DISPLAY) {
            EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
            EGL14.eglDestroySurface(display, eglSurface); EGL14.eglDestroyContext(display, eglContext)
            EGL14.eglTerminate(display)
        }
        windowSurface?.release(); windowSurface = null
        display = EGL14.EGL_NO_DISPLAY; eglContext = EGL14.EGL_NO_CONTEXT; eglSurface = EGL14.EGL_NO_SURFACE
    }
    /** Stop presentation callbacks and enqueue final worker resource cleanup. */
    fun dispose() {
        dead = true
        discardPresentation()
        worker.post {
            release(); waiting.clear()
            bitmaps.forEach { if (!it.isRecycled) it.recycle() }; bitmaps.clear()
            thread.quitSafely()
        }
    }

    companion object {
        private const val VERTEX = """
            attribute vec2 aPos; attribute vec3 aSurface; attribute float aShade;
            uniform mediump vec2 uPage;
            varying mediump vec2 vUv; varying mediump float vShade; varying mediump float vHeight;
            void main() {
              vUv=aPos; vShade=aShade; vHeight=aSurface.z;
              float depth=2.0*aSurface.z/(7.0*uPage.x);
              vec2 clip=aSurface.xy/uPage*2.0-1.0;
              gl_Position=vec4(clip.x,-clip.y+depth,-depth,1.0-depth);
            }
        """
        private const val FRAGMENT = """
            precision mediump float;
            uniform sampler2D uTex; uniform sampler2D uBack; uniform float uSpread; uniform mediump vec2 uPage;
            varying mediump vec2 vUv; varying mediump float vShade; varying mediump float vHeight;
            void main() {
              vec4 page=texture2D(uTex,vUv);
              float back=step(0.5,vShade);
              vec3 color=mix(page.rgb,mix(vec3(0.5),page.rgb,0.6),back);
              // A spread leaf's back is the facing column of the spread it lands on,
              // mirrored about the spine, so the landed leaf matches that page.
              if(uSpread>0.5 && back>0.5) { page=texture2D(uBack,vec2(1.0-vUv.x,vUv.y)); color=page.rgb; }
              color=mix(color,vec3(0.5),vShade-back);
              if(vHeight>10.0) {
                vec2 edge=min(vUv,1.0-vUv)*uPage/2.0;
                float border=clamp(1.0-min(edge.x,edge.y),0.0,1.0);
                color=mix(color,vec3(0.5),0.4*border);
              }
              gl_FragColor=vec4(color,page.a);
            }
        """
    }
}
