// readcomicsonline.lol — a different site/operator than readcomicsonline.ru
// (different domain, modern Next.js stack), picked as its replacement after
// ru's Cloudflare protection turned out to block even a genuine same-origin
// fetch() call, leaving only real top-level navigations working — not
// practical for a chapter/page-scraping module. Verified live: no
// Cloudflare or any other bot check anywhere in this site's funnel (home,
// search, comic page, reader page all plain 200s), so this uses the normal
// fetchv2, no WebView tricks needed.
//
// Search has its own plain JSON API — no autocomplete-plugin shape to
// guess this time, seen directly: GET /api/search?q=<query> ->
// {"results":[{id, title, slug, cover, genres}]}.
//
// Chapter and page listings aren't behind a JSON API — the comic/reader
// pages embed their data in a Next.js RSC payload (a wire format, not
// plain JSON), so those are regex-matched directly against the raw
// href/image-URL substrings in the page instead of trying to parse that
// format. Verified against a long-running series (Batman (2016), 163 real
// issues, no gaps/duplicates) and a short one (Spider-Man: Long Way Home
// #1, 28 real pages). Page images can come from either of two CDN
// hostnames for the same file depending on whether it was eager- or
// lazy-loaded (cdn.readcomicsonline.lol vs a pub-*.r2.dev one) — the page
// regex doesn't hardcode either, and pages are sorted by the page number
// in their own filename afterward rather than trusting the order they
// happen to appear in the document, since the two loading strategies
// don't appear in reading order relative to each other.

const baseUrl = "https://readcomicsonline.lol";

async function searchResults(keyword) {
    const results = [];

    try {
        const response = await fetchv2(`${baseUrl}/api/search?q=${encodeURIComponent(keyword)}`);
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

        for (const item of json.results || []) {
            if (!item.slug) continue;
            results.push({
                title: item.title || item.slug,
                image: item.cover || "",
                href: `${baseUrl}/comic/${item.slug}`,
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
        const slugMatch = url.match(/\/comic\/([^\/?#]+)/);
        const slug = slugMatch ? slugMatch[1] : null;
        if (!slug) return JSON.stringify(chapters);

        const response = await fetchv2(url);
        const html = await response.text();

        const escapedSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const chapterRegex = new RegExp(`/comic/${escapedSlug}/(\\d+(?:\\.\\d+)?)`, "g");
        const seen = new Set();
        let match;
        while ((match = chapterRegex.exec(html)) !== null) {
            const number = parseFloat(match[1]);
            if (seen.has(number)) continue;
            seen.add(number);
            chapters.push({
                href: `${baseUrl}/comic/${slug}/${match[1]}`,
                number,
                date: null,
            });
        }

        return JSON.stringify(chapters);
    } catch (error) {
        return JSON.stringify([]);
    }
}

async function extractPages(url) {
    try {
        const response = await fetchv2(url);
        const html = await response.text();

        // Doesn't hardcode a CDN host — the same file can be served from
        // either cdn.readcomicsonline.lol or a pub-*.r2.dev address
        // depending on how that particular page was loaded.
        const pageRegex = /https:[\\/]+[a-zA-Z0-9.-]+[\\/]+pages[\\/][^"'\\]+?\.(?:webp|jpg|jpeg|png)/g;
        const byNumber = new Map();
        let match;
        while ((match = pageRegex.exec(html)) !== null) {
            const raw = match[0].replace(/\\\//g, "/");
            const numberMatch = raw.match(/p(\d+)\.[a-z]+$/i);
            const key = numberMatch ? parseInt(numberMatch[1], 10) : byNumber.size;
            if (!byNumber.has(key)) byNumber.set(key, raw);
        }

        const orderedKeys = Array.from(byNumber.keys()).sort((a, b) => a - b);
        return JSON.stringify(orderedKeys.map((key) => byNumber.get(key)));
    } catch (error) {
        return JSON.stringify([]);
    }
}
