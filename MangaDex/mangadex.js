// mangadex.org — uses MangaDex's own official, public, documented REST API
// (api.mangadex.org) directly, no scraping at all. Verified live:
//   - Search: GET /manga?title=<query>&includes[]=cover_art
//   - Chapters: GET /manga/<id>/feed?translatedLanguage[]=en&order[chapter]=asc
//   - Pages: GET /at-home/server/<chapterId> -> {baseUrl, chapter:{hash, data:[filenames]}},
//     page URL = `${baseUrl}/data/${hash}/${filename}`
// English only, per request — translatedLanguage is hardcoded to "en".
//
// Some chapters (most visibly currently-simulpubbed ones like One Piece,
// delisted from MangaDex's own reader per publisher agreement) only carry
// an externalUrl pointing at an outside reader (e.g. MANGA Plus) and have
// no real page data on MangaDex at all (`pages: 0`) — those are skipped
// entirely in extractChapters rather than listed as dead ends. A given
// chapter number is also often uploaded by more than one scanlation group;
// only the first one seen per number is kept, since the app's own source
// picker is per-module (it can't tell two MangaDex entries with the same
// service name apart), not per-scanlation-group.
//
// MangaDex's API has its own rate limiting (a handful of requests/second
// per IP) — fine for this module's usage (one search, one chapter-feed
// fetch, one at-home-server fetch per page load), no auth needed for any
// of this.

const apiBase = "https://api.mangadex.org";

function pickTitle(attributes) {
    const title = attributes?.title || {};
    if (title.en) return title.en;
    const firstTitle = Object.values(title)[0];
    if (firstTitle) return firstTitle;
    const altTitles = attributes?.altTitles || [];
    const enAlt = altTitles.find((t) => t.en);
    if (enAlt) return enAlt.en;
    return "Untitled";
}

async function searchResults(keyword) {
    const results = [];

    try {
        const url = `${apiBase}/manga?title=${encodeURIComponent(keyword)}&limit=20&includes[]=cover_art`;
        const response = await fetchv2(url);
        const status = response.status ?? "?";
        const text = await response.text();

        let json;
        try {
            json = JSON.parse(text);
        } catch (parseError) {
            results.push({
                title: `⚠️ DEBUG: risposta non-JSON (status ${status}): ${text.slice(0, 150).replace(/\s+/g, " ")}`,
                image: "",
                href: "",
            });
            return JSON.stringify(results);
        }

        if (json.result !== "ok") {
            results.push({
                title: `⚠️ DEBUG: MangaDex ha risposto con errore (status ${status}): ${JSON.stringify(json).slice(0, 150)}`,
                image: "",
                href: "",
            });
            return JSON.stringify(results);
        }

        for (const manga of json.data || []) {
            const cover = (manga.relationships || []).find((r) => r.type === "cover_art");
            const fileName = cover?.attributes?.fileName;
            results.push({
                title: pickTitle(manga.attributes),
                image: fileName ? `https://uploads.mangadex.org/covers/${manga.id}/${fileName}.256.jpg` : "",
                href: `${apiBase}/manga/${manga.id}`,
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
        const idMatch = url.match(/\/manga\/([a-f0-9-]+)/i);
        const mangaId = idMatch ? idMatch[1] : null;
        if (!mangaId) return JSON.stringify(chapters);

        const seenNumbers = new Set();
        let offset = 0;
        const limit = 500;

        while (true) {
            const feedUrl = `${apiBase}/manga/${mangaId}/feed?translatedLanguage[]=en&order[chapter]=asc&limit=${limit}&offset=${offset}`;
            const response = await fetchv2(feedUrl);
            const json = JSON.parse(await response.text());
            const data = json.data || [];

            for (const chapter of data) {
                const attrs = chapter.attributes || {};
                if (attrs.externalUrl) continue;
                if (attrs.chapter === null || attrs.chapter === undefined) continue;
                const number = parseFloat(attrs.chapter);
                if (isNaN(number) || seenNumbers.has(number)) continue;
                seenNumbers.add(number);
                chapters.push({
                    href: `${apiBase}/chapter/${chapter.id}`,
                    number,
                    date: attrs.publishAt || null,
                });
            }

            offset += limit;
            const total = json.total || 0;
            if (data.length === 0 || offset >= total) break;
        }

        return JSON.stringify(chapters);
    } catch (error) {
        return JSON.stringify([]);
    }
}

async function extractPages(url) {
    try {
        const idMatch = url.match(/\/chapter\/([a-f0-9-]+)/i);
        const chapterId = idMatch ? idMatch[1] : null;
        if (!chapterId) return JSON.stringify([]);

        const response = await fetchv2(`${apiBase}/at-home/server/${chapterId}`);
        const json = JSON.parse(await response.text());
        if (json.result !== "ok") return JSON.stringify([]);

        const baseUrl = json.baseUrl;
        const hash = json.chapter?.hash;
        const files = json.chapter?.data || [];
        const pages = files.map((fileName) => `${baseUrl}/data/${hash}/${fileName}`);

        return JSON.stringify(pages);
    } catch (error) {
        return JSON.stringify([]);
    }
}
