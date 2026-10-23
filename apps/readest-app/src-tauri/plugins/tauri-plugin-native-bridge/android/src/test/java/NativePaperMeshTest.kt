package com.readest.native_bridge

import org.junit.Assert.*
import org.junit.Test

class NativePaperMeshTest {
    @Test fun matchesTheVerifiedBrowserMesh() {
        val lines = javaClass.getResourceAsStream("/native-paper-mesh.txt")!!.bufferedReader().readLines()
        val expected = lines[1].split(',').map { it.toFloat() }
        val mesh = NativePaperMesh()
        mesh.build(360, 780, 0.42f, 0.83f, false)
        assertEquals(expected.size, mesh.count)
        for (i in expected.indices) {
            val value = if (i % 6 == 5) mesh.vertices[i] % 1f else mesh.vertices[i]
            assertEquals("vertex component $i", expected[i], value, 0.002f)
        }
    }

    @Test fun matchesTheVerifiedBrowserSpreadMesh() {
        val lines = javaClass.getResourceAsStream("/native-paper-mesh-spread.txt")!!.bufferedReader().readLines()
        val expected = lines[1].split(',').map { it.toFloat() }
        val mesh = NativePaperMesh()
        mesh.build(360, 780, 0.42f, 0.83f, false, 2)
        assertEquals(expected.size, mesh.count)
        for (i in expected.indices) {
            val value = if (i % 6 == 5) mesh.vertices[i] % 1f else mesh.vertices[i]
            assertEquals("vertex component $i", expected[i], value, 0.002f)
        }
    }

    @Test fun landsTheSpreadLeafAsTheMirrorOfItsColumn() {
        val mesh = NativePaperMesh()
        for (rtl in listOf(false, true)) {
            mesh.build(360, 780, 1f, 0.5f, rtl, 2)
            assertTrue(mesh.count > 0)
            for (i in 0 until mesh.count step 6) {
                val u = mesh.vertices[i]; val x = mesh.vertices[i + 2]
                val leaf = if (rtl) u < 0.5f else u > 0.5f
                if (leaf) {
                    // The landed leaf lies on the facing column, back side up.
                    assertEquals(360f - u * 360f, x, 0.01f)
                    assertTrue(mesh.vertices[i + 5] >= 1f)
                } else if (u != 0.5f) {
                    assertEquals(u * 360f, x, 0.01f)
                    assertTrue(mesh.vertices[i + 5] < 1f)
                }
                assertEquals(0f, mesh.vertices[i + 4], 0.0001f)
            }
        }
    }

    @Test fun preservesFlatPixelsAndClearsTheFinishedLeaf() {
        val mesh = NativePaperMesh()
        assertEquals(6, mesh.build(360, 780, 0f, 0.5f, false))
        for (i in 0 until mesh.count step 6) {
            assertEquals(mesh.vertices[i] * 360, mesh.vertices[i + 2], 0.001f)
            assertEquals(mesh.vertices[i + 1] * 780, mesh.vertices[i + 3], 0.001f)
            assertEquals(0f, mesh.vertices[i + 4], 0f)
            assertEquals(0f, mesh.vertices[i + 5], 0f)
        }
        assertEquals(0, mesh.build(360, 780, 1f, 0.5f, false))
    }

    @Test fun identifiesTheBackOfEveryProjectedTriangle() {
        val mesh = NativePaperMesh()
        mesh.build(360, 780, 0.6f, 0.5f, false)
        assertTrue((5 until mesh.count step 6).any { mesh.vertices[it] >= 1f })
        for (i in 0 until mesh.count step 18) {
            val back = mesh.vertices[i + 5] >= 1f
            assertEquals(back, mesh.vertices[i + 11] >= 1f)
            assertEquals(back, mesh.vertices[i + 17] >= 1f)
        }
    }

    @Test fun mirrorsTheSameSpineWithoutChangingVerticalGeometry() {
        val mesh = NativePaperMesh()
        mesh.build(360, 780, 0.4f, 0.8f, false)
        val left = mesh.vertices.copyOf(mesh.count)
        mesh.build(360, 780, 0.4f, 0.8f, true)
        assertEquals(left.size, mesh.count)
        for (i in left.indices step 6) {
            assertEquals(1f - left[i], mesh.vertices[i], 0.0001f)
            assertEquals(360f - left[i + 2], mesh.vertices[i + 2], 0.001f)
            assertEquals(left[i + 3], mesh.vertices[i + 3], 0f)
            assertEquals(left[i + 4], mesh.vertices[i + 4], 0f)
        }
    }

    @Test fun reusesBoundedStorageAcrossAllPoses() {
        val mesh = NativePaperMesh()
        val storage = mesh.vertices
        for (step in 0..100) {
            mesh.build(1080, 2340, step / 100f, 0.5f + step / 100f, false)
            assertSame(storage, mesh.vertices)
            assertTrue(mesh.count <= storage.size)
            for (i in 0 until mesh.count) assertTrue(mesh.vertices[i].isFinite())
        }
    }
}
