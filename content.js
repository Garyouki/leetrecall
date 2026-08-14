// LeetCode page tracker.

console.log("LeetRecall: content script loaded");

let startTime = Date.now();
let attempts = 0;
let viewedSolution = false;
let activeSubmissionToken = null;

const autoResetController = LeetRecallReviewReset.createController({
  windowObject: window,
  documentObject: document,
  storage: sessionStorage,
  queryParam: LeetRecallUrls.RESET_QUERY_PARAM,
  resetHash: LeetRecallUrls.RESET_HASH
});

const TERMINAL_STATES = [
  "accepted",
  "wrong answer",
  "runtime error",
  "time limit exceeded",
  "memory limit exceeded",
  "compile error",
  "output limit exceeded"
];

function getProblemData() {
  const slugMatch = window.location.pathname.match(/\/problems\/([^/]+)/);
  const slug = slugMatch ? slugMatch[1] : null;
  const cleanId = slug ? `/problems/${slug}` : window.location.pathname;
  const titleFromSlug = slug
    ? slug.split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")
    : "Unknown Problem";

  const titleEl =
    document.querySelector('[data-cy="question-title"]') ||
    document.querySelector('[class*="title__"][class*="question"]') ||
    document.querySelector(".mr-2.text-label-1") ||
    document.querySelector('div[class*="question-title"]');

  let title = titleEl ? titleEl.innerText.trim().replace(/^\d+\.\s*/, "") : "";
  if (!title || title.length < 2) title = titleFromSlug;

  return {
    id: cleanId,
    title,
    url: `https://leetcode.com${cleanId}/`
  };
}

function getSubmissionId(url = window.location.href) {
  const match = url.match(/\/submissions\/(?:detail\/)?(\d+)/);
  return match ? match[1] : null;
}

function getTerminalState(text) {
  const normalized = (text || "").trim().toLowerCase();
  return TERMINAL_STATES.find(state => normalized.includes(state)) || null;
}

function findResultElement() {
  const byLocator = document.querySelector('[data-e2e-locator="submission-result"]');
  if (byLocator && getTerminalState(byLocator.innerText)) return byLocator;

  const heading = Array.from(document.querySelectorAll("h3")).find(element =>
    getTerminalState(element.innerText)
  );
  if (heading) return heading;

  return Array.from(document.querySelectorAll("span, div, p")).find(element =>
    element.children.length === 0 && getTerminalState(element.innerText)
  ) || null;
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function sendSubmission(submissionId, solved) {
  attempts += 1;
  const performance = {
    solved,
    time: Math.max(1, Math.round((Date.now() - startTime) / 60000)),
    attempts,
    viewedSolution
  };

  chrome.runtime.sendMessage({
    type: "RECORD_SUBMISSION",
    payload: {
      submissionId,
      problemData: getProblemData(),
      performance
    }
  }, response => {
    if (chrome.runtime.lastError) {
      console.error("LeetRecall: background unavailable", chrome.runtime.lastError.message);
      return;
    }
    if (!response?.ok) {
      console.error("LeetRecall: submission was not saved", response?.error);
      return;
    }
    console.log("LeetRecall: submission recorded", {
      submissionId,
      solved,
      duplicate: response.duplicate,
      nextReview: response.nextReview
    });
  });
}

async function readSubmissionStatus(submissionId) {
  const response = await fetch(`/submissions/detail/${submissionId}/check/`, {
    credentials: "include",
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Submission status returned ${response.status}`);

  const data = await response.json();
  const matched = getTerminalState(data.status_msg || data.status_code || "");
  return matched;
}

async function waitForResult(submissionId, token, baselineResult) {
  const deadline = Date.now() + 60000;

  while (activeSubmissionToken === token && Date.now() < deadline) {
    let matched = null;

    try {
      matched = await readSubmissionStatus(submissionId);
    } catch (error) {
      console.debug("LeetRecall: status endpoint unavailable; using DOM", error.message);
    }

    // The DOM fallback keeps tracking working if LeetCode changes or blocks
    // its submission-status endpoint.
    if (!matched) {
      const resultElement = findResultElement();
      const resultChanged = resultElement && (
        resultElement !== baselineResult.element ||
        getTerminalState(resultElement.innerText) !== baselineResult.state
      );
      if (resultChanged) matched = getTerminalState(resultElement.innerText);
    }

    if (matched) {
      if (activeSubmissionToken !== token) return;
      activeSubmissionToken = null;
      sendSubmission(submissionId, matched === "accepted");
      return;
    }

    await delay(500);
  }

  if (activeSubmissionToken === token) {
    activeSubmissionToken = null;
    console.warn("LeetRecall: timed out waiting for submission result", submissionId);
  }
}

async function beginSubmissionWatch() {
  const token = Symbol("submission");
  activeSubmissionToken = token;

  const previousSubmissionId = getSubmissionId();
  const previousResultElement = findResultElement();
  const baselineResult = {
    element: previousResultElement,
    state: previousResultElement ? getTerminalState(previousResultElement.innerText) : null
  };
  const deadline = Date.now() + 60000;

  console.log("LeetRecall: waiting for a new submission", { previousSubmissionId });

  while (activeSubmissionToken === token && Date.now() < deadline) {
    const submissionId = getSubmissionId();
    if (submissionId && submissionId !== previousSubmissionId) {
      console.log("LeetRecall: new submission detected", submissionId);
      await waitForResult(submissionId, token, baselineResult);
      return;
    }
    await delay(200);
  }

  if (activeSubmissionToken === token) {
    activeSubmissionToken = null;
    console.warn("LeetRecall: timed out waiting for a new submission URL");
  }
}

function isSubmitButton(element) {
  const button = element?.closest?.("button");
  if (!button) return false;
  if (button.matches('[data-e2e-locator="console-submit-button"]')) return true;
  return button.textContent.trim().toLowerCase() === "submit";
}

// Event delegation survives React replacing the Submit button after a result.
document.addEventListener("click", event => {
  if (!isSubmitButton(event.target)) return;
  console.log("LeetRecall: submit clicked");
  beginSubmissionWatch();
}, true);

function getBaseProblemPath(path) {
  return path
    .replace(/\/submissions\/.*/, "")
    .replace(/\/solutions.*/, "")
    .replace(/\/editorial.*/, "")
    .replace(/\/description.*/, "")
    .replace(/\/$/, "");
}

let lastPath = window.location.pathname;
let lastBasePath = getBaseProblemPath(lastPath);

function handleNavigation() {
  // DOM changes on the same route are meaningful while Monaco is loading.
  autoResetController.start();

  const currentPath = window.location.pathname;
  if (currentPath === lastPath) return;
  lastPath = currentPath;

  const currentBasePath = getBaseProblemPath(currentPath);
  if (currentBasePath.includes("/problems/") && currentBasePath !== lastBasePath) {
    lastBasePath = currentBasePath;
    startTime = Date.now();
    attempts = 0;
    viewedSolution = false;
    activeSubmissionToken = null;
    console.log("LeetRecall: tracking reset for new problem");
  }

  if (currentPath.includes("/solutions") || currentPath.includes("/editorial")) {
    viewedSolution = true;
    console.log("LeetRecall: solution/editorial viewed");
  }
}

const navigationObserver = new MutationObserver(handleNavigation);
navigationObserver.observe(document.body, { childList: true, subtree: true });
if (lastPath.includes("/solutions") || lastPath.includes("/editorial")) {
  viewedSolution = true;
}

autoResetController.start();
