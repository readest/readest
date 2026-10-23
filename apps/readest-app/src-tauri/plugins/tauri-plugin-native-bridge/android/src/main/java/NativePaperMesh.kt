package com.readest.native_bridge

import kotlin.math.*

/** Reusable clipped 64-hinge mesh. No per-frame vertex/polygon allocations. */
internal class NativePaperMesh {
    val vertices = FloatArray(8192)
    var count = 0
        private set
    private val rect = DoubleArray(16)
    private val inner = DoubleArray(8)
    private val a = DoubleArray(16)
    private val b = DoubleArray(16)
    private var width = 1.0
    private var height = 1.0
    // A spread turns only its outer column; [origin, width] is that leaf.
    private var origin = 0.0
    private var nx = 1.0
    private var ny = 0.0
    private var fold = 0.0
    private var step = 0.0
    private var rtl = false
    private val angle = PI / 65
    private val sinHalf = sin(angle / 2)
    private val cosines = DoubleArray(65) { cos(it * angle) }
    private val sines = DoubleArray(65) { sin(it * angle) }
    private val sumX = DoubleArray(65) { sin(it * angle / 2) / sinHalf * cos((it * angle - angle) / 2) }
    private val sumZ = DoubleArray(65) { sin(it * angle / 2) / sinHalf * sin((it * angle - angle) / 2) }

    /** Measure signed distance from a source point to the current fold line. */
    private fun distance(x: Double, y: Double) = (x - fold) * nx + (y - height / 2) * ny

    /** Clip a polygon to one side of a hinge using preallocated coordinate storage. */
    private fun clip(input: DoubleArray, size: Int, edge: Double, above: Boolean, output: DoubleArray): Int {
        var n = 0
        for (i in 0 until size) {
            val j = (i + 1) % size
            val ax = input[i * 2]; val ay = input[i * 2 + 1]
            val bx = input[j * 2]; val by = input[j * 2 + 1]
            val da = distance(ax, ay) - edge; val db = distance(bx, by) - edge
            val ia = if (above) da >= 0 else da <= 0
            val ib = if (above) db >= 0 else db <= 0
            if (ia) { output[n * 2] = ax; output[n * 2 + 1] = ay; n++ }
            if (ia != ib) {
                val t = da / (da - db)
                output[n * 2] = ax + (bx - ax) * t
                output[n * 2 + 1] = ay + (by - ay) * t
                n++
            }
        }
        return n
    }

    /** Project a source point through the hinge rotations and append its textured vertex. */
    private fun vertex(x: Double, y: Double, deform: Boolean) {
        val sourceX = origin + x
        var px = sourceX; var py = y; var z = 0.0; var shade = 0.0
        val s = distance(x, y)
        if (deform && s > 0 && step < 1e-6) {
            // A spread leaf with no bend left lies flat on the facing column.
            px -= 2 * s * nx; py -= 2 * s * ny
        } else if (deform && s > 0) {
            val band = min(64, floor(s / step + 1e-7).toInt())
            val remainder = s - band * step
            val bentX = step * sumX[band] + remainder * cosines[band]
            z = step * sumZ[band] + remainder * sines[band]
            px -= (s - bentX) * nx
            py -= (s - bentX) * ny
            shade = max(0.0, 0.25 - abs(0.25 - min(64.0, s / step) / 128))
        }
        vertices[count++] = ((if (rtl) width - sourceX else sourceX) / width).toFloat()
        vertices[count++] = (y / height).toFloat()
        vertices[count++] = (if (rtl) width - px else px).toFloat()
        vertices[count++] = py.toFloat()
        vertices[count++] = z.toFloat()
        vertices[count++] = shade.toFloat()
    }

    /** Triangulate a clipped polygon and preserve the face identity for shading. */
    private fun emit(polygon: DoubleArray, size: Int, deform: Boolean) {
        for (i in 1 until size - 1) {
            vertex(polygon[0], polygon[1], deform)
            vertex(polygon[i * 2], polygon[i * 2 + 1], deform)
            vertex(polygon[(i + 1) * 2], polygon[(i + 1) * 2 + 1], deform)
            // Classify the projected triangle explicitly. This also avoids
            // driver-dependent gl_FrontFacing on Android window surfaces.
            val base = count - 18
            fun projected(index: Int, vertical: Boolean): Double {
                val depth = 2.0 * vertices[index + 4] / (7.0 * width)
                return if (vertical) (vertices[index + 3] - height / 2 - depth * height / 2) / (1 - depth)
                    else (vertices[index + 2] - width / 2) / (1 - depth)
            }
            val ax = projected(base, false); val ay = projected(base, true)
            val bx = projected(base + 6, false); val by = projected(base + 6, true)
            val cx = projected(base + 12, false); val cy = projected(base + 12, true)
            val area = ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) * (if (rtl) -1 else 1)
            if (area < 0) {
                vertices[base + 5] += 1f; vertices[base + 11] += 1f; vertices[base + 17] += 1f
            }
        }
    }

    /** Build the current fold into reusable vertex storage and return the vertex count. */
    fun build(w: Int, h: Int, progress: Float, grabY: Float, mirrored: Boolean, columns: Int = 1): Int {
        width = w.toDouble(); height = h.toDouble(); rtl = mirrored; count = 0
        val p = progress.coerceIn(0f, 1f).toDouble()
        val spread = columns >= 2
        if (!spread && p >= 1) return 0
        val leaf = if (spread) width / 2 else width
        origin = width - leaf
        val slope = (0.2 - 2 * (grabY - 0.5)) * (1 - p)
        val norm = hypot(1.0, slope)
        nx = 1 / norm; ny = slope / norm
        // A spread leaf tightens to nothing so it lands flat on the facing column.
        val bend = leaf * 0.7 * (if (spread) 1 - p * p else 1.0)
        fold = leaf - (leaf + bend) * p
        step = bend / 64 / norm
        rect[0] = 0.0; rect[1] = 0.0
        rect[2] = leaf; rect[3] = 0.0
        rect[4] = leaf; rect[5] = height
        rect[6] = 0.0; rect[7] = height
        if (spread) {
            inner[0] = -origin; inner[1] = 0.0
            inner[2] = 0.0; inner[3] = 0.0
            inner[4] = 0.0; inner[5] = height
            inner[6] = -origin; inner[7] = height
            emit(inner, 4, false)
        }
        if (p <= 0) { emit(rect, 4, false); return count / 6 }
        if (step < 1e-6) { emit(rect, 4, true); return count / 6 }
        emit(a, clip(rect, 4, 0.0, false, a), true)
        for (band in 0 until 64) {
            val n = clip(rect, 4, band * step, true, a)
            emit(b, clip(a, n, (band + 1) * step, false, b), true)
        }
        emit(a, clip(rect, 4, 64 * step, true, a), true)
        return count / 6
    }
}
