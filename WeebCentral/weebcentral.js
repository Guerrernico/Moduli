// weebcentral.com — plain HTMX-based site, verified live: no Cloudflare or
// other bot protection anywhere in the funnel used here (quick-search
// endpoint, series page, full chapter list, chapter images endpoint all
// plain 200s with real server-rendered HTML/fragments). No JSON API found,
// so this is regex-based against the actual HTMX fragment responses the
// site's own front end uses — verified against a real, long-running series
// (Naruto, 701 real chapters via /series/<id>/full-chapter-list) and a real
// chapter's image list (51 real pages via /chapters/<id>/images).
//
// Search: POST /search/simple?location=main with form body text=<query> ->
// an HTML fragment of <a href="https://weebcentral.com/series/<id>/<slug>">
// blocks, each with a cover <img> and a title.
// Chapters: series id extracted from the series URL, then GET
// /series/<id>/full-chapter-list -> one block per chapter with its own
// href (/chapters/<id>), a "Chapter <number>" label, and a <time
// datetime="..."> — order in the response is newest-first, doesn't matter
// since the app sorts by chapter number itself.
// Pages: GET /chapters/<id>/images?is_prev=False&current_page=1&reading_style=long_strip
// -> a sequence of <img src="..."> tags already in reading order.

const baseUrl = "https://weebcentral.com";

function decodeHtmlEntities(text) {
    return text
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}

async function searchResults(keyword) {
    const results = [];

    try {
        const response = await fetchv2(
            `${baseUrl}/search/simple?location=main`,
            { "Content-Type": "application/x-www-form-urlencoded", "HX-Request": "true" },
            "POST",
            `text=${encodeURIComponent(keyword)}`
        );
        const status = response.status ?? "?";
        const html = await response.text();

        const itemRegex = /<a href="(https:\/\/weebcentral\.com\/series\/[^"]+)"[\s\S]*?src="([^"]*cover[^"]*)"[\s\S]*?line-clamp-2">\s*([^<]+?)\s*<\/div>/g;
        let match;
        while ((match = itemRegex.exec(html)) !== null) {
            results.push({
                title: decodeHtmlEntities(match[3].trim()),
                image: match[2],
                href: match[1],
            });
        }

        if (results.length === 0) {
            results.push({
                title: `⚠️ DEBUG: 0 risultati analizzando la risposta (status ${status}): ${html.slice(0, 150).replace(/\s+/g, " ")}`,
                image: "",
                href: "",
            });
        }

        return JSON.stringify(results);
    } catch (error) {
        results.push({ title: `⚠️ DEBUG: eccezione — ${String(error)}`, image: "", href: "" });
        return JSON.stringify(results);
    }
}

async function extractChapters(url) {
    const chapters = [];

    try {
        const idMatch = url.match(/\/series\/([A-Za-z0-9]+)/);
        const seriesId = idMatch ? idMatch[1] : null;
        if (!seriesId) return JSON.stringify(chapters);

        const response = await fetchv2(`${baseUrl}/series/${seriesId}/full-chapter-list`, { "HX-Request": "true" });
        const html = await response.text();

        const chapterRegex = /href="\/chapters\/([A-Za-z0-9]+)"[\s\S]{0,800}?>\s*Chapter\s+([\d.]+)\s*<[\s\S]{0,800}?datetime="([^"]*)"/g;
        const seen = new Set();
        let match;
        while ((match = chapterRegex.exec(html)) !== null) {
            const number = parseFloat(match[2]);
            if (isNaN(number) || seen.has(number)) continue;
            seen.add(number);
            chapters.push({
                href: `${baseUrl}/chapters/${match[1]}`,
                number,
                date: match[3] || null,
            });
        }

        return JSON.stringify(chapters);
    } catch (error) {
        return JSON.stringify([]);
    }
}

async function extractPages(url) {
    try {
        const idMatch = url.match(/\/chapters\/([A-Za-z0-9]+)/);
        const chapterId = idMatch ? idMatch[1] : null;
        if (!chapterId) return JSON.stringify([]);

        const response = await fetchv2(
            `${baseUrl}/chapters/${chapterId}/images?is_prev=False&current_page=1&reading_style=long_strip`,
            { "HX-Request": "true" }
        );
        const html = await response.text();

        const pageRegex = /src="(https:\/\/[^"]+?\.(?:png|jpg|jpeg|webp))"/g;
        const pages = [];
        let match;
        while ((match = pageRegex.exec(html)) !== null) {
            pages.push(match[1]);
        }

        return JSON.stringify(pages);
    } catch (error) {
        return JSON.stringify([]);
    }
}
