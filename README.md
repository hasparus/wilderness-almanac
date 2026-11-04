# The Wilderness Almanac

**A sandbox campaign tool for creative GMs.**

Made for game masters planning a hexcrawl and solo players discovering a world as they go.

Create a thoughtfully generated, configurable wilderness with forests, mountains, rivers, settlements and adventure sites.

Reshape it for your campaign, track the party through fog of war, and keep notes, dice rolls and oracle answers in one place.

Works on desktop and mobile.

**[Open Wilderness Almanac](https://the.wilderness.al)**

![An autumnal map at dusk with the party journal open](docs/images/wilderness-almanac-campaign-map.png)

## Get started

Choose **New campaign**, preview and configure a world, then create your campaign.

You can then edit the map, move the party and record the adventure in the Party Journal.

Campaigns save in your browser. Export JSON for backups or another device.

Share-map links recreate the generated world without your edits or exploration.

See the [short user guide](docs/USER_GUIDE.md) for more.

## Run locally

Requires Node.js 24 or later. No backend or API keys needed.

```sh
git clone https://github.com/ursusmeles/wilderness-almanac.git
cd wilderness-almanac
npm ci
npm run dev
```

`npm run build` creates `dist/`. Optional accounts: [self-hosting](docs/SELF_HOSTING.md).

## Contribute

[Report bugs or suggest features](https://github.com/ursusmeles/wilderness-almanac/issues).
For map bugs, include the seed and a screenshot or campaign export.
For code contributions, read the [development guide](docs/DEVELOPMENT.md) and [AGENTS.md](AGENTS.md).

## License

[GNU AGPLv3](LICENSE). Built with Three.js and Vite.
[Geist fonts](public/fonts/README.md) use the SIL OFL; [Pixelarticons](public/icons/README.md) use MIT.
[Major Arcana artwork](public/images/major-arcana/README.md) is by YY Game and retains its separate usage terms.
Map generation draws inspiration from [Red Blob Games](https://www.redblobgames.com/maps/mapgen4/); visuals from Thronefall.
