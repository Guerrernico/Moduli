// AnimeWorld (animeworld.ac) module for Hoshi.
//
// Ported from a confirmed-working module for the same site on another app in this
// ecosystem (LunaNew) — notably: the bare domain (no "www.") for search/detail/episode
// pages, but "www." specifically for the episode-info API call.

const BASE_URL = "https://animeworld.ac";

function absoluteUrl(href) {
    if (href.startsWith("https")) return href;
    return href.startsWith("/") ? BASE_URL + href : BASE_URL + "/" + href;
}

async function searchResults(keyword) {
    try {
        const res = await fetchv2(`${BASE_URL}/search?keyword=${encodeURIComponent(keyword)}`);
        const html = await res.text();

        const results = [];
        const filmListMatch = html.match(/<div class="film-list">([\s\S]*?)<div class="clearfix"><\/div>\s*<\/div>/);
        if (!filmListMatch) return JSON.stringify(results);

        const items = filmListMatch[1].match(/<div class="item">[\s\S]*?<\/div>[\s]*<\/div>/g) || [];

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
    } catch (error) {
        console.log("searchResults error: " + error);
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
    try {
        const res = await fetchv2(url);
        const html = await res.text();

        const descMatch = html.match(/<div class="desc">([\s\S]*?)<\/div>/);
        const description = descMatch ? normalizeWhitespace(htmlEntityDecode(getInnerText(descMatch[1]))) : "";

        return JSON.stringify([{ description: description, aliases: "", airdate: "" }]);
    } catch (error) {
        console.log("extractDetails error: " + error);
        return JSON.stringify([]);
    }
}

async function extractEpisodes(url) {
    try {
        const res = await fetchv2(url);
        const html = await res.text();

        const episodes = [];
        const serverMatch = html.match(/<div class="server active"[^>]*>([\s\S]*?)<\/ul>\s*<\/div>/);
        if (!serverMatch) return JSON.stringify(episodes);

        const episodeRegex = /<li class="episode">\s*<a[^>]*?href="([^"]+)"[^>]*?>([^<]+)<\/a>/g;
        let match;
        while ((match = episodeRegex.exec(serverMatch[1])) !== null) {
            episodes.push({
                href: absoluteUrl(match[1]),
                number: parseInt(match[2], 10)
            });
        }

        return JSON.stringify(episodes);
    } catch (error) {
        console.log("extractEpisodes error: " + error);
        return JSON.stringify([]);
    }
}

async function extractStreamUrl(url) {
    try {
        const parts = url.split("/");
        const episodeToken = parts[parts.length - 1];

        const res = await fetchv2(`https://www.animeworld.ac/api/episode/info?id=${encodeURIComponent(episodeToken)}&alt=0`);
        const json = JSON.parse(await res.text());

        if (!json || !json.grabber) return JSON.stringify({});
        return JSON.stringify({ stream: json.grabber });
    } catch (error) {
        console.log("extractStreamUrl error: " + error);
        return JSON.stringify({});
    }
}
