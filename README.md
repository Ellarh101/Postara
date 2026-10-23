# Postara

**Using only an Android phone? Read `PHONE-GUIDE.md`.** It runs the whole app on the phone.

Copies your vendors' product posts, adds your profit to the price, rewrites the caption so it
sounds like you, and posts to your groups and WhatsApp status at a set time every day.

- Reads the vendor chats you choose (a group or a single person).
- Skips bras, boxers, panties and other underwear (words in the caption, plus the AI looking at the pictures).
- **Writes your caption in fresh words.** The vendor's sentences are never reused. Only the facts (item, colours, sizes, price) carry over.
- Finds the vendor's price, adds your profit %, rounds it up, and puts the new price in the caption.
- Only posts recent vendor items (you choose how many hours back, 24 by default). Older ones are skipped.
- Posts a fixed number of items per day, spaced a few minutes apart.
- If the internet is off at post time, posts wait and go out when it returns (the same day).

## Renaming the app

The name shown in the app, on the home screen and in the install prompt comes from one line: `"productName"` in `package.json`.
Change it and restart. (Leave `"name"` alone: updates use it to recognise the app.) The logo is `public/icon.svg`, and the PNG icons are made from it.

## What you need

1. A computer (or server) that stays on at post time, with **Node.js 20 or newer** (nodejs.org, choose LTS).
2. The WhatsApp number you will post from. **Use a number you can afford to lose** (see "Important" below).
3. A free AI helper key. The easiest is **Google Gemini** (free tier): sign in at aistudio.google.com/app/apikey and tap Create API key. You paste it into the app, in Settings. Claude is also supported.

## Set up (about 10 minutes)

1. Unzip this folder and open a terminal inside it (on Windows: open the folder, click the address bar, type `cmd`, press Enter).
2. Run `npm install` and wait for it to finish.
3. (Optional) You can paste your AI key into the app later, in **Settings, AI helper**. A key in the `.env` file works too.
4. Run `npm start`.
5. Open **http://localhost:3000** in your browser.
6. On the Home tab, scan the code: WhatsApp on your phone, then Linked devices, then Link a device.
7. Open **Settings** and fill in:
   - **Vendors to copy from**: pick the vendor group or chat. If you do not see them, ask them to send one message, or add by phone number.
   - **Where to post**: tick your groups. Switch status posting on or off.
   - **Schedule**: post time, items per day, wait between posts.
   - **Your price**: profit % and rounding. Example: 20% on ₦8,500 is ₦10,200, rounded up to ₦10,500.
   - **Captions**: your ending text (how to order), and keep "review every post" **on** for the first week.
8. Press **Save settings**, then **Send test message to my groups** on the Home tab.

## Updating

Open **Settings, App updates**. Save the new `whatsapp-poster.zip` to your Downloads folder, tap **Check for an update**, then **Install**. Your settings, posts and WhatsApp login stay, and a failed update puts the old version back. You can also point it at a GitHub zip address. See `PHONE-GUIDE.md`.

## Using it on your phone (Android and iPhone)

The control panel is built for phones. It works in Chrome (Android) and Safari (iPhone), in light or dark mode.
The app itself keeps running on your computer or server, and your phone opens its page.

1. In `.env` set `HOST=0.0.0.0` and choose an `APP_PASSWORD`, then restart (`npm start`).
2. The terminal prints an address like `http://192.168.1.20:3000`. Open it on a phone on the same Wi-Fi. The username can be anything; the password is yours.
3. Add it to your home screen so it opens like an app:
   - **Android (Chrome):** menu (three dots), then Add to Home screen.
   - **iPhone (Safari):** Share button, then Add to Home Screen.
4. To reach it away from home, run the app on a server (see below) and use a secure tunnel or HTTPS. Do not leave a password-protected plain http page open to the internet.

If you scan the WhatsApp code from the same phone you are viewing it on, open the panel on a computer or a second device to scan.

## Every day

- Vendor posts appear in the **Posts** tab. Posts with an unclear price always wait there for you.
- Check a post, fix the caption if you like, and press **Approve**.
- At post time the app sends up to your daily number, oldest first (or newest first if you choose). Leftovers wait for tomorrow.
- **Post now** starts straight away. It still keeps to the daily limit. With the daily category on, it posts today's category.
- The **Log** tab shows what happened and why anything was skipped. Skipped posts can be restored.

## Posts with several pictures and a price list

Vendors often send ten pictures of one item in different colours, with one caption under them listing every price.
The app treats pictures one vendor sends close together as **one post**:

- It waits a short time (Settings, "Wait for the rest of a set") for the last picture and for any text.
- The caption or price list applies to the whole set. Each price gets your profit.
- The set is posted picture by picture, and **every picture carries the caption** (you can change this to first or last only).
- If the vendor types the price list a few minutes after the pictures, the app still adds it to that set.
- The whole set counts as **one** item in your daily number.
- A price list typed as a separate message just after the pictures is joined too.

## A different kind of item each day (version 1.7)

Instead of posting whatever is ready, you can post one **kind** of item a day: bags today, shoes tomorrow, sandals the day after, then round again.

1. **Settings, Categories:** add your kinds in the order you want them (the quick buttons add Bags, Shoes, Sandals and more).
2. Switch on **Post one category a day**. Use **Category for today** to say where the rotation starts. Tomorrow is the next one in the list.
3. The AI sorts every new vendor post into one of your categories (or \"Other\"). Posts that were already waiting are sorted by the words in their captions. You can change any post's category in the **Posts** tab.
4. At post time the app only takes posts from today's category, so there is nothing to pick through. The app only keeps posts from the last 24 hours, so each day's category is picked from what your vendors posted in the last day.
5. If today's category has nothing ready, the day is skipped, unless you switch on **If today's category has nothing ready, post other items**.

**Post a category now** (Home) posts one kind right away, up to your daily number, whatever today's category is. These posts count towards today's total.

The Home screen shows today's category, and how many posts are ready in each one.

## Several people, one app (version 1.8)

The app now has accounts. Each account has its own WhatsApp link, vendors, groups, schedule, profit, AI key and posts. Nobody sees anyone else's.

- **Phone, only you:** nothing changes. With one account and no password there is nothing to sign in to.
- **More people:** Settings, Your account: set a password. Then Settings, People: add a username and first password for each person. For several people to reach the app it must run on a server, see DEPLOY.md.
- Only the admin (the first account) sees People and App updates. A person's password can be changed by them (Settings, Your account) or reset by the admin.
- Accounts you already had keep working: your existing posts and settings stay with the admin account.

## Sizes (version 1.8)

When a vendor gives sizes ("SIZE RANGE 37-41", "Sizes: 2-7"), the caption gets a line `Sizes: 37-41`, even if your layout has no sizes piece. Posts without sizes get no line. Turn it off with **Always show sizes** in Caption layout.

## Which price belongs to which pictures (version 1.7.4)

Vendors usually send the pictures of one item, then a message with its price, then the pictures of the next item, then its price. The app now follows that:

- A message with a price **ends** the set. Pictures sent after it start a new post and never borrow that price.
- A price message goes to the newest set that can still take it, never to an older one, and never to a set that already has a price.
- A price typed before its pictures goes to the pictures that follow.
- Grouping uses the time the vendor sent each message, not the time the app heard about it, so a burst of old messages after a reconnect is still split into the right sets.
- If two pictures each carry their own price, they are two posts.

If a post still looks wrong, tap Skip on it. Only the last 24 hours of posts are kept anyway.

## Only the last 24 hours (version 1.7.3)

The app only shows and keeps posts from the last 24 hours. Anything older disappears from every screen and count straight away and is deleted (with its pictures) in the background. Older posts are never posted. You can make the window shorter in Settings (Only post recent items), but not longer than 24 hours.

## Tidy captions (version 1.7.2)

Vendor wording is cleaned before the AI reads it, and the caption it writes is cleaned again: underscores are removed, rows of hyphens are removed (or become a single hyphen inside a range, so `2--4` becomes `2-4`), and a word cut off at the very end of the vendor's caption (like "fi") is dropped. A single hyphen is never touched. Your own template lines and footer are left exactly as you wrote them.

## Saving your app on GitHub (Termux)

One time, from the app folder in Termux:

    bash git-setup.sh

It installs git and the GitHub tool, asks you to sign in (GitHub shows a short code, you type it in Chrome), creates a **private** repository and uploads the app. Your WhatsApp login (`data`), `.env` and keys are never uploaded.

After that, every time you change something:

    bash push.sh "what you changed"

An update from inside the app (Settings, App updates) keeps the GitHub link. The in-app \"web address\" update only works with a public repository; with a private one, keep using the zip in Downloads.

## Make it yours

In **Settings** you control:

- **Profit:** a percentage, an optional fixed amount on top, and a minimum profit per item. Each vendor can have their own percentage. Round prices up to the nearest 10, 50, 100, 500 or 1,000.
- **Caption layout:** arrange `{title}`, `{colours}`, `{sizes}`, `{details}`, `{description}`, `{prices}`, `{business}` and `{footer}` with your own words, emojis and lines around them. A line whose pieces are empty is left out. There are ready-made layouts to start from.
- **Words to remove:** list hype such as "new arrival" or "luxury" and it is cut out of every post, with the emojis stuck to it.
- **An example in your own style:** paste a post you wrote and the AI copies its tone and layout.
- **Bulk prices:** vendor shorthand like "MOQ of 3 16,500" becomes "Buy 3 or more: ₦…", with your profit added.
- **Price wording:** for one price (`Price: {price}`) and for a list (`{label}: {price}`, one line each).
- **Voice:** language (English, Pidgin, anything), emojis (none, a few, lots), length, hashtags, and free-text style notes.
- **A live preview** shows how a post will look as you change things.

Pictures are posted exactly as the vendor sent them, including any logo or watermark on them. The app cannot remove those.

## About status posts

Posting to WhatsApp status is the least reliable part. WhatsApp can silently refuse status posts from linked
apps, especially on newer or Business accounts, even though the app thinks it sent them.
This version checks WhatsApp's answer, tries both ways of listing who can see the status, and tells you in the Log
and on screen if WhatsApp refused. Use **Send test status** on the Home screen to check it works for your account before relying on it.
Look in your WhatsApp **Status** tab, under "My status".

## About "pants"

"Pants" can mean underwear or trousers. The AI helper looks at the pictures to decide.
The AI helper decides from the pictures.

## Keeping it running every day

The computer must be on and online around post time. If it was off, posts go out when it is back on, the same day.
For something more reliable, run it on a small always-on server:

    npm install -g pm2
    pm2 start src/index.js --name poster
    pm2 save && pm2 startup

On a server, set `HOST=0.0.0.0` and an `APP_PASSWORD` in `.env`. Use an SSH tunnel or HTTPS in front of it, because the password is sent in plain text over plain http.

## Important

- **This uses an unofficial WhatsApp connection (Baileys).** WhatsApp's official Business API cannot post to status and cannot post to groups the way this does. Unofficial tools are against WhatsApp's rules, and the number can be banned. Keep the daily number modest, keep the spacing between posts, and do not use your only business number.
- The app stays logged in using the `data/auth` folder. Never share or upload it. Anyone with it can use your WhatsApp.
- Status posts go to the contacts WhatsApp shared with the app. Right after linking this list can take a few minutes to fill.
- Always check the first posts. AI can misread a price or a picture. Turn review off only once you trust it.
- Each post is one short request to the AI helper. Gemini's free tier has daily limits, and Google may use free-tier content to improve its products. What gets sent is the vendor's pictures and caption.
- Pictures are the vendor's. Make sure you have their agreement to repost them.

## Limits of this version

- One WhatsApp number, one set of settings.
- Only pictures and videos are picked up. Text-only vendor posts are ignored.
- For videos, the underwear check uses WhatsApp's preview frame.
- Posts older than your "recent" window are skipped. You can bring one back with Restore.

## Troubleshooting

- **Code does not appear**: wait 20 seconds, refresh. Check the Log tab.
- **"Logged out"**: press Link again and scan again.
- **Vendor posts do not show up**: confirm the vendor chat is added in Settings, the number is connected, and the vendor sent a picture or video.
- **Port in use**: change `PORT` in `.env`.
- **Run the checks**: `npm test` (price reading, underwear filter, daily limit, offline catch-up).

## Files

    src/index.js       starts everything
    src/whatsapp.js    WhatsApp link: reads vendor chats, sends posts
    src/pipeline.js    filter, price, caption for each vendor post
    src/ai.js          asks Claude to read the picture and rewrite the caption
    src/filters.js     underwear words, price reading, profit and rounding
    src/scheduler.js   daily timing, limit, offline catch-up
    src/server.js      the control panel's back end
    public/            the control panel
    test/              automatic checks
    src/updater.js     in-app updates
    src/categories.js  today's category, and sorting posts by their words
    termux-setup.sh    one-time setup on an Android phone
    git-setup.sh       one-time: put the app on your GitHub (Termux)
    start-background.sh / stop.sh / status.sh / termux-boot.sh   keep it running on a phone
    Dockerfile, docker-compose.yml, DEPLOY.md   run it on a server
    src/users.js, src/tenants.js, src/api.js    accounts and one copy of the app per account
    push.sh            save a change to GitHub in one command
    update-termux.sh   moves your data to a new version on a phone
    start.sh           starts the app on a phone and restarts it if it stops
    data/              created on first run: your posts (poster.json), settings and WhatsApp login
