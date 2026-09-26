// batcave.biz — a DataLife Engine (DLE)-based comics site protected by both
// Cloudflare AND a site-specific "DLE Guard" gate (its own redirect to a
// /_c/... challenge page, separate from Cloudflare's own interstitial —
// confirmed by reading the real, actively-maintained Tachiyomi/Mihon
// extension source, github.com/keiyoushi/extensions-source/tree/main/src/en/batcave,
// since a plain fetch() against the site returns a Cloudflare "Just a
// moment..." page even for the homepage). Both gates work the same way as
// every other Cloudflare-style challenge in this app: solve once with the
// module's own shield button (a real WKWebView, sets a cookie), and
// fetch/fetchv2 carry that cookie + the WebView's own User-Agent on every
// request afterward. No auto-solve — same rule as everywhere else in Hoshi.
//
// Chapter list: the comic's own page embeds its full chapter list as JSON
// in a `window.__DATA__ = {...};` <script> tag (news_id, chapters[{id,
// posi, title, date}], xhash) — read directly from there instead of
// scraping a list of <a> tags, since that's what the site's own JS uses
// too. Reader URL shape: /reader/<news_id>/<chapter.id><xhash>.
//
// Pages: the reader page itself doesn't embed the images — they're fetched
// client-side via a POST to /engine/ajax/controller.php?mod=api&action=
// reader/getChapterData with a {news_id, chapter_id} JSON body, returning
// {data: {images: [...]}}. chapter_id here is only the leading digits of
// the reader URL's second path segment (the xhash suffix stripped off).
//
// Sec-Fetch-* headers: the official Kotlin extension's `configureHeaders()`
// sets these on every request, making programmatic calls look like a real
// browser's top-level page load rather than an XHR — kept here to match it.
//
// Page IMAGES needed a separate fix outside this file entirely: the site's
// image CDN (img.batcave.biz) 403s any request with no Referer header,
// confirmed live by comparing the exact same image request with and
// without one. A JS module has no way to attach a header to the actual
// image request the reader makes (extractPages only returns plain URL
// strings) — that fix lives in CloudflareRequestPreparer.prepare()
// (Hoshi/Modules/CloudflareChallengeSolver.swift), which now defaults
// Referer to the request's own registrable domain when none is set,
// covering every page image this or any other module returns.

const baseUrl = "https://batcave.biz";

const DEFAULT_HEADERS = {
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1"
};

async function searchResults(keyword) {
    try {
        const url = `${baseUrl}/search/${encodeURIComponent(keyword)}/`;
        const response = await fetchv2(url, DEFAULT_HEADERS);
        const html = await response.text();

        const results = [];
        // Each result card is a ".readed" block: a lazy-loaded cover image
        // (data-src, not src) followed by a ".readed__title" link with the
        // real title and href.
        const cardRegex = /class="readed[ "][\s\S]*?data-src="([^"]+)"[\s\S]*?class="readed__title"[^>]*>\s*<a href="([^"]+)"[^>]*>([^<]*)<\/a>/g;
        let match;
        while ((match = cardRegex.exec(html)) !== null) {
            const title = htmlEntityDecode(normalizeWhitespace(match[3]));
            if (!title) continue;
            results.push({ title, image: match[1], href: match[2] });
        }
        return JSON.stringify(results);
    } catch (error) {
        return JSON.stringify([]);
    }
}

async function extractChapters(url) {
    try {
        const response = await fetchv2(url, DEFAULT_HEADERS);
        const html = await response.text();

        const dataMatch = html.match(/window\.__DATA__\s*=\s*(\{[\s\S]*?\});/);
        if (!dataMatch) return JSON.stringify([]);

        const data = JSON.parse(dataMatch[1]);
        const newsId = data.news_id;
        const xhash = data.xhash || "";
        const chapters = data.chapters || [];

        return JSON.stringify(
            chapters.map((chapter) => ({
                href: `${baseUrl}/reader/${newsId}/${chapter.id}${xhash}`,
                number: chapter.posi,
                date: chapter.date || null
            }))
        );
    } catch (error) {
        return JSON.stringify([]);
    }
}

// Handles every shape the API's image paths can come in: a full URL, a
// protocol-relative one (//cdn.host/...), or a site-relative path.
function resolveImageUrl(raw) {
    const image = String(raw).trim();
    if (image.startsWith("http://") || image.startsWith("https://")) return image;
    if (image.startsWith("//")) return "https:" + image;
    if (image.startsWith("/")) return baseUrl + image;
    return `${baseUrl}/${image}`;
}

async function extractPages(url) {
    try {
        const afterReader = url.split("/reader/")[1] || "";
        const [newsId, rawChapterId] = afterReader.split("/");
        const chapterIdMatch = (rawChapterId || "").match(/^\d+/);
        const chapterId = chapterIdMatch ? chapterIdMatch[0] : rawChapterId;

        const response = await fetchv2(
            `${baseUrl}/engine/ajax/controller.php?mod=api&action=reader/getChapterData`,
            { ...DEFAULT_HEADERS, "Content-Type": "application/json" },
            "POST",
            { news_id: newsId, chapter_id: chapterId }
        );
        const json = await response.json();
        const images = (json.data && json.data.images) || json.images || [];

        return JSON.stringify(images.map(resolveImageUrl));
    } catch (error) {
        return JSON.stringify([]);
    }
}
