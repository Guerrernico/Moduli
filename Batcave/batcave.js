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
// request afterward (CloudflareRequestPreparer). No auto-solve — same rule
// as everywhere else in Hoshi.
//
// IMPORTANT CAVEAT: the site itself blocked every attempt to fetch even a
// single real page while writing this (both a plain request and one with a
// browser User-Agent got the Cloudflare challenge, not real content), so
// the selectors below are translated directly from the Kotlin extension's
// jsoup CSS selectors (.readed / .readed__title / .readed__img,
// window.__DATA__ chapter JSON, the /engine/ajax/controller.php page-list
// endpoint) rather than verified against a live HTML snapshot. If search or
// chapters come back empty after solving the shield button, that's the
// first thing to suspect — send back exactly what's empty/wrong and it can
// be adjusted from there, same as any other module bug.
//
// Chapter list: the comic's own page embeds its full chapter list as JSON
// in a `window.__DATA__ = {...};` <script> tag (news_id, chapters[{id,
// posi, title, date}], xhash) — read directly from there instead of
// scraping a list of <a> tags, since that's what the site's own JS uses
// too. Reader URL shape: /reader/<news_id>/<chapter.id><xhash> (xhash is a
// short suffix glued directly onto the numeric id, no separator).
//
// Pages: the reader page itself doesn't embed the images — they're fetched
// client-side via a POST to /engine/ajax/controller.php?mod=api&action=
// reader/getChapterData with a {news_id, chapter_id} JSON body, returning
// {data: {images: [...]}}. chapter_id here is only the leading digits of
// the reader URL's second path segment (the xhash suffix stripped off).

const baseUrl = "https://batcave.biz";

// TEMPORANEO — sonda di debug per capire perché solo alcuni capitoli
// caricano le pagine (i restanti, con lo stesso news_id/xhash della pagina,
// falliscono). Cercando "DEBUGPAGES:<query del fumetto>:<chapterId>" (es.
// "DEBUGPAGES:superior spider-man:184540") il modulo rifà la stessa
// richiesta che farebbe extractPages per quel capitolo e restituisce la
// risposta grezza del server come titolo del risultato — l'unico modo per
// vedere del testo libero dall'interno dell'app senza un dispositivo
// collegato. Da togliere una volta risolto.
async function debugPagesProbe(comicQuery, chapterId) {
    try {
        const searchUrl = `${baseUrl}/search/${encodeURIComponent(comicQuery)}/`;
        const searchHtml = await (await fetchv2(searchUrl)).text();
        const hrefMatch = searchHtml.match(/class="readed__title"[^>]*>\s*<a href="([^"]+)"/);
        if (!hrefMatch) return [{ title: "DEBUG: nessun risultato di ricerca trovato", image: "", href: "x" }];

        const comicHtml = await (await fetchv2(hrefMatch[1])).text();
        const dataMatch = comicHtml.match(/window\.__DATA__\s*=\s*(\{[\s\S]*?\});/);
        if (!dataMatch) return [{ title: "DEBUG: window.__DATA__ non trovato sulla pagina del fumetto", image: "", href: "x" }];

        const data = JSON.parse(dataMatch[1]);
        const pageResponse = await fetchv2(
            `${baseUrl}/engine/ajax/controller.php?mod=api&action=reader/getChapterData`,
            { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
            "POST",
            { news_id: data.news_id, chapter_id: chapterId }
        );
        const bodyText = await pageResponse.text();
        return [
            {
                title: `STATUS ${pageResponse.status} news_id=${data.news_id} :: ${bodyText.slice(0, 400)}`,
                image: "",
                href: "x"
            }
        ];
    } catch (error) {
        return [{ title: `DEBUG EXC: ${String(error)}`, image: "", href: "x" }];
    }
}

async function searchResults(keyword) {
    if (keyword.startsWith("DEBUGPAGES:")) {
        const [, comicQuery, chapterId] = keyword.split(":");
        return JSON.stringify(await debugPagesProbe(comicQuery, chapterId));
    }

    try {
        const url = `${baseUrl}/search/${encodeURIComponent(keyword)}/`;
        const response = await fetchv2(url);
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
        const response = await fetchv2(url);
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

// Handles every shape the API's image paths can come in. The first version
// of this only checked for a leading "http", which silently mishandles a
// protocol-relative URL ("//cdn.host/img.jpg" — a common pattern for
// CDN-served assets, to dodge mixed-content issues): that doesn't start
// with "http" either, so it fell into the same branch as a site-relative
// path and got baseUrl glued on in front of it, producing a broken
// double-domain URL (the right number of page slots, each one a URL that
// can never load — matches "counts right, images don't load" exactly).
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
            { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
            "POST",
            { news_id: newsId, chapter_id: chapterId }
        );
        const json = await response.json();
        // Falls back to a top-level `images` key too, in case the response
        // isn't wrapped in `data` the way the Kotlin extension's model expects.
        const images = (json.data && json.data.images) || json.images || [];

        return JSON.stringify(images.map(resolveImageUrl));
    } catch (error) {
        return JSON.stringify([]);
    }
}
