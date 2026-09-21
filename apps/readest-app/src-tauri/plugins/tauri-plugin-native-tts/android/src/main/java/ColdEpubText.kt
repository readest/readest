package com.readest.native_tts

import org.w3c.dom.Node
import java.io.ByteArrayInputStream
import java.io.File
import java.io.StringReader
import java.util.zip.ZipFile
import javax.xml.parsers.DocumentBuilderFactory
import org.xml.sax.InputSource

internal data class ColdEpubSpeech(
    val segments: List<ColdEpubSegment>,
    val startSection: Int,
)

internal data class ColdEpubSegment(
    val text: String,
    val sectionIndex: Int,
    val cfi: String,
)

/**
 * Small, service-safe EPUB text reader used only when Android Auto starts
 * playback before Readest's Activity/WebView exists. It deliberately avoids
 * the UI reader and returns bounded speech chunks for Android TextToSpeech.
 */
internal object ColdEpubText {
    private const val MAX_SEGMENT_CHARS = 2_500
    private val blockElements = setOf(
        "address", "article", "aside", "blockquote", "br", "div", "figcaption", "footer",
        "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav",
        "p", "pre", "section", "table", "td", "th", "tr",
    )

    fun read(file: File, resumeCfi: String?): ColdEpubSpeech = ZipFile(file).use { zip ->
        val container = zip.getInputStream(
            zip.getEntry("META-INF/container.xml")
                ?: error("EPUB is missing META-INF/container.xml"),
        ).readBytes()
        val containerDoc = parseXml(container)
        val rootfiles = containerDoc.getElementsByTagNameNS("*", "rootfile")
        val opfPath = (0 until rootfiles.length)
            .asSequence()
            .map { rootfiles.item(it) }
            .mapNotNull { it.attributes?.getNamedItem("full-path")?.nodeValue }
            .firstOrNull()
            ?: error("EPUB container has no rootfile")
        val opfEntry = zip.getEntry(opfPath) ?: error("EPUB package document is missing")
        val opfDoc = parseXml(zip.getInputStream(opfEntry).readBytes())

        val manifest = mutableMapOf<String, String>()
        val items = opfDoc.getElementsByTagNameNS("*", "item")
        for (index in 0 until items.length) {
            val item = items.item(index)
            val id = item.attributes?.getNamedItem("id")?.nodeValue ?: continue
            val href = item.attributes?.getNamedItem("href")?.nodeValue ?: continue
            manifest[id] = resolveZipPath(opfPath.substringBeforeLast('/', ""), href)
        }

        val spinePaths = buildList {
            val itemRefs = opfDoc.getElementsByTagNameNS("*", "itemref")
            for (index in 0 until itemRefs.length) {
                val idref = itemRefs.item(index).attributes?.getNamedItem("idref")?.nodeValue ?: continue
                manifest[idref]?.let(::add)
            }
        }
        require(spinePaths.isNotEmpty()) { "EPUB spine is empty" }

        val startSection = spineIndexFromCfi(resumeCfi).coerceIn(0, spinePaths.lastIndex)
        val segments = buildList {
            for (sectionIndex in startSection..spinePaths.lastIndex) {
                val entry = zip.getEntry(spinePaths[sectionIndex]) ?: continue
                val sectionCfi = "epubcfi(/6/${(sectionIndex + 1) * 2})"
                val sectionResumeCfi = resumeCfi.takeIf { sectionIndex == startSection }
                addAll(
                    extractSegments(zip.getInputStream(entry).readBytes(), sectionResumeCfi).map {
                        val cfi = it.localCfi?.let { local -> "${sectionCfi.dropLast(1)}!$local)" }
                            ?: sectionResumeCfi ?: sectionCfi
                        ColdEpubSegment(it.text, sectionIndex, cfi)
                    }
                )
            }
        }
        ColdEpubSpeech(segments, startSection)
    }

    internal fun spineIndexFromCfi(cfi: String?): Int {
        val packageStep = Regex("""epubcfi\(/6/(\d+)""").find(cfi.orEmpty())
            ?.groupValues
            ?.getOrNull(1)
            ?.toIntOrNull()
            ?: return 0
        return (packageStep / 2 - 1).coerceAtLeast(0)
    }

    private data class TextRun(val node: Node, val start: Int, val end: Int)
    private data class TextSegment(val text: String, val localCfi: String?)

    private fun extractSegments(bytes: ByteArray, resumeCfi: String?): List<TextSegment> {
        val runs = mutableListOf<TextRun>()
        var resumeOffset: Int
        val text = try {
            val document = parseXml(bytes)
            val body = document.getElementsByTagNameNS("*", "body").item(0) ?: document.documentElement
            val anchor = resumeCfi?.let { resolveLocalCfi(document.documentElement, it) }
            val output = StringBuilder()
            val anchorOffset = intArrayOf(-1)
            appendNodeText(body, output, anchor, anchorOffset, runs)
            resumeOffset = anchorOffset[0].coerceAtLeast(0)
            output.toString()
        } catch (_: Exception) {
            // EPUB requires XHTML, but tolerate old books with HTML-ish markup.
            runs.clear()
            resumeOffset = 0
            bytes.toString(Charsets.UTF_8)
                .replace(Regex("(?is)<(script|style|svg|math)[^>]*>.*?</\\1>"), " ")
                .replace(Regex("(?i)<br\\s*/?>|</?(p|div|li|h[1-6]|section|article|tr)[^>]*>"), "\n")
                .replace(Regex("(?s)<[^>]+>"), " ")
                .replace("&nbsp;", " ")
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
        }
        return buildList {
            var lineOffset = resumeOffset
            for (line in text.substring(resumeOffset).split('\n')) {
                val normalized = StringBuilder()
                val offsets = IntArray(line.length)
                for (word in Regex("\\S+").findAll(line)) {
                    if (normalized.isNotEmpty()) {
                        offsets[normalized.length] = lineOffset + word.range.first - 1
                        normalized.append(' ')
                    }
                    for (index in word.range) {
                        offsets[normalized.length] = lineOffset + index
                        normalized.append(line[index])
                    }
                }
                var chunkOffset = 0
                if (normalized.isNotEmpty()) {
                    val normalizedText = normalized.toString()
                    for (chunk in splitLongSegment(normalizedText)) {
                        val start = normalizedText.indexOf(chunk, chunkOffset)
                        val sourceOffset = offsets[start]
                        val runIndex = runs.binarySearch {
                            when {
                                sourceOffset < it.start -> 1
                                sourceOffset >= it.end -> -1
                                else -> 0
                            }
                        }
                        val run = runs.getOrNull(runIndex)
                        val cfi = run?.let { localCfi(it.node, sourceOffset - it.start) }
                        add(TextSegment(chunk, cfi))
                        chunkOffset = start + chunk.length
                    }
                }
                lineOffset += line.length + 1
            }
        }
    }

    // Use the same odd text slots as the resolver, including adjacent text /
    // CDATA nodes. Offsets refer to the original DOM, before speech whitespace
    // normalization or long-chunk splitting.
    private fun localCfi(textNode: Node, textOffset: Int): String {
        var node = textNode
        var offset = textOffset
        val steps = mutableListOf<Int>()
        while (node.parentNode?.nodeType == Node.ELEMENT_NODE) {
            val parent = node.parentNode
            val children = indexCfiChildren(parent)
            val index = children.indexOfFirst {
                it === node || (it is List<*> && it.any { child -> child === node })
            }
            val slot = children[index]
            if (slot is List<*>) {
                offset += slot.takeWhile { it !== node }.sumOf { (it as Node).nodeValue?.length ?: 0 }
            }
            steps.add(index)
            node = parent
        }
        return steps.asReversed().joinToString("", postfix = ":$offset") { "/$it" }
    }

    private fun splitLongSegment(text: String): Sequence<String> = sequence {
        if (text.length <= MAX_SEGMENT_CHARS) {
            yield(text)
            return@sequence
        }
        var pending = StringBuilder()
        for (sentence in text.split(Regex("(?<=[.!?])\\s+"))) {
            if (pending.isNotEmpty() && pending.length + sentence.length + 1 > MAX_SEGMENT_CHARS) {
                yield(pending.toString())
                pending = StringBuilder()
            }
            if (sentence.length > MAX_SEGMENT_CHARS) {
                if (pending.isNotEmpty()) {
                    yield(pending.toString())
                    pending = StringBuilder()
                }
                for (chunk in sentence.chunked(MAX_SEGMENT_CHARS)) yield(chunk)
            } else {
                if (pending.isNotEmpty()) pending.append(' ')
                pending.append(sentence)
            }
        }
        if (pending.isNotEmpty()) yield(pending.toString())
    }

    private data class TextAnchor(val node: Node, val offset: Int)

    private fun appendNodeText(
        node: Node,
        output: StringBuilder,
        anchor: TextAnchor?,
        anchorOffset: IntArray,
        runs: MutableList<TextRun>,
    ) {
        if (anchorOffset[0] < 0 && node === anchor?.node) {
            anchorOffset[0] = output.length + if (
                node.nodeType == Node.TEXT_NODE || node.nodeType == Node.CDATA_SECTION_NODE
            ) {
                anchor.offset.coerceIn(0, node.nodeValue?.length ?: 0)
            } else {
                0
            }
        }
        when (node.nodeType) {
            Node.TEXT_NODE, Node.CDATA_SECTION_NODE -> {
                val start = output.length
                output.append(node.nodeValue)
                runs.add(TextRun(node, start, output.length))
            }
            Node.ELEMENT_NODE -> {
                val name = (node.localName ?: node.nodeName).lowercase()
                if (name in setOf("script", "style", "svg", "math")) return
                if (name in blockElements) output.append('\n')
                val children = node.childNodes
                for (index in 0 until children.length) {
                    appendNodeText(children.item(index), output, anchor, anchorOffset, runs)
                }
                if (name in blockElements) output.append('\n')
            }
        }
    }

    /**
     * Resolve the content-document half of a Readest/foliate EPUB CFI. EPUB
     * CFI numbers both elements and the text chunks between them; adjacent
     * text nodes therefore share one odd-numbered slot. This mirrors that
     * indexing closely enough to resume cold speech at the saved page/text
     * offset instead of only at the beginning of its spine section.
     */
    private fun resolveLocalCfi(root: Node, cfi: String): TextAnchor? {
        val local = cfi.substringAfterLast('!', "")
            .removeSuffix(")")
            .takeIf { it.isNotBlank() }
            ?: return null
        val rangeParts = splitUnescaped(local, ',')
        val collapsedStart = if (rangeParts.size >= 2) rangeParts[0] + rangeParts[1] else local
        val steps = Regex("""/(\d+)(?:\[(?:\^.|[^]])*])?(?::(\d+))?""")
            .findAll(collapsedStart)
            .map { match ->
                match.groupValues[1].toInt() to match.groupValues[2].toIntOrNull()
            }
            .toList()
        if (steps.isEmpty()) return null

        var current: Any? = root
        for ((index, _) in steps) {
            val node = current as? Node ?: return null
            current = indexCfiChildren(node).getOrNull(index) ?: return null
            when (current) {
                CfiBoundary.FIRST -> current = node.firstChild ?: node
                CfiBoundary.LAST -> current = node.lastChild ?: node
                CfiBoundary.BEFORE, CfiBoundary.AFTER -> current = node
            }
        }

        val offset = steps.last().second ?: 0
        if (current is Node) return TextAnchor(current, offset)
        @Suppress("UNCHECKED_CAST")
        val textNodes = current as? List<Node> ?: return null
        var consumed = 0
        for (node in textNodes) {
            val length = node.nodeValue?.length ?: 0
            if (consumed + length >= offset) {
                return TextAnchor(node, offset - consumed)
            }
            consumed += length
        }
        return textNodes.lastOrNull()?.let { TextAnchor(it, it.nodeValue?.length ?: 0) }
    }

    private enum class CfiBoundary { BEFORE, FIRST, LAST, AFTER }

    private fun indexCfiChildren(node: Node): List<Any?> {
        val raw = buildList<Node> {
            val children = node.childNodes
            for (index in 0 until children.length) {
                val child = children.item(index)
                if (
                    child.nodeType == Node.ELEMENT_NODE ||
                    child.nodeType == Node.TEXT_NODE ||
                    child.nodeType == Node.CDATA_SECTION_NODE
                ) {
                    add(child)
                }
            }
        }
        val indexed = mutableListOf<Any?>()
        for (child in raw) {
            val last = indexed.lastOrNull()
            val isText = child.nodeType == Node.TEXT_NODE || child.nodeType == Node.CDATA_SECTION_NODE
            when {
                indexed.isEmpty() -> indexed.add(child)
                isText && last is List<*> -> {
                    @Suppress("UNCHECKED_CAST")
                    indexed[indexed.lastIndex] = (last as List<Node>) + child
                }
                isText && last is Node &&
                    (last.nodeType == Node.TEXT_NODE || last.nodeType == Node.CDATA_SECTION_NODE) ->
                    indexed[indexed.lastIndex] = listOf(last, child)
                isText -> indexed.add(child)
                last is Node && last.nodeType == Node.ELEMENT_NODE -> {
                    indexed.add(null)
                    indexed.add(child)
                }
                else -> indexed.add(child)
            }
        }
        if ((indexed.firstOrNull() as? Node)?.nodeType == Node.ELEMENT_NODE) {
            indexed.add(0, CfiBoundary.FIRST)
        }
        if ((indexed.lastOrNull() as? Node)?.nodeType == Node.ELEMENT_NODE) {
            indexed.add(CfiBoundary.LAST)
        }
        indexed.add(0, CfiBoundary.BEFORE)
        indexed.add(CfiBoundary.AFTER)
        return indexed
    }

    private fun splitUnescaped(value: String, delimiter: Char): List<String> {
        val result = mutableListOf<String>()
        var escaped = false
        var bracketDepth = 0
        var start = 0
        value.forEachIndexed { index, char ->
            when {
                escaped -> escaped = false
                char == '^' -> escaped = true
                char == '[' -> bracketDepth += 1
                char == ']' && bracketDepth > 0 -> bracketDepth -= 1
                char == delimiter && bracketDepth == 0 -> {
                    result.add(value.substring(start, index))
                    start = index + 1
                }
            }
        }
        result.add(value.substring(start))
        return result
    }

    private fun parseXml(bytes: ByteArray) = DocumentBuilderFactory.newInstance().apply {
        isNamespaceAware = true
        isExpandEntityReferences = false
        setFeatureIfSupported("http://xml.org/sax/features/external-general-entities", false)
        setFeatureIfSupported("http://xml.org/sax/features/external-parameter-entities", false)
        setFeatureIfSupported("http://apache.org/xml/features/nonvalidating/load-external-dtd", false)
    }.newDocumentBuilder().apply {
        setEntityResolver { _, _ -> InputSource(StringReader("")) }
    }.parse(ByteArrayInputStream(withoutDoctype(bytes)))

    private fun DocumentBuilderFactory.setFeatureIfSupported(name: String, enabled: Boolean) {
        try {
            setFeature(name, enabled)
        } catch (_: Exception) {
            // Android's Harmony parser supports fewer feature flags than the
            // desktop JAXP implementation. The explicit resolver and DOCTYPE
            // removal below keep external entities disabled on both runtimes.
        }
    }

    private fun withoutDoctype(bytes: ByteArray): ByteArray {
        val xml = bytes.toString(Charsets.UTF_8)
        val start = xml.indexOf("<!DOCTYPE", ignoreCase = true)
        if (start < 0) return bytes

        var quote: Char? = null
        var subsetDepth = 0
        for (index in start + 9 until xml.length) {
            val char = xml[index]
            if (quote != null) {
                if (char == quote) quote = null
                continue
            }
            when (char) {
                '\'', '"' -> quote = char
                '[' -> subsetDepth += 1
                ']' -> if (subsetDepth > 0) subsetDepth -= 1
                '>' -> if (subsetDepth == 0) {
                    return xml.removeRange(start, index + 1).toByteArray(Charsets.UTF_8)
                }
            }
        }
        error("XML contains an unterminated DOCTYPE")
    }

    private fun resolveZipPath(base: String, href: String): String {
        val decoded = try {
            java.net.URI(href).path ?: href
        } catch (_: Exception) {
            href
        }
        val parts = ArrayDeque<String>()
        for (part in listOf(base, decoded).filter { it.isNotEmpty() }.joinToString("/").split('/')) {
            when (part) {
                "", "." -> Unit
                ".." -> if (parts.isNotEmpty()) parts.removeLast()
                else -> parts.addLast(part)
            }
        }
        return parts.joinToString("/")
    }
}
