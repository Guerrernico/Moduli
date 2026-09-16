async function mwFetch(url, options = { headers: {}, method: "GET", body: null, encoding: "utf-8" }) {
    try {
        return await fetchv2(url, options.headers ?? {}, options.method ?? "GET", options.body ?? null, true, options.encoding ?? "utf-8");
    } catch (e) {
        try {
            return await fetch(url, options);
        } catch (error) {
            return null;
        }
    }
}

function decodeHtmlEntities(text) {
    return text
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}

async function searchResults(keyword) {
    const baseUrl = "https://www.mangaworld.mx";
    const results = [];

    try {
        const response = await mwFetch(`${baseUrl}/archive?keyword=${encodeURIComponent(keyword)}`);
        const html = await response.text();

        // Each result card: <a class="thumb ..." href=URL title="TITLE"><img src=IMG ...>
        const entryRegex = /<a class="thumb[^>]*?href=([^\s>]+)[^>]*?title="([^"]*)"[^>]*?>\s*<img src=([^\s>]+)/g;
        let match;
        while ((match = entryRegex.exec(html)) !== null) {
            results.push({
                title: decodeHtmlEntities(match[2]),
                image: match[3],
                href: match[1],
            });
        }

        return JSON.stringify(results);
    } catch (error) {
        console.log("Search error:", error);
        return JSON.stringify([]);
    }
}

async function extractChapters(url) {
    const chapters = [];

    try {
        const response = await mwFetch(url);
        const html = await response.text();

        // <a class=chap href=URL title="..."><span class=d-inline-block>Capitolo N</span><i ...>DATE</i>
        const chapterRegex = /<a class=chap href=([^\s>]+)[^>]*>\s*<span class=d-inline-block>Capitolo ([\d.]+)<\/span><i[^>]*>([^<]*)<\/i>/g;
        let match;
        while ((match = chapterRegex.exec(html)) !== null) {
            chapters.push({
                href: match[1],
                number: parseFloat(match[2]),
                date: match[3].trim(),
            });
        }

        return JSON.stringify(chapters);
    } catch (error) {
        console.log("Chapters error:", error);
        return JSON.stringify([]);
    }
}

async function extractPages(url) {
    const pages = [];

    try {
        // ?style=list loads every page's <img> on one response instead of a
        // paginated single-page-per-request reader.
        const readUrl = url.includes("?") ? `${url}&style=list` : `${url}?style=list`;
        const response = await mwFetch(readUrl);
        const html = await response.text();

        const pageRegex = /<img id=page-\d+ class="page-image[^"]*" src=([^\s>]+)>/g;
        let match;
        while ((match = pageRegex.exec(html)) !== null) {
            pages.push(match[1]);
        }

        return JSON.stringify(pages);
    } catch (error) {
        console.log("Pages error:", error);
        return JSON.stringify([]);
    }
}
