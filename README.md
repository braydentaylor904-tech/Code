# Top-Down Fishing MVP

A lightweight canvas prototype of a top-down fishing game with data-driven fish, maps, and gear.

## MVP Features

- Top-down camera centered on a boat with visible surrounding water.
- Click-to-cast targeting.
- Character in boat rotates toward cast point.
- Bobber travel and landing animation.
- Randomized bite timing with optional fake nibbles.
- Real bite reaction window (press `Space` to set hook).
- Reeling mini-game (hold/release `Space` to control meter).
- Fish-specific fight difficulty and rarity.
- Structured gameplay states:
  - `idle`
  - `casting`
  - `waiting_for_bite`
  - `bite_window`
  - `hooked`
  - `reeling`
  - `caught`
  - `failed`

## Data-Driven Content

Content is configured in `game.js` under `DATA`:

- `DATA.gear` defines rod and line tuning values (hook window, meter rise/fall speed).
- `DATA.maps` defines map metadata and fish pool.
- Each fish defines rarity, value, and `difficulty` tuning.

To add more content:

1. Add a new map in `DATA.maps` with its own fish pool.
2. Add fish objects to the pool with rarity and difficulty values.
3. Swap `game.map` on initialization (or add map selection UI).

## Run Locally

Open `index.html` directly, or serve the folder:

```bash
python -m http.server 8000
```

Then browse to `http://localhost:8000`.
