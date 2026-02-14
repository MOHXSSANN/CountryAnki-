# Flag Master — Country Flag Spaced Repetition Game

A polished, game-like web application for learning world flags using spaced repetition (SM-2 algorithm, similar to Anki). Built with vanilla HTML, CSS, and JavaScript — 100% static and ready for GitHub Pages deployment.

![Flag Master](https://flagcdn.com/w320/us.png)

## Features

- **SM-2 Spaced Repetition** — Cards are scheduled based on the proven Anki algorithm
- **Smart Distractors** — Wrong answers are chosen from same continent, similar colors, and similar flag layouts
- **5 Game Modes** — Study (SRS), Endless, Timed (30/60 sec), Continent, Hard (type answer)
- **XP & Levels** — Gamified progression with streaks and bonuses
- **Progress Dashboard** — Mastered, learning, struggling stats + continent breakdown
- **Full Persistence** — All progress saved in localStorage
- **195+ Countries** — All sovereign nations with flags from [flagcdn.com](https://flagcdn.com)
- **Responsive Design** — Works on mobile and desktop
- **Keyboard Shortcuts** — Press 1–4 to select answers

## Project Structure

```
/
├── index.html          # Main app
├── style.css           # Dark theme, animations
├── script.js           # Game logic, SM-2, persistence
├── data/
│   └── countries.json  # Country data (name, code, continent, colors, layout)
├── assets/
│   └── sounds/         # Optional sound effects
└── README.md           # This file
```

## Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/CountryAnki.git
   cd CountryAnki
   ```

2. **Run locally** (any static server)
   ```bash
   # Python 3
   python -m http.server 8000

   # Node.js (npx)
   npx serve .

   # Or open index.html directly (may have CORS issues with fetch)
   ```

3. Open `http://localhost:8000` in your browser.

## Deploy to GitHub Pages

### Option A: From `main` branch (root)

1. Push the project to GitHub.
2. Go to **Settings → Pages**.
3. **Source:** Deploy from a branch.
4. **Branch:** `main` / `root`.
5. Save. The site will be at `https://YOUR_USERNAME.github.io/CountryAnki/`.

### Option B: From `gh-pages` branch

1. Create a branch and push:
   ```bash
   git checkout -b gh-pages
   git push -u origin gh-pages
   ```
2. In **Settings → Pages**, set source to `gh-pages`.
3. Site URL: `https://YOUR_USERNAME.github.io/CountryAnki/`.

### Option C: GitHub Actions

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .
      - uses: actions/deploy-pages@v4
        id: deployment
```

Then in **Settings → Pages**, choose "GitHub Actions" as the source.

## Important: Base Path for GitHub Pages

If the repo is `YOUR_USERNAME/CountryAnki`, the app will be served at:

`https://YOUR_USERNAME.github.io/CountryAnki/`

Ensure paths work with this base. Current setup uses relative paths (`data/countries.json`, `style.css`, etc.), so it will work when the repo name is the project root (e.g. `mohxssann.github.io/CountryAnki`).

## How It Works

- **Study Mode:** Uses SM-2 for intervals. Due cards are shown first; new countries are added gradually.
- **Distractors:** Chosen by continent, shared colors, and layout for harder questions.
- **XP:** +10 base, +5 per streak. Wrong answers: -5 XP.
- **Levels:** XP thresholds: 100, 250, 500, 850, 1300, 1850, 2500, 3250, 4100, 5050.

## Tech Stack

- Vanilla HTML5, CSS3, JavaScript
- No build step, no frameworks
- [flagcdn.com](https://flagcdn.com) for flag images
- localStorage for persistence

## License

MIT
