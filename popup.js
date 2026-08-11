document.addEventListener("DOMContentLoaded", () => {
  const content = document.getElementById("content");
  const badge = document.getElementById("due-count");
  const tabs = document.querySelectorAll(".tab");
  let activeTab = "due";

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      activeTab = tab.dataset.tab;
      render();
    });
  });

  function render() {
    chrome.storage.local.get({ problems: [], reviewSettings: {} }, ({ problems, reviewSettings }) => {
      if (!problems || problems.length === 0) {
        content.innerHTML = `
          <div class="empty">
            <p>No problems tracked yet.</p>
            <p>Solve a LeetCode problem<br>to get started!</p>
          </div>`;
        badge.textContent = "0 due";
        return;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const dailyQueue = LeetRecallReviewQueue.getDailyReviewQueue(
        problems,
        reviewSettings,
        today
      );

      badge.textContent = `${dailyQueue.length} due`;
      const list = activeTab === "due" ? dailyQueue : [...problems];

      if (list.length === 0) {
        content.innerHTML = `
          <div class="empty">
            <p>Nothing due today!!</p>
            <p>You're all caught up. Keep solving!</p>
          </div>`;
        return;
      }

      if (activeTab === "all") {
        list.sort((a, b) => new Date(a.nextReview) - new Date(b.nextReview));
      }

      content.innerHTML = "";
      list.forEach(p => {
        const isDue      = LeetRecallReviewQueue.isDue(p, today);
        const reviewDate = new Date(p.nextReview).toLocaleDateString(
          undefined, { month: "short", day: "numeric" }
        );

        const perf    = p.lastPerformance;
        const solved  = perf?.solved ? "Yes" : "No";
        const time    = perf ? `${perf.time}min` : "—";
        const att     = perf ? `${perf.attempts} attempt${perf.attempts > 1 ? "s" : ""}` : "—";
        const ef      = p.easeFactor ? p.easeFactor.toFixed(1) : "2.5";

        const card = document.createElement("div");
        card.className = `card ${isDue ? "card-due" : ""}`;
        card.innerHTML = `
          <div class="card-header">
            <a class="card-title" href="${LeetRecallUrls.getReviewUrl(p.url)}" target="_blank">
              ${p.title}
            </a>
            ${isDue ? '<span class="tag-due">DUE</span>' : ""}
          </div>
          <div class="card-meta">
            <span title="Next review">${reviewDate}</span>
            <span title="Last solve time">⏱ ${time}</span>
            <span title="Attempts">${solved} ${att}</span>
          </div>
          <div class="card-stats">
            <span title="Repetitions">Rep ${p.repetition}</span>
            <span title="Ease factor"> EF ${ef}</span>
            <span title="Interval">+${p.interval}d</span>
          </div>
        `;
        content.appendChild(card);
      });
    });
  }

  document.getElementById("open-dashboard").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
  });

  render();

  // Keep an open popup in sync with submissions saved by any LeetCode tab.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && (changes.problems || changes.reviewSettings)) render();
  });
});
