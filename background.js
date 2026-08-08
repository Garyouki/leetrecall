// ============================================================
// background.js — Service Worker (Manifest V3)
// Does 4 things:
//   1. Shows red badge count on icon (how many problems due)
//   2. Updates badge every time you solve a problem
//   3. Sends daily 9am reminder notification if problems are due
//   4. Serializes and deduplicates submission writes from every tab
// ============================================================

importScripts("scheduler.js");

console.log("LeetRecall: background service worker started");

// chrome.storage.local has no atomic read-modify-write operation. Route every
// submission through one background queue so writes from different tabs cannot
// overwrite each other.
let submissionWriteQueue = Promise.resolve();

function getProblems() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get({ problems: [] }, result => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result.problems || []);
    });
  });
}

function setProblems(problems) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ problems }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

async function migrateStoredSchedules() {
  const problems = await getProblems();
  const migration = LeetRecallScheduler.migrateSuccessfulSameDayCards(problems);
  if (!migration.changed) return;

  await setProblems(migration.problems);
  console.log("LeetRecall: migrated successful same-day reviews to one-day intervals");
}

// Run migrations through the same queue as submissions so an update cannot
// overwrite a submission arriving at the same time.
submissionWriteQueue = migrateStoredSchedules().catch(error => {
  console.error("LeetRecall: failed to migrate stored schedules", error);
});

async function recordSubmission(payload) {
  if (!payload?.problemData?.id || !payload?.performance) {
    throw new Error("Invalid submission payload");
  }

  const problems = await getProblems();
  const result = LeetRecallScheduler.applyReview(
    problems,
    payload.problemData,
    payload.performance,
    payload.submissionId
  );

  if (result.duplicate) {
    console.log("LeetRecall: duplicate submission ignored", payload.submissionId);
    return { duplicate: true };
  }

  await setProblems(result.problems);
  console.log("LeetRecall: submission saved", {
    submissionId: payload.submissionId,
    title: result.card.title,
    solved: payload.performance.solved,
    quality: result.quality,
    nextReview: result.card.nextReview
  });

  return {
    duplicate: false,
    nextReview: result.card.nextReview,
    quality: result.quality
  };
}

async function scheduleTomorrow(problemIds) {
  if (!Array.isArray(problemIds) || !problemIds.length) {
    throw new Error("Select at least one problem");
  }

  const problems = await getProblems();
  const result = LeetRecallScheduler.scheduleForTomorrow(problems, problemIds);
  if (!result.updatedCount) throw new Error("The selected problems were not found");

  await setProblems(result.problems);
  return { updatedCount: result.updatedCount, nextReview: result.nextReview };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "RECORD_SUBMISSION" && message?.type !== "SCHEDULE_TOMORROW") {
    return false;
  }

  const write = submissionWriteQueue.then(() =>
    message.type === "RECORD_SUBMISSION"
      ? recordSubmission(message.payload)
      : scheduleTomorrow(message.problemIds)
  );
  submissionWriteQueue = write.catch(error => {
    console.error("LeetRecall: failed to save submission", error);
  });

  write
    .then(result => sendResponse({ ok: true, ...result }))
    .catch(error => sendResponse({ ok: false, error: error.message }));

  return true;
});



// PART 1 — BADGE COUNTER
// The red number on the extension icon showing due problems

/**
 * Reads all problems from storage, counts how many are due
 * today or overdue, and updates the icon badge number.
 * Called on startup AND every time storage changes.
 */
function updateBadge() {
  chrome.storage.local.get({ problems: [] }, ({ problems }) => {

    // Set today to midnight so anything due today OR in the past counts
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Count problems where nextReview date is today or earlier
    const dueCount = problems.filter(p => {
      const reviewDate = new Date(p.nextReview);
      return reviewDate <= today;
    }).length;

    if (dueCount > 0) {
      // Show the number on the icon
      chrome.action.setBadgeText({ text: String(dueCount) });
      // Red background colour
      chrome.action.setBadgeBackgroundColor({ color: "#ef4743" });
    } else {
      // Nothing due — clear the badge completely
      chrome.action.setBadgeText({ text: "" });
    }

  });
}

// Run immediately when Chrome starts or extension loads
// This makes sure the badge is correct right away
updateBadge();

// Run every time ANY data in chrome.storage changes
// So the moment you solve a problem and it gets saved,
// the badge number updates automatically — no manual refresh needed
chrome.storage.onChanged.addListener((changes, area) => {
  // Only care about local storage changes (not sync storage)
  if (area === "local") {
    updateBadge();
  }
});



// PART 2 — DAILY 9AM REMINDER NOTIFICATION
// Uses chrome.alarms to fire at 9am every day


/**
 * Figures out when the next 9:00am is.
 * If it's already past 9am today, returns tomorrow 9am.
 * If it's before 9am today, returns today 9am.
 * Returns a timestamp (milliseconds) that chrome.alarms needs.
 */
function getNext9am() {
  const now  = new Date();
  const next = new Date();

  // Set to 9:00:00am today
  next.setHours(9, 0, 0, 0);

  // If 9am today has already passed, move to tomorrow
  if (now >= next) {
    next.setDate(next.getDate() + 1);
  }

  return next.getTime(); // return as milliseconds timestamp
}

/**
 * Creates the daily alarm.
 * onInstalled fires when the extension is first installed
 * or updated the right time to set up recurring alarms.
 * chrome.alarms survive browser restarts automatically.
 */
chrome.runtime.onInstalled.addListener(() => {
  console.log("LeetRecall: extension installed/updated — setting up daily alarm");

  // Remove any old alarm first to avoid duplicates
  chrome.alarms.clear("dailyReminder", () => {

    chrome.alarms.create("dailyReminder", {
      when: getNext9am(),      // first fire: next 9am
      periodInMinutes: 1440   // then every 24 hours after that
                               // 1440 minutes = 24 hours exactly
    });

    console.log("LeetRecall: daily reminder alarm set for 9am every day");
  });
});

/**
 * Listens for the alarm to fire.
 * When it does — check if there are due problems,
 * and if yes — show a notification to the user.
 */
chrome.alarms.onAlarm.addListener((alarm) => {

  // Safety check — only handle our specific alarm
  // (there could be other alarms from other extensions)
  if (alarm.name !== "dailyReminder") return;

  console.log("LeetRecall: daily alarm fired — checking due problems");

  chrome.storage.local.get({ problems: [] }, ({ problems }) => {

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Count due problems
    const dueProblems = problems.filter(p => {
      return new Date(p.nextReview) <= today;
    });

    const dueCount = dueProblems.length;

    // Only notify if there is actually something to review
    // No point bothering the user if everything is caught up
    if (dueCount === 0) {
      console.log("LeetRecall: no problems due today — skipping notification");
      return;
    }

    // Build the notification message
    const title   = `LeetRecall — ${dueCount} problem${dueCount > 1 ? "s" : ""} due today`;
    const message = dueCount === 1
      ? "You have 1 problem waiting for review. Keep your streak alive!"
      : `You have ${dueCount} problems waiting for review. Don't let your streak break!`;

    // Show the notification
    chrome.notifications.create("leetrecall-daily", {
      type:     "basic",
      iconUrl:  "icon128.png",
      title:    title,
      message:  message,
      priority: 1  // 0 = default, 1 = higher, 2 = highest (requires interaction)
    });

    console.log(`LeetRecall: notification sent — ${dueCount} problems due`);
  });
});



// PART 3 — CLICK NOTIFICATION TO OPEN POPUP
// When user clicks the notification, open the extension popup


chrome.notifications.onClicked.addListener((notificationId) => {
  // Only handle our own notifications
  if (notificationId !== "leetrecall-daily") return;

  // Clear the notification
  chrome.notifications.clear(notificationId);

  // Open the full dashboard in a new tab
  chrome.tabs.create({
    url: chrome.runtime.getURL("index.html")
  });
});
