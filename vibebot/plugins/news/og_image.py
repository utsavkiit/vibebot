import re
from typing import Optional

import requests


def fetch_og_image(url: str, timeout: int = 5) -> Optional[str]:
    """Fetch the Open Graph image URL from an article page. Returns None on failure."""
    try:
        resp = requests.get(
            url,
            timeout=timeout,
            headers={"User-Agent": "VibeBot/1.0"},
            allow_redirects=True,
        )
        if resp.status_code != 200:
            return None
        for pattern in [
            r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
            r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
            r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']',
            r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']twitter:image["\']',
        ]:
            match = re.search(pattern, resp.text, re.IGNORECASE)
            if match:
                return match.group(1)
        return None
    except Exception:
        return None
