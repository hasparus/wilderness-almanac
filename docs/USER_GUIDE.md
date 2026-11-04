# Using Wilderness Almanac

## Build your campaign

Create a world from a seed. Adjust water, elevation, forests and settlements before
creating the campaign. The same seed and world settings recreate the same map.

Edit terrain, settlements, adventure sites and roads in the Inspector.
Multiselect applies changes to several hexes at once. Undo restores an edit.
Regenerate changes the scenery while keeping geography and locations;
lock hexes whose appearance you want to keep.

Appearance offers palettes, lighting and Low poly or Pixelart models.
Pixelart uses more resources.

## Run an adventure

Move the party token to track travel. Destinations become visited.
Fog of war hides unexplored areas; turn it off to edit the map.

Use the Party Journal for notes, dice rolls and prompts.

Organize the journal by week, day or session. Mention hexes with `$`,
the party with `@`, and periods with `#`. Movement is logged automatically.
Hex exploration and the separate hex journal are not available yet.

### Party Journal commands

| Command                         | What it does                                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `/help`                         | Show commands and mentions until the next journal entry.                                                         |
| `/clear`                        | Across all periods, remove rolls and draws without notes or questions; dismiss help. Keep notes and travel logs. |
| `/abstract`                     | Draw a Major Arcana prompt with its card artwork.                                                                |
| `/oracle [modifier] [question]` | Ask a yes/no oracle. Both arguments are optional: `/oracle +1 Is the bridge guarded?`                            |
| `/d4`                           | Roll a four-sided die.                                                                                           |
| `/d6`                           | Roll a six-sided die.                                                                                            |
| `/d8`                           | Roll an eight-sided die.                                                                                         |
| `/d10`                          | Roll a ten-sided die.                                                                                            |
| `/d12`                          | Roll a twelve-sided die.                                                                                         |
| `/d20`                          | Roll a twenty-sided die.                                                                                         |
| `/explore`                      | Reserved for a future update; currently does nothing.                                                            |

Combine dice and modifiers with `+` or `-`: `/2d6+1` or `/d20-d4`.
Spaces separate rolls: `/2d6+1 4d6 1d20`. Each entry allows up to 100 dice across 20 rolls.
The oracle rolls a d6, applies the modifier and limits the result to 1–6:
No, and… / No / No, but… / Yes, but… / Yes / Yes, and….

## Keep and share your work

Campaigns save automatically in this browser and work offline after loading.
Export campaign JSON regularly: clearing browser storage can erase local work.
Import that file to continue on another device. Share-map links contain the
generated world, without your edits, journal or visited hexes.

Optional **Account & sync** saves and loads account copies on
[configured deployments](SELF_HOSTING.md). Transfers are manual.
If saving fails, download unsaved data before closing the app.

Only generator 10 campaigns are supported. Unsupported stored records remain
available through recovery downloads; recovery files cannot be imported as campaigns.
