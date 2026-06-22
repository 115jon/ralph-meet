import { apiError, apiSuccess } from "@/lib/api-helpers";

export interface MyInstantsSound {
  id: string;
  title: string;
  url: string;
  color: string;
}

const GET = async ({ request }: any) => {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim();
  const page = url.searchParams.get("page") || "1";

  // If query is present, hit search. Else hit trending index page.
  const targetUrl = query
    ? `https://www.myinstants.com/en/search/?name=${encodeURIComponent(query)}&page=${page}`
    : `https://www.myinstants.com/en/index/us/?page=${page}`; // Defaulting to US trending, could omit /us/

  try {
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html"
      }
    });

    if (!response.ok) {
      return apiError(`Failed to fetch from MyInstants: ${response.status}`, response.status);
    }

    const html = await response.text();

    const regex = /<div class="instant">[\s\S]*?style="background-color:(#[A-Fa-f0-9]{6});"[\s\S]*?onclick="play\('([^']+)'[\s\S]*?<a[^>]*class="instant-link link-secondary">([^<]+)<\/a>/g;
    
    let match;
    const results: MyInstantsSound[] = [];
    
    while ((match = regex.exec(html)) !== null) {
      // url match[2] looks like '/media/sounds/bruh.mp3'
      const audioPath = match[2].startsWith('/') ? match[2] : `/${match[2]}`;
      
      results.push({
        id: audioPath.split('/').pop()?.split('.')[0] || crypto.randomUUID(),
        color: match[1],
        url: `https://www.myinstants.com${audioPath}`,
        title: match[3].trim()
      });
    }

    return apiSuccess({ results, page: Number(page) });

  } catch (error) {
    console.error("MyInstants API Error:", error);
    return apiError("Internal server error while fetching sounds", 500);
  }
};

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/myinstants")({
  server: {
    handlers: {
      GET,
    },
  },
});
