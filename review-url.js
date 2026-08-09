// Shared URL handling for links that start a review session.

globalThis.LeetRecallUrls = (() => {
  const RESET_QUERY_PARAM = "leetrecall_reset";
  const PROBLEMSET_URL = "https://leetcode.com/problemset/";

  function getReviewUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.hostname !== "leetcode.com" ||
          !url.pathname.startsWith("/problems/")) {
        return PROBLEMSET_URL;
      }

      url.searchParams.set(RESET_QUERY_PARAM, "1");
      return url.href;
    } catch {
      return PROBLEMSET_URL;
    }
  }

  return Object.freeze({ RESET_QUERY_PARAM, getReviewUrl });
})();
