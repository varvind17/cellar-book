# Cellar Book

A personal wine journal, cellar tracker and sommelier that runs as a home-screen web app on iPhone (and in any browser).

- **Log a wine:** snap the label and Claude fills in the producer, vintage, grapes, region, drinking window and price. Edit, optionally rate (Love / Like / Meh / Dislike), and save. Your location is saved with tastings.
- **Scan a list:** photograph a wine list, receipt, shelf or rack. Claude finds every wine, you tick the ones you want, and they go to your cellar, Want to try, or tasted.
- **Cellar:** bottles on hand, grouped by drinking window.
- **The story:** each wine gets a write-up of the region's history, the winemaker, climate and soils, and what's unique about it.
- **Ask:** chat about your wines; Claude can log wines for you.
- **Map:** where your wines come from and where you drank them.
- **Pick for me:** photos of a restaurant list or shop shelf → ranked picks for your palate.
- **Palate:** charts and a written profile of your taste.
- **Wine page:** quick facts at the top, then your cellar, tastings, a tasting profile (sliders for body, sweetness, acidity, tannin, oak and finish, plus aroma and flavor chips), your own photos, and the story at the bottom.
- **Wishlist:** wines you want to buy, added from your journal, by snapping a bottle, or by scanning a list. Each shows its typical price range and your good-deal price. **Price check** in a shop: snap the bottle or price tag to see if it's on your wishlist and whether the price is good, fair or high. Pick for me puts wishlist wines first.

## Where the data lives

- **On each device**, in the browser's local storage (IndexedDB).
- **In your Dropbox**, in the app's own folder (`Apps/<your Dropbox app name>/`):
  - `cellar.json`: all wines and your palate profile, synced when the app opens, after every change, and when you return to it.
  - `backups/cellar-YYYY-MM-DD.json`: one backup per day.
  - `photos/`: label photos.
- **Your Claude API key** is stored only on the device where you enter it. It is never synced or uploaded anywhere except to Anthropic's API.
- **Nothing personal is in this code.** The repository is safe to make public. Don't commit your data export to it.

## Setup (about 15 minutes, once)

### 1. Host the app on GitHub Pages (free)
1. On github.com, create a new **public** repository, e.g. `cellar-book`.
2. Choose **uploading an existing file** and drag in everything in this folder (`index.html`, `styles.css`, `sw.js`, `manifest.webmanifest`, `README.md`, and the `js`, `lib` and `icons` folders). Commit.
3. Go to **Settings → Pages**, set **Source** to *Deploy from a branch*, branch **main**, folder **/ (root)**, and Save.
4. After a minute your app is live at `https://<your-username>.github.io/cellar-book/`.

### 2. Get a Claude API key
1. Go to [console.anthropic.com](https://console.anthropic.com), add a payment method and some credits, and **set a monthly spend limit** (e.g. $10).
2. Under **API keys**, create a key and copy it (it starts with `sk-ant-`).
3. Optional: to let Claude search the web when writing wine stories, make sure **web search** is enabled for your organization in the Console. If it isn't, stories are written without it.

Typical cost with Claude Sonnet 5.5: under 1¢ per label, about 1–5¢ per story, a few cents per list scan or chat.

### 3. Create a Dropbox app (for sync)
1. Go to [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps) and click **Create app**.
2. Choose **Scoped access**, then **App folder**, and give it a unique name (e.g. `Cellar Book Varun`). Create.
3. On the **Permissions** tab, tick `files.content.write` and `files.content.read`, then **Submit**.
4. On the **Settings** tab, copy the **App key**. No redirect URI is needed.

### 4. Install on your iPhone
1. Open your GitHub Pages link in **Safari**, tap **Share → Add to Home Screen**.
2. Open **Cellar Book from the home screen**. A home-screen app keeps its own storage, separate from Safari, so do the rest inside it.
3. Tap the **gear**:
   - Paste your **Claude API key** → *Save & test*.
   - Paste your **Dropbox app key** → *Connect* → *Allow* → copy the code Dropbox shows → paste it → *Finish*.
4. Allow location when asked, so tastings are placed on your map.

### 5. Bring in your existing wines
In Settings → **Import data…**, choose `cellar-book-import.json`. Do this on whichever device has the file (e.g. your Mac's browser, connected to the same Dropbox). The wines sync to Dropbox, and every other connected device pulls them in.

## Good to know
- On iPhone, the home-screen app keeps its own storage, separate from Safari. Removing the icon from the home screen erases that copy, but connecting Dropbox again brings everything back.
- The sync chip at the top shows the sync status. Tap it to open Settings if it shows an error.

## Updating the app
Upload changed files to the same repository. The app picks up the new version the next time it opens online.
