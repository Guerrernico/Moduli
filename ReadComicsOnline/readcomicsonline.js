// readcomicsonline.ru sits behind an active Cloudflare "Verifying you are
// human" challenge — fetch/fetchv2 (JavaScriptCore, no real browser/DOM)
// can't solve that on their own. Hoshi's Moduli screen has a "Risolvi
// Cloudflare" button per module (shield icon) that opens a real WKWebView
// so a human can solve the challenge once; the resulting cookies land in
// the same cookie jar fetch/fetchv2 already read from automatically, so
// nothing below needs to know any of that happened — it just starts
// working once the challenge has been solved that way. If requests are
// failing/empty, solve it again there first.
//
// Search/chapters/pages verified against real archived HTML (Wayback
// Machine snapshots of readcomicsonline.ru, since the live site itself
// can't be fetched plainly to check) rather than guessed — a batman-2016
// issue page and its chapter list, and the site's own jquery.autocomplete
// search config (serviceUrl: "/search", onSelect building
// "/comic/" + suggestion.data). The search endpoint's exact response shape
// is inferred from that plugin's own defaults ({suggestions: [{value,
// data}]}), not seen directly — if search comes back empty despite chapters
// working fine for a direct link, that's the most likely place to check.

async function rcoFetch(url, options = { headers: {}, method: "GET", body: null, encoding: "utf-8" }) {
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

async function searchResults(keyword) {
    const baseUrl = "https://readcomicsonline.ru";
    const results = [];

    try {
        const response = await rcoFetch(`${baseUrl}/search?query=${encodeURIComponent(keyword)}`);
        const text = await response.text();
        const json = JSON.parse(text);
        const suggestions = json.suggestions || [];

        for (const s of suggestions) {
            if (!s.data) continue;
            results.push({
                title: s.value || s.data,
                image: "",
                href: `${baseUrl}/comic/${s.data}`,
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
        const response = await rcoFetch(url);
        const html = await response.text();

        // <li class="volume-0"><h5 class="chapter-title-rtl">
        //   <a href="URL">Title #N</a></h5>
        //   <div class="action"><div class="date-chapter-title-rtl">DATE</div></div>
        // </li>
        // Only numeric issues (#12, #12.5) are kept — specials like
        // "#Annual 2022" have no chapter number this app can sort by.
        const itemRegex = /<a href="([^"]+)">[^<]*#([\d.]+)<\/a>[\s\S]*?class="date-chapter-title-rtl">\s*([^<]+?)\s*<\/div>/g;
        let match;
        while ((match = itemRegex.exec(html)) !== null) {
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
        const response = await rcoFetch(url);
        const html = await response.text();

        // Every reader page image carries class="img-responsive" (the very
        // first one also "scan-page", with the real URL directly in src);
        // every one after that is lazy-loaded — a data: placeholder in src,
        // the real URL in data-src instead.
        const tagRegex = /<img class="img-responsive[^>]*>/g;
        let tagMatch;
        while ((tagMatch = tagRegex.exec(html)) !== null) {
            const tag = tagMatch[0];
            const dataSrcMatch = tag.match(/data-src="\s*([^"]+?)\s*"/);
            if (dataSrcMatch) {
                pages.push(dataSrcMatch[1]);
                continue;
            }
            const srcMatch = tag.match(/\ssrc="\s*([^"]+?)\s*"/);
            if (srcMatch && !srcMatch[1].startsWith("data:")) {
                pages.push(srcMatch[1]);
            }
        }

        return JSON.stringify(pages);
    } catch (error) {
        console.log("Pages error:", error);
        return JSON.stringify([]);
    }
}
