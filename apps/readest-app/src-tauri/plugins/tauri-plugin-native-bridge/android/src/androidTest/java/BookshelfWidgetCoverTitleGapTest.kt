package com.readest.native_bridge

import android.graphics.Bitmap
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.RemoteViews
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Measures a real cell from the production widget_bookshelf.xml (spacer,
 * cover, cover_title, title, spacer) to verify: the title is never clipped
 * even when the cell is shorter than the cover's natural aspect-ratio size,
 * the two flanking spacers split leftover height evenly, and the title
 * reservation margin doesn't cost any height when titles are off.
 */
@RunWith(AndroidJUnit4::class)
class BookshelfWidgetCoverTitleGapTest {
    private data class Bounds(
        val cellTop: Int, val cellBottom: Int, val cellWidth: Int,
        val topSpacerHeight: Int, val bottomSpacerHeight: Int,
        val coverTop: Int, val coverBottom: Int, val coverWidth: Int,
        val titleTop: Int, val titleBottom: Int,
    ) {
        override fun toString() =
            "cell=[$cellTop,$cellBottom]w=$cellWidth top=$topSpacerHeight bottom=$bottomSpacerHeight " +
                "cover=[$coverTop,$coverBottom]w=$coverWidth title=[$titleTop,$titleBottom]"
    }

    private fun absoluteY(view: View, stopAt: View): Int {
        var v = view
        var y = 0
        while (v !== stopAt) {
            y += v.top
            v = v.parent as View
        }
        return y
    }

    private fun measureAt(widthPx: Int, heightPx: Int, showTitles: Boolean): Bounds {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val host = FrameLayout(context)
        val root = RemoteViews(context.packageName, R.layout.widget_bookshelf).apply(context, host)

        // Hide everything except the single cell under test, so it gets the
        // grid's entire width/height (matching "only 1 configured row/col").
        listOf(R.id.heading, R.id.tts_bar, R.id.empty).forEach {
            root.findViewById<View>(it)?.visibility = View.GONE
        }
        for (r in 0..4) {
            for (c in 0..4) {
                if (r == 0 && c == 0) continue
                val id = context.resources.getIdentifier("cell_${r}_$c", "id", context.packageName)
                root.findViewById<View>(id)?.visibility = View.GONE
            }
        }

        val cellGroup = root.findViewById<ViewGroup>(R.id.cell_0_0)
        val cover = root.findViewById<ImageView>(R.id.cover_0_0)
        val coverWithTitle = root.findViewById<ImageView>(R.id.cover_title_0_0)
        val title = root.findViewById<TextView>(R.id.title_0_0)
        val bitmap = Bitmap.createBitmap(200, 300, Bitmap.Config.ARGB_8888) // 2:3 portrait
        cover.setImageBitmap(bitmap)
        coverWithTitle.setImageBitmap(bitmap)
        title.text = "A Sample Book Title"

        // Same visibility toggling updateWidget performs based on showTitles.
        if (showTitles) {
            cover.visibility = View.GONE
            coverWithTitle.visibility = View.VISIBLE
            title.visibility = View.VISIBLE
        } else {
            cover.visibility = View.VISIBLE
            coverWithTitle.visibility = View.GONE
            title.visibility = View.GONE
        }

        val widthSpec = View.MeasureSpec.makeMeasureSpec(widthPx, View.MeasureSpec.EXACTLY)
        val heightSpec = View.MeasureSpec.makeMeasureSpec(heightPx, View.MeasureSpec.EXACTLY)
        root.measure(widthSpec, heightSpec)
        root.layout(0, 0, widthPx, heightPx)

        val activeCover = if (showTitles) coverWithTitle else cover
        val topSpacer = cellGroup.getChildAt(0)
        val bottomSpacer = cellGroup.getChildAt(cellGroup.childCount - 1)

        return Bounds(
            cellTop = absoluteY(cellGroup, root),
            cellBottom = absoluteY(cellGroup, root) + cellGroup.height,
            cellWidth = cellGroup.width,
            topSpacerHeight = topSpacer.height,
            bottomSpacerHeight = bottomSpacer.height,
            coverTop = absoluteY(activeCover, root),
            coverBottom = absoluteY(activeCover, root) + activeCover.height,
            coverWidth = activeCover.width,
            titleTop = if (showTitles) absoluteY(title, root) else -1,
            titleBottom = if (showTitles) absoluteY(title, root) + title.height else -1,
        )
    }

    @Test
    fun titleIsNeverClipped() {
        // Width 1080 x height 300 makes the cover's natural aspect-ratio
        // height (~1.5x width) far exceed the cell - a severe squeeze, the
        // exact scenario that used to clip the title off the bottom of the
        // cell. 324x481 is measured off an actual placed widget (2 rows x 3
        // cols in ~972x963px) as a realistic sanity check.
        for ((label, bounds) in listOf(
            "squeezed" to measureAt(1080, 300, showTitles = true),
            "realistic" to measureAt(324, 481, showTitles = true),
        )) {
            assertTrue(
                "$label: title should have real, nonzero height: $bounds",
                bounds.titleBottom > bounds.titleTop
            )
            assertTrue(
                "$label: title should be fully within the cell's bounds, not clipped: $bounds",
                bounds.titleTop >= bounds.cellTop && bounds.titleBottom <= bounds.cellBottom
            )
        }
    }

    @Test
    fun spacersSplitLeftoverHeightEvenlyWhenThereSGenuineSlack() {
        val roomy = measureAt(324, 2000, showTitles = true)
        assertTrue(
            "top/bottom spacer space should be balanced (within a couple px of rounding): $roomy",
            kotlin.math.abs(roomy.topSpacerHeight - roomy.bottomSpacerHeight) <= 2
        )
        assertTrue(
            "there should be genuine leftover space to split in this roomy case: $roomy",
            roomy.topSpacerHeight > 100
        )
    }

    @Test
    fun coverUsesTheFullAvailableHeightWhenTitlesAreOff() {
        // A squeeze scenario, so the cover is definitely clamped - only then
        // does the reservation margin actually reduce its budget. At
        // realistic/roomy proportions neither cover is clamped, so both
        // would come out identical - not a useful comparison.
        val withTitles = measureAt(1080, 300, showTitles = true)
        val withoutTitles = measureAt(1080, 300, showTitles = false)
        val coverHeightWithTitles = withTitles.coverBottom - withTitles.coverTop
        val coverHeightWithoutTitles = withoutTitles.coverBottom - withoutTitles.coverTop
        assertTrue(
            "cover should be taller without the title reservation: withTitles=$withTitles " +
                "withoutTitles=$withoutTitles",
            coverHeightWithoutTitles > coverHeightWithTitles
        )
    }
}
