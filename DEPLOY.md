# Running Postara on a server (24/7, for you and other people)

A phone goes to sleep, loses signal and gets its apps stopped by Android. A small rented server does not.
It also lets several people use the app from their own phones, each with their own account.

You need:
- A small Linux server (Ubuntu 22.04 or 24.04). 1 GB of memory is enough for 1 to 3 accounts, 2 GB for 4 to 8. Every account keeps its own live WhatsApp connection.
- A web address (a domain) pointing at the server. A free one from duckdns.org works.

## 1. Set up the server (about 15 minutes)

Log in to the server (your provider shows you how), then:

    curl -fsSL https://get.docker.com | sh

## 2. Put the app on the server

Upload the `whatsapp-poster` folder, or from your GitHub:

    git clone https://github.com/YOUR-NAME/whatsapp-poster.git
    cd whatsapp-poster

## 3. Fill in your settings

    cp .env.example .env
    nano .env

Set these two lines, then save (Ctrl+O, Enter, Ctrl+X):

    ADMIN_PASSWORD=choose-a-long-password
    DOMAIN=poster.example.com

## 4. Start it

    docker compose up -d --build

Open `https://poster.example.com`, sign in as `admin` with your ADMIN_PASSWORD, and link your WhatsApp
(Home, Link your WhatsApp). It restarts by itself after a crash or a server restart.

## Adding people

Settings, **People**, Add someone: a username and a first password. Send them the web address.
Each person links their own WhatsApp and sets up their own vendors, groups, schedule, profit and AI key.
They cannot see each other's things. You (the admin) can reset a password or remove a person.

## Every day use

- See if it is running: `docker compose ps`
- See what it is doing: `docker compose logs -f app`
- Update to a new version: upload the new files (or `git pull`), then `docker compose up -d --build`
  (the in-app "App updates" button is for a phone; on a server use this instead)
- **Back up the `data` folder.** It holds the accounts, the WhatsApp links, settings and posts.

## Moving from your phone

Link WhatsApp again on the server (Home, Link your WhatsApp) and stop the app on the phone with `bash stop.sh`.
A WhatsApp link should only be running in one place at a time. Your settings do not move by themselves;
copy the phone's `data` folder into the server's `data` folder first if you want to keep them
(then stop the phone app before you start the server).

## Without Docker

    npm install
    HOST=0.0.0.0 ADMIN_PASSWORD=choose-a-long-password POSTER_SUPERVISED=1 npm start

To keep it running after you log out and after restarts: `npm i -g pm2`, then `pm2 start src/index.js --name postara`, `pm2 save`, `pm2 startup`.
You still need HTTPS in front of it (Caddy or nginx), because passwords are sent from the browser.

## Please know

- Anyone who has the address can see the sign-in page, so use long passwords. Ten wrong tries from one place block it for ten minutes.
- Posting through a linked device is not an official WhatsApp feature. Every linked number carries a small risk of being restricted, the same as before. Spacing posts out (Settings, Schedule) helps.
- Without HTTPS, passwords travel in the open. Use the domain setup above.
