
// popup.js — UI Rendering
//HTML elements by their id/class so JS can update them 
document.addEventListener("DOMContentLoaded", () => {
  const content  = document.getElementById("content"); // the div where problem cards go
  const badge    = document.getElementById("due-count"); //the due count badge in the header
  const tabs     = document.querySelectorAll(".tab"); //both tab buttons (Due Today & All Problems)
  let   activeTab = "due"; //tracks which tab is currently selected, starts as "due"

  //Tab switching 
  tabs.forEach(tab => {
    tab.addEventListener("click", () => { //When tab gets clicked then
      tabs.forEach(t => t.classList.remove("active")); //clears the orange underline from both tabs(or remove active)
      tab.classList.add("active"); //gives the orange underline to the one you clicked
      activeTab = tab.dataset.tab; //reads the data-tab attribute from HTML ("due" or "all Problems") and saves it
      render();
    });
  });

  //Main render function
  function render() {
    //Reads all saved problems from Chrome's local storage
    chrome.storage.local.get({ problems: [] }, ({ problems }) => { 

      // No problems yet
      if (!problems || problems.length === 0) {
        content.innerHTML = `
          <div class="empty">
            <p>No problems tracked yet.</p>
            <p>Solve a LeetCode problem<br>to get started!</p>
          </div>`;
        badge.textContent = "0 due"; //if no problems due then by default batch shows 0 due
        return;
      }

      //Filtering due problems & updating badge count
      
      //sets time to midnight so we compare dates not times. 
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // goes through every problem and keeps only the ones where nextReview date is today or earlier.
      //  This is Due Today list.
      const dueProblems = problems.filter(
        p => new Date(p.nextReview) <= today
      );

      // Update badge- updates the orange badge count in the header with the real count.
      badge.textContent = `${dueProblems.length} due`;

      // Pick which list to show
      const list = activeTab === "due" ? dueProblems : [...problems];

      if (list.length === 0) {
        content.innerHTML = `
          <div class="empty">
            <p>Nothing due today!!</p>
            <p>You're all caught up. Keep solving!</p>
          </div>`;
        return;
      }

      // Sort by nextReview ascending
      list.sort((a, b) => new Date(a.nextReview) - new Date(b.nextReview));

      // Render cards
      content.innerHTML = "";
      list.forEach(p => {
        const isDue      = new Date(p.nextReview) <= today;
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
            <a class="card-title" href="${p.url}" target="_blank">
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

  //Open dashboard
  document.getElementById("open-dashboard").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
  });

  // Initial render
  render();

  // Keep an open popup in sync with submissions saved by any LeetCode tab.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.problems) render();
  });
});
