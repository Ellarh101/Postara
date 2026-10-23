# Run Postara on your Android phone

This puts the whole app on your phone, so you do not need a computer. You control it from Chrome on the same phone.
It works on **Android only**. iPhones cannot run it (see the README for the computer and server options).

You will need: an Android phone, about 15 minutes, and (recommended) a Claude API key from console.anthropic.com.

## Part 1: Install Termux

Termux is a free app that lets your phone run programs like this one.

1. Install **Termux from F-Droid** (search "Termux F-Droid" and download from f-droid.org) or from the Termux page on GitHub.
2. Do **not** use the Play Store version. It is out of date and will not work.

## Part 2: Put the app on your phone

1. Download `whatsapp-poster.zip` to your phone (for example from the link, email or Drive you got it from). It lands in your Downloads folder.
2. Open Termux and run these one at a time (tap Enter after each). Allow the storage permission when asked:

       termux-setup-storage
       pkg install -y unzip
       cd ~
       unzip ~/storage/downloads/whatsapp-poster.zip
       cd whatsapp-poster
       bash termux-setup.sh

3. Wait for "All set." It takes about 5 to 10 minutes. Keep Termux open and the screen on while it works.

## Part 3: Get your free AI helper key

The AI helper reads each vendor post and writes your caption in fresh words, so the vendor's text is never reused.

1. In Chrome, open **aistudio.google.com/app/apikey** and sign in with a Google account.
2. Tap **Create API key** and copy it.
3. You will paste it into the app in Part 6. (Claude also works, but it is paid.)

## Part 4: Start the app

    bash start.sh

Leave Termux running. It will say `Control panel: http://127.0.0.1:3000`.

## Part 5: Open the control panel

1. Open **Chrome** and go to `http://localhost:3000`
2. Chrome menu (three dots), then **Add to Home screen** (or **Install app**). It now opens like a normal app with the sunset icon.

## Part 6: Link your WhatsApp

You cannot scan a code shown on the phone you are holding, so use the number option:

1. On the Home screen, under "Linking from this same phone?", type your WhatsApp number and tap **Get code**.
2. Open WhatsApp, then **Linked devices**, then **Link a device**, then **Link with phone number instead**.
3. Type the 8-letter code. The pill at the top turns to **Connected**.
4. Open **Settings**. In the **AI helper** card at the top, paste your key and tap **Save and test**. It should say the AI helper works.

## Part 7: Settings (do this once)

Open **Settings** and fill in:

- **Vendors to copy from:** tap the vendor's chat or group. If they are not in the list, add them by phone number, or ask them to send one message.
- **Where to post:** tick your groups. Switch status posting on or off.
- **Post time**, **Items per day**, and **Wait between posts**.
- **Only post recent items:** vendor posts older than this many hours are skipped. 24 means the last day. This stops old stock being posted.
- **Profit** and rounding.
- Turn **Review every post first** on for the first week.

Tap **Save**. Then on Home tap **Send test message** to check your groups.

## Every day

- Vendor posts show up in **Posts**. Check them and tap **Approve** (or **Approve all**).
- At post time the app posts up to your daily number, newest first, spaced a few minutes apart.
- If the phone has no internet at post time, posts go out when it comes back, the same day.

## A different kind of item each day

In **Settings, Categories**, add the kinds you sell (bags, shoes, sandals) in the order you want, then switch on **Post one category a day**. Each day only that day's kind is posted, so there is nothing to pick through. On Home, **Post a category now** posts a kind straight away. The full explanation is in the README.

## Keep it running all day and night

If Chrome says "localhost refused to connect", the app has stopped. It is not a fault in your settings: Android closed Termux to save battery. Do these once and it stays up:

1. **Start it the sturdy way:** `cd whatsapp-poster` then `bash start-background.sh`. Closing the window does not stop it, and it restarts itself if it crashes. Check it any time with `bash status.sh`. Stop it with `bash stop.sh`.
2. **Battery:** Settings, Apps, Termux, Battery: choose **Unrestricted** (some phones call it "Don't optimise"). Also switch off "Pause app activity if unused" or "Remove permissions" for Termux.
3. **Wake lock:** pull down the notifications, find the Termux one and tap **Acquire wakelock**. (start-background.sh also asks for it.)
4. **Lock Termux in recent apps:** open recent apps, tap Termux's icon at the top, choose **Lock**. Never swipe it away.
5. **Start after a restart:** install the free **Termux:Boot** app (from the same place you got Termux), open it once, then run `bash termux-boot.sh`.
6. **Android 12 or newer:** Android can still stop Termux's background programs. On Android 14 and newer: Settings, Developer options, switch on **Disable child process restrictions**. On Android 12 and 13 this needs one command from a computer: `adb shell "settings put global settings_enable_monitor_phantom_procs false"`.

Open the app at **http://127.0.0.1:3000** (this works even when "localhost" does not).

A phone can still lose power or signal. For real 24/7, or for several people using the app, run it on a server: see DEPLOY.md.

## Updating to a new version (one tap)

From version 1.4 on, the app updates itself from inside:

1. Save the new `whatsapp-poster.zip` to your phone's **Download** folder (just download it, do not unzip it).
2. Open the app. If a newer version is there, the Home screen shows **Version X is ready**. You can also go to **Settings, App updates** and tap **Check for an update**.
3. Tap **Install version X** and confirm. Your settings, posts and WhatsApp login stay. It installs what it needs, then restarts by itself. This can take a few minutes. Wait for the app to come back.

If an update fails, your old version is put back, so nothing is lost.

If you started the app with `bash start.sh`, it restarts on its own. If you started it another way, close it and start it again when it says it is done.

**Using GitHub instead (optional):** if you keep the app in your own GitHub repository, paste the address of its zip download (for example `https://github.com/you/your-repo/archive/refs/heads/main.zip`) in **Settings, App updates, Update from a web address**. The check then looks there too. Do not put your `data` folder or `.env` file in the repository.

**Updating from an older version than 1.4** still needs the Termux steps once (see below). After that, it is one tap.

### The one-time Termux update (only if you are on a version older than 1.4)

1. In Termux, stop the app: press **CTRL**, then **C**.
2. Copy the new version in and install it:

       cd ~
       rm -rf new && mkdir new
       cp -r ~/storage/downloads/whatsapp-poster-1/whatsapp-poster new/
       cd new/whatsapp-poster
       bash update-termux.sh

   Change the folder name in the `cp` line to match where you unzipped it.
3. Swap the folders and start it:

       cd ~
       mv whatsapp-poster whatsapp-poster-old
       mv new/whatsapp-poster whatsapp-poster
       cd whatsapp-poster
       bash start.sh

## A new app icon on your phone

The icon on your home screen is a copy made when you added the page, so an update does not change it by itself. After installing a new version: remove the old icon (long press it, Remove), open the app page in Chrome again, menu (three dots), **Add to Home screen** (or **Install app**), and the new icon appears.

## Saving your app on GitHub

In Termux, once: `cd whatsapp-poster` then `bash git-setup.sh`. After any change: `bash push.sh "what you changed"`. Your WhatsApp login and keys are never uploaded.

## If something goes wrong

- **Page will not open:** make sure Termux is still running `bash start.sh`.
- **No code or "not ready yet":** wait 10 seconds and tap Get code again.
- **Logged out:** on Home, tap Link again and repeat Part 6.
- **Vendor posts do not appear:** check the vendor is chosen in Settings and sent a picture or video. Look at the Log tab.
- **`npm install` fails:** check your internet and run `bash termux-setup.sh` again.

## Important

This uses an unofficial WhatsApp connection, so the number can be banned. Use a number you can afford to lose, keep the daily number modest, and keep the review switch on at first.
