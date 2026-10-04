# Wave Player: Music Player with a Doubly Linked List

Workshop for the **Data Structures** course: a music player built with **TypeScript** where every playlist is a **doubly linked list** of songs.

- **Live demo:** https://rmusic-iota.vercel.app/
- **Repository:** https://github.com/Kevin-Basante/Rmusic

## Features

| Requirement | How it works |
| --- | --- |
| Frontend where the user can interact | Spotify-like dark interface built with Vite + TypeScript (no framework) |
| Add a song at the **start**, at the **end** and at **any position** | `prepend()`, `append()` and `insert(index)` of the doubly linked list, available from every "Add" dialog |
| **Remove** a song | `removeNode()` unlinks the node in O(1) using its `prev` and `next` pointers |
| **Next** song | Follows the `next` pointer of the current node |
| **Previous** song | Follows the `prev` pointer of the current node |
| Load songs downloaded on the computer | "Import music" button or drag and drop (MP3, WAV, OGG, M4A, FLAC). Title, artist and cover are read from the ID3 tags |
| Load music from another platform with an external API | [Jamendo API](https://developer.jamendo.com/v3.0): free, full-length songs with search and genres |
| Create playlists | Create, rename and delete playlists; reorder songs with drag and drop or the arrow buttons |
| Decorator pattern | Shuffle, Repeat, Fade and Logger are decorators that wrap the base player |

Extra features:

- **Linked list view:** draws every node of the playlist with its `prev` / `next` pointers, the `HEAD`, `TAIL` and `CURRENT` labels, and the output of `printList()`.
- **Now playing panel:** cover, real-time audio visualizer (Web Audio API), the songs pointed by `current.prev` and `current.next`, the active decorator chain and an activity log.
- Library and playlists are saved in the browser (IndexedDB), including the local audio files.
- Keyboard shortcuts: `Space` play/pause, `Shift + →` next, `Shift + ←` previous.
- Media keys and lock-screen controls (Media Session API).
- Responsive design for mobile.

## Doubly linked list

`src/structures/Node.ts`

```ts
class Node<T> {
  value: T;
  next: Node<T> | null;
  prev: Node<T> | null;
}
```

`src/structures/DoublyLinkedList.ts`

| Method | Description | Complexity |
| --- | --- | --- |
| `append(value)` | Add to the end | O(1) |
| `prepend(value)` | Add to the start | O(1) |
| `traverseToIndex(index)` | Get the node at an index (starts from the head or the tail, whichever is closer) | O(n/2) |
| `insert(index, value)` | Insert at any position | O(n) |
| `remove(index)` | Remove by position | O(n) |
| `removeNode(node)` | Remove a known node | O(1) |
| `move(from, to)` | Move a value to another position | O(n) |
| `toArray()` / `toArrayReverse()` | Traverse forward (`next`) or backward (`prev`) | O(n) |
| `printList()` | `null <- A <-> B <-> C -> null` | O(n) |

`src/models/Playlist.ts` wraps the list and keeps a `current` pointer to the node being played. `next()` and `previous()` move that pointer through `current.next` and `current.prev`.

## Decorator pattern

```
MusicPlayer (interface)
├── BasePlayer             plays the playlist in order
└── PlayerDecorator        wraps another MusicPlayer and forwards every call
    ├── ShuffleDecorator   random order without repeating songs
    ├── RepeatDecorator    "all" (tail connects to head) or "one"
    ├── FadeDecorator      smooth fade-in / fade-out
    └── LoggerDecorator    records every operation in the activity panel
```

The chain is rebuilt whenever the user toggles shuffle, repeat or fade, for example:

```ts
let player: MusicPlayer = new BasePlayer(engine, resolveUrl);
if (settings.fade) player = new FadeDecorator(player);
if (settings.shuffle) player = new ShuffleDecorator(player);
if (settings.repeat !== 'off') player = new RepeatDecorator(player, settings.repeat);
player = new LoggerDecorator(player);
```

The current chain is shown in the "Decorator chain" section of the Now Playing panel.

## Project structure

```
src/
├── structures/      Node and DoublyLinkedList
├── models/          Song and Playlist
├── player/          AudioEngine, MusicPlayer interface, BasePlayer
│   └── decorators/  PlayerDecorator, Shuffle, Repeat, Fade, Logger
├── services/        Jamendo API client, IndexedDB storage, ID3 tag reader
└── ui/              App (views and events), Visualizer, icons
tests/               Unit tests for the list and the playlist (Vitest)
```

## Running locally

```bash
npm install
npm run dev
```

Other scripts:

```bash
npm test         # unit tests
npm run build    # type-check and production build (dist/)
```

The Jamendo Client ID is read from `.env` (`VITE_JAMENDO_CLIENT_ID`). It can also be changed in the app under **Settings**.

## Deploying to Vercel

1. Import the GitHub repository in [vercel.com/new](https://vercel.com/new). The **Vite** preset is detected automatically.
2. Deploy. The Jamendo Client ID is already in `.env`, so no extra configuration is needed.

## Author

Kevin, Data Structures, fourth semester (2026-2). Instructor: Jhonatan Andres Mideros Narvaez.
