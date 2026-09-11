// AnimeWorld (animeworld.ac) module for Hoshi.
//
// Site structure (verified live):
//   Search:   GET /search?keyword={query}      -> div.film-list > div.item > div.inner
//   Detail:   GET {href from search}            -> h1#anime-title, div.desc,
//                                                   li.episode > a[data-id][data-episode-num]
//   Stream:   GET /api/episode/info?id={token}&alt=0 -> JSON { "grabber": "<direct .mp4>" }
//
// No cookies/Referer/CSRF needed for any of the three requests, and the resulting .mp4
// is directly fetchable with no extra headers.

const BASE_URL = "https://www.animeworld.ac";

function absoluteUrl(href) {
    if (href.indexOf("http") === 0) return href;
    return BASE_URL + href;
}

async function searchResults(keyword) {
    const res = await fetchv2(`${BASE_URL}/search?keyword=${encodeURIComponent(keyword)}`);
    const html = await res.text();

    const results = [];
    const blocks = html.split('<div class="inner">').slice(1);

    for (const block of blocks) {
        const nameMatch = block.match(/href="([^"]+)"[^>]*class="name"[^>]*>([^<]+)</);
        if (!nameMatch) continue;

        const imgMatch = block.match(/<img[^>]+src="([^"]+)"/);

        results.push({
            title: htmlEntityDecode(nameMatch[2]).trim(),
            image: imgMatch ? imgMatch[1] : null,
            href: absoluteUrl(nameMatch[1])
        });
    }

    return JSON.stringify(results);
}

async function extractDetails(url) {
    const res = await fetchv2(url);
    const html = await res.text();

    const descMatch = html.match(/<div class="desc"[^>]*>([\s\S]*?)<\/div>/);
    const description = descMatch ? normalizeWhitespace(htmlEntityDecode(getInnerText(descMatch[1]))) : "";

    return JSON.stringify([{ description: description, aliases: "", airdate: "" }]);
}

async function extractEpisodes(url) {
    const res = await fetchv2(url);
    const html = await res.text();

    const episodes = [];
    const seen = {};
    const episodeRegex = /data-id="([^"]+)"[^>]*data-episode-num="(\d+)"[^>]*href="[^"]+"/g;
    let match;
    while ((match = episodeRegex.exec(html)) !== null) {
        const token = match[1];
        if (seen[token]) continue;
        seen[token] = true;
        episodes.push({ number: parseInt(match[2], 10), href: token });
    }

    episodes.sort((a, b) => a.number - b.number);
    return JSON.stringify(episodes);
}

async function extractStreamUrl(episodeToken) {
    const res = await fetchv2(`${BASE_URL}/api/episode/info?id=${encodeURIComponent(episodeToken)}&alt=0`);
    const json = await res.json();

    if (!json || !json.grabber) {
        return JSON.stringify({});
    }

    return JSON.stringify({ stream: json.grabber });
}
