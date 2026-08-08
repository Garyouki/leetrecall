# LeetRecall

> A Chrome extension that turns your LeetCode grind into actual long-term memory.

![Dashboard](assets/LeetRecall_Dashboard.png)


## The Problem

1) You solve a LeetCode problem today. Feel good about it. Come back two weeks later and you've completely forgotten how to approach it. You re-solve it from scratch. This cycle repeats forever.

2) Most people treat LeetCode like a checklist- solve it once, move on. That's why they blank out in interviews on problems they've "already done."


## The Goal

1) Get mastery over LeetCode questions to prep for technical interviews. Push as many problems as possible to **Mastered** and keep as few as possible at **Novice**.

2) LeetRecall tracks every problem you solve, detects how well you actually know it, and tells you exactly when to review it again, so you stop forgetting what you've already learned.

3) It uses spaced repetition, the same technique behind top memory apps like Anki. Problems you struggle with come back sooner. Problems you know well are spaced out over weeks or months.

## Installation

1. Download this repo — click the green **Code** button above, then **Download ZIP**, and extract the folder anywhere on your computer
2. Open Chrome and go to `chrome://extensions`

![Extensions page](assets/install-extensions-page.png)

3. Turn on **Developer Mode** using the toggle in the top right corner as shown below.

![Extensions page](assets/Developer_mode_extenstion.png)

4. Click **Load unpacked** and select the `leetrecall` folder you just extracted
5. The LeetRecall icon will appear in your Chrome toolbar- click the puzzle piece icon in the toolbar and **Pin LeetRecall** so it's always visible at the top

![Toolbar icon](assets/install-icon-toolbar.png)

> **Note:** After loading the extension, close and reopen your browser once. LeetRecall registers properly only after a fresh browser start — without this, it may not track your submissions correctly.


## How It Works

**1. Tracks automatically**

LeetRecall listens silently to every submission you make on LeetCode. It captures whether you got Accepted or Wrong Answer, how long you took, how many attempts you needed, and whether you peeked at the Solutions or Editorial tab.

![Tracks automatically](assets/LeetCode_Problem_Extension.png)

**2. Detects your proficiency per problem**

After each submission it updates your proficiency level for that problem:

Novice → Learning → Familiar → Proficient → Mastered

![Proficiency levels](assets/Proficiency.png)

**3. Recommends smarter reviews**

Your review queue prioritizes problems where proficiency is low. As you improve on a problem, it shows up less and less. The aim is maximum Mastered, minimum Novice.


## What It Looks Like

1) The popup shows your due problems for today. Click any problem to go straight to it on LeetCode.

![Popup](assets/Plugin_Snapshot.png)

The full dashboard shows every problem you've tracked — next review date, acceptance rate, average solve time, proficiency badge, and status.

To revisit specific problems tomorrow, select them in the dashboard and click **Redo tomorrow**. Their next review is moved to tomorrow without adding a submission or changing their proficiency, and they will appear in **Due Today** when tomorrow arrives.

![Dashboard on LeetCode](assets/LeetCode_Problem_Extension.png)

2) When you clear all your due problems for the day, the popup shows a clean slate — nothing pending, you're all caught up.

![Popup](assets/Initial_LeetRecall_popup.png)


## Using LeetRecall

**Solving problems**

1) Just use LeetCode normally. Open any problem, write your solution, click Submit. LeetRecall handles everything silently in the background.

2) One important thing: if you click the Solutions or Editorial tab on a problem, LeetRecall treats it as a failed attempt even if you submit correctly after. 
The reasoning is simple: if you needed to look at the answer, you don't really know the problem yet. It schedules it for review today itself so you can try again the same day.

**Where to find your problems after solving**

1) If you got a wrong answer or viewed the solution, it shows up in "Due Today" Tab immediately on same day. You can come back later that evening and it will already be waiting for you.

2) If you solved correctly, the next review depends on how independently and fluently you solved it. A difficult solve returns tomorrow; a clean solve is spaced out further.

So the rule is simple: wrong today means due today. Any independent Accepted submission gets at least one night of spacing.

![Due Today Tab](assets/Wrong_Solved_Due_Today.png)

**Checking what's due**

Click the LeetRecall icon in your Chrome toolbar. The Due Today tab shows every problem scheduled for today or overdue. Click any problem title to go directly to it on LeetCode.

![Popup](assets/Plugin_Snapshot.png)

**Full dashboard**

Click **View All Problems** in the popup to open the dashboard. From here you can see all your tracked problems, filter by due/mastered, search by name, and see your full stats.

![View All Problems Button](assets/View_all_problems.png)

**Daily reminders**

At 9am every day, if you have problems due, you'll get a browser notification. Click it and the dashboard opens directly.

If your laptop was closed at 9am, no worries, the red colored badge counter on the extension icon always shows your due count the moment you open Chrome.

![Badge Counter](assets/badge_counter.png)

## Proficiency Levels

| Level | What it means |
|---|---|
| Novice | Never successfully reviewed |
| Learning | Early stage, still building familiarity |
| Familiar | Getting comfortable, a few solid reviews |
| Proficient | Consistent good performance |
| Mastered | Strong performance across many reviews — comes back every few months |


## How the Scoring Works

After each submission, LeetRecall gives it a quality score from 0 to 5.

| Score | When |
|---|---|
| 5 | Solved in under 15 min, first attempt |
| 4 | Solved in under 30 min, first attempt |
| 3 | Solved with 1 to 2 attempts |
| 2 | Solved with 3 to 4 attempts |
| 1 | Solved with more than 4 attempts |
| 0 | Wrong answer, viewed solution, or gave up |

The first review gap reflects both independence and fluency:

| Score | First review gap |
|---|---|
| 5 | 5 days |
| 4 | 3 days |
| 3 | 2 days |
| 1-2 | 1 day |
| 0 | Same day |

Only score 0 resets the problem to Due Today. A score of 1 or 2 still means the problem was solved independently, so it starts a short one-day relearning step. Later successful reviews grow from the previous interval using the problem's SM-2 ease factor.

## Backup and migration

The dashboard can export all local problem history to a JSON backup and import it later. Importing replaces the data currently stored by that extension.

Chrome isolates local storage by extension ID. Normal upgrades to the same Chrome Web Store listing keep their data, but a fork published as a new listing receives a new ID. Export from the old extension before uninstalling it, then import that backup into the fork.



## Troubleshooting

**Submissions not being tracked**

Go to `chrome://extensions`, find LeetRecall, and click the reload icon. Then close and reopen the LeetCode tab.

**Clearing all data and starting fresh**

Open any LeetCode page, press F12 to open DevTools, go to the Console tab, and run:

```
chrome.storage.local.clear(() => console.log("cleared"))
```


## Tech

Built with plain JavaScript, Chrome Extension Manifest V3, and the SM-2 spaced repetition algorithm. No frameworks, no external dependencies, no servers. Everything runs locally in your browser.
