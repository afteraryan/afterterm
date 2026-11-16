# afterterm's mascot

A glossy dark blob with two fangs, three hair strands, the app icon's three dots on its
forehead, and flat-topped eyes that make it look slightly annoyed. It has no mouth unless it
is smiling or frowning.

Everything here is plain files: no build step, no packages. The app does not use the mascot
yet; these files are for making pictures and films of it.

## What is in this folder

| File | What it is |
|---|---|
| `mascot.js` | The character: how it is drawn, its emotions, a posable copy for animation, and small helpers for timing. One script, loaded with a script tag, used through the global `Mascot`. |
| `stills/` | Ready SVG pictures: `mascot.svg` (transparent), `mascot-tile.svg` (on its pink tile) and `mood-<name>.svg` for each of the eight emotions. Written by `export.mjs`. |
| `films/fix-the-bug.html` | A finished 15 second film in landscape (16:9). Open it in a browser to watch it. |
| `films/fix-the-bug-portrait.html` | The same film in portrait (9:16), for reels and shorts. |
| `films/fix-the-bug.js` | That film's story, shared by both pages, with one layout per shape. The example to copy when making a new film. |
| `films/film.css` | The page round a film: stage, scrub bar, caption, buttons. |
| `render.mjs` | Turns a film page into an MP4, with music if you give it some. |
| `export.mjs` | Writes `stills/` again from `mascot.js`. |

The page where the character was chosen, out of sixty candidates, is
`docs/mockups/mascot-characters.html` (the mascot is number 43 there). Its history is in
Linear issue AFT-116.

## Use a still picture

Take a file from `stills/`. They are SVG, so they stay sharp at any size.

To make one with other settings, open any page that loads `mascot.js` and call:

```js
Mascot.svg({ mood: 'happy', mouth: 'smile', size: 512, background: 'tile' })
```

| Option | Values | Default |
|---|---|---|
| `mood` | `neutral`, `happy`, `sad`, `angry`, `surprised`, `confused`, `suspicious`, `cheeky` | `neutral` |
| `mouth` | `smile`, `frown`, or leave it out for no mouth | none |
| `size` | pixels | `200` |
| `background` | `none` (transparent) or `tile` (the pink rounded tile with a shadow) | `none` |
| `colors` | any of `Mascot.COLORS` to override | the brand colours |

After changing how the character is drawn, run `node assets/mascot/export.mjs` so the files
in `stills/` match.

## The character's rules

These came from Aryan's choices while the character was designed. Keep to them in new work.

- The body is one dark shape with a gradient. No shine or highlight on it, and no glow.
- The hair is the same colour as the top of the body, so it reads as part of it.
- Thin lines are for the hair only. Everything else is a filled shape.
- The three dots are always teal, orange, purple, in that order.
- The eyes are white with a flat top. An emotion changes the lid and the position of that
  same eye; it never swaps in a different eye.
- It is never shown asleep.
- Its stage is pink to purple (`stageTop` to `stageBottom`). Red means angry, blue means sad.

## Put the mascot in your own SVG and move it

```html
<svg id="stage" viewBox="0 0 800 450"></svg>
<script src="mascot.js"></script>
<script>
  const bot = Mascot.create(document.getElementById('stage'), { x: 400, y: 372, scale: 1.15 });
  bot.set({ mood: 'happy', smile: 1, y: -40 });
</script>
```

`x` and `y` in `create` are where its feet stand. `set` takes a pose; anything you leave out
keeps its last value.

| Pose field | What it does | Resting value |
|---|---|---|
| `x`, `y` | Moves it from where it stands. Up is negative `y`. | `0` |
| `scaleX`, `scaleY` | Squash and stretch, from the feet. | `1` |
| `rotate` | Leans it, in degrees, from the feet. | `0` |
| `shakeX`, `shakeY` | A small offset for trembling. | `0` |
| `hairScale` | Hair height. `1.8` stands on end, `0.55` droops. | `1` |
| `hairRotate` | Hair lean in degrees. | `0` |
| `eyeX`, `eyeY` | Where it looks, a few units each way. | `0` |
| `mood` | One of the eight emotions. The lids slide to it in a third of a second. | `neutral` |
| `wink` | Squeezes the right eye: `1` open, `0.2` shut. | `1` |
| `smile`, `frown` | The size of each mouth, `0` to `1`. | `0` |
| `dots` | The size of the three forehead dots together. | `1` |
| `dotScale` | The size of each dot, as `[teal, orange, purple]`. | `[1, 1, 1]` |
| `orbit` | The three dots as a spinner round the body, `0` to `1`. Use it with `dots: 0` for "working". | `0` |
| `orbitAngle` | The spinner's angle in degrees. | `0` |

`bot.dot(2)` gives where a forehead dot is on your stage (0 teal, 1 orange, 2 purple), for
when something has to fly off its head or back on. `bot.el` is the `<g>` element.

## Make a new film

Copy `films/fix-the-bug.js` and one of its pages, and change them. A film is one function,
`draw(t)`, that sets everything on the stage from the time in seconds and nothing else. That
is what lets it be paused, dragged and rendered to exact frames.

The pieces, all in `fix-the-bug.js`:

1. **The stage.** An 800 by 450 SVG with the backgrounds and the props (there: a task
   notification, a terminal, confetti). The mascot goes in with `Mascot.create`.
2. **Tracks.** Each moving value is a list of `[second, value, how it arrives]`:

   ```js
   const K = { y: [[0, -560], [0.38, 0, 'in'], [14.25, 0], [14.8, -620, 'in']] };
   Mascot.track(K.y, t)   // the value at time t
   ```

   The value holds before the first entry and after the last. The third item is the easing
   into that entry: `inOut` (the default), `in`, `out`, `linear`, or `back` (overshoots, then
   settles: good for things popping in).
3. **Steps.** For things that switch, such as the emotion or the caption, a list of
   `[second, value]` read with `Mascot.at(list, t)`.
4. **Hops.** A list of `[start, how many, seconds each, height]`. `Mascot.hops(list, t)`
   returns `{ y, scaleX, scaleY }` to add to the pose, with the stretch and the landing
   squash built in. Walking is hops while `x` moves.
5. **The player.** `Mascot.player({ duration, draw, bar, playButton, restartButton })` plays
   it, loops it and wires up the controls. Adding `?t=7.5` to the page's address opens it
   paused at that second.

### One story, landscape and portrait

`fix-the-bug.js` keeps the story (timing, emotions, hops) apart from the layout. `LAYOUTS`
at its top has one entry per shape: the stage size, the ground line, the mascot's size, how
far each prop is moved, where the mascot stands for each beat (`walk`) and how high it must
jump to reach each prop (`jump`). The portrait page sets `window.FILM_LAYOUT = 'portrait'`
before loading the script. To add a shape, such as a square, add an entry and a page.

In portrait the mascot is larger (1.5 against 1.15) and the task and the terminal sit above
it instead of to its sides, so it walks less and jumps more.

What made the first film work, worth keeping:

- Move fast. The drop takes 0.4 seconds and a hop about 0.2 to 0.3.
- Show the thing it reacts to on screen (the task, the terminal), then show the reaction.
- Squash before every jump and on every landing.
- Change the emotion a beat after the event, with `surprised` for a fraction of a second first.
- Keep it short. Fifteen seconds was right; twenty-four was too long.

## Render a film to a video

```
node assets/mascot/render.mjs assets/mascot/films/fix-the-bug.html out/fix-the-bug.mp4
```

It opens the page in a headless browser (no window appears), draws every frame separately,
and encodes them, so the result is smooth however slow the page runs live. The default is
1920 by 1080 at 60 frames a second; fifteen seconds takes about two minutes.

The portrait page, at reel size:

```
node assets/mascot/render.mjs assets/mascot/films/fix-the-bug-portrait.html out/fix-the-bug-portrait.mp4 --size 1080x1920
```

With music:

```
node assets/mascot/render.mjs assets/mascot/films/fix-the-bug.html out/fix-the-bug.mp4 --audio music.mp3 --audio-start 1.5
```

The sound is cut to the film's length and fades in and out (`--fade-in`, `--fade-out`, in
seconds). `--audio` also takes a video file and uses its sound. Other options: `--fps`,
`--size 1080x1080`, `--frames 60` (only the first frames, for a quick test), `--keep-frames`.

It needs Node 22 or newer, ffmpeg on PATH, and Edge or Chrome (set `MASCOT_BROWSER` to the
exe if it is not found). Music files are not kept in this repository: the repository is
public and a track's licence rarely allows that.

A film page works with `render.mjs` when it plays through `Mascot.player` and hides
everything but the stage under `html.render` (`films/film.css` does this; link it from the
new page).
