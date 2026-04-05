# Maze Sabotage Arena

Realtime multiplayer maze race for 2 to 4 players with a shared dashboard.

## What is included

- Server-authoritative movement and sabotage logic
- Shared 11x11 maze that regenerates every round
- Player join flow with color assignment from the 4 corners
- Goal scoring, action points, round win handling, and maze reset
- All 5 sabotage actions from the spec
- Player view with keyboard and touch controls
- Shared dashboard mode from the same client at `/?mode=dashboard`

## Project structure

- `server.js`: static file server, WebSocket server, game rules, and maze generation
- `public/index.html`: main UI shell for player and dashboard modes
- `public/styles.css`: responsive styling for mobile and shared-screen display
- `public/app.js`: client-side WebSocket sync, rendering, input, and sabotage UI

## Run

1. Install Node.js 18+.
2. Run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000` on player devices.
5. Open `http://localhost:3000/?mode=dashboard` on the shared screen.

## Notes

- Re-targeting the same player within 5 seconds adds a +1 action point penalty.
- Targets also receive brief sabotage immunity after being hit to reduce spam.
- Only one active timed effect can exist on a player at once; new effects overwrite the old one.
