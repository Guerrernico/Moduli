// AnimeWorld (animeworld.ac) module for Hoshi.
//
// Ported from a confirmed-working module for the same site on another app in this
// ecosystem (LunaNew), then adjusted to always use the "www." host explicitly — the
// bare domain 301-redirects to it via Cloudflare, and depending on that redirect being
// followed correctly turned out to be fragile.
//
// Deliberately no try/catch here: a rejected promise surfaces as a real, visible error
// in the app (module picker shows it under this module's name). Swallowing errors and
// returning an empty array instead made every real failure look identical to "no
// results found", which made this impossible to debug from the app alone.

const BASE_URL = "https://www.animeworld.ac";

function absoluteUrl(href) {
    if (href.startsWith("https")) return href;
    return href.startsWith("/") ? BASE_URL + href : BASE_URL + "/" + href;
}

async function searchResults(keyword) {
    const res = await fetchv2(`${BASE_URL}/search?keyword=${encodeURIComponent(keyword)}`);
    const html = await res.text();

    const filmListMatch = html.match(/<div class="film-list">([\s\S]*?)<div class="clearfix"><\/div>\s*<\/div>/);
    if (!filmListMatch) {
        throw new Error(`film-list non trovato (status ${res.status}, lunghezza html ${html.length}): ${html.slice(0, 200)}`);
    }

    const items = filmListMatch[1].match(/<div class="item">[\s\S]*?<\/div>[\s]*<\/div>/g) || [];
    const results = [];

    for (const itemHtml of items) {
        const imgMatch = itemHtml.match(/src="([^"]+)"/);
        const titleMatch = itemHtml.match(/class="name">([^<]+)</);
        const hrefMatch = itemHtml.match(/href="([^"]+)"/);
        if (!imgMatch || !titleMatch || !hrefMatch) continue;

        results.push({
            title: htmlEntityDecode(titleMatch[1]).trim(),
            image: absoluteUrl(imgMatch[1]),
            href: absoluteUrl(hrefMatch[1])
        });
    }

    return JSON.stringify(results);
}

async function extractDetails(url) {
    const res = await fetchv2(url);
    const html = await res.text();

    const descMatch = html.match(/<div class="desc">([\s\S]*?)<\/div>/);
    const description = descMatch ? normalizeWhitespace(htmlEntityDecode(getInnerText(descMatch[1]))) : "";

    return JSON.stringify([{ description: description, aliases: "", airdate: "" }]);
}

async function extractEpisodes(url) {
    const res = await fetchv2(url);
    const html = await res.text();

    const serverMatch = html.match(/<div class="server active"[^>]*>([\s\S]*?)<\/ul>\s*<\/div>/);
    if (!serverMatch) {
        throw new Error(`server attivo non trovato (status ${res.status}, lunghezza html ${html.length}): ${html.slice(0, 200)}`);
    }

    const episodes = [];
    const episodeRegex = /<li class="episode">\s*<a[^>]*?href="([^"]+)"[^>]*?>([^<]+)<\/a>/g;
    let match;
    while ((match = episodeRegex.exec(serverMatch[1])) !== null) {
        episodes.push({
            href: absoluteUrl(match[1]),
            number: parseInt(match[2], 10)
        });
    }

    return JSON.stringify(episodes);
}

async function extractStreamUrl(url) {
    const parts = url.split("/");
    const episodeToken = parts[parts.length - 1];

    const res = await fetchv2(`https://www.animeworld.ac/api/episode/info?id=${encodeURIComponent(episodeToken)}&alt=0`);
    const raw = await res.text();

    let json;
    try {
        json = JSON.parse(raw);
    } catch (e) {
        throw new Error(`risposta non JSON dall'API episodio (status ${res.status}): ${raw.slice(0, 200)}`);
    }

    if (!json || !json.grabber) {
        throw new Error(`nessun "grabber" nella risposta API: ${raw.slice(0, 200)}`);
    }

    return JSON.stringify({ stream: json.grabber });
}
