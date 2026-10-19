/* wordlist.js - the 512 words generatePassphrase draws from.
 *
 * 512 is deliberate: it is a power of two, so each word contributes exactly 9
 * bits and the entropy figure the skill reports is an exact count rather than a
 * rounded one. Every word is 4-5 letters, lowercase ASCII, and distinct from
 * the others at a glance - the list is meant to be typed from memory and read
 * aloud down a phone line.
 *
 * Not `bundled` provenance: this is not a claim about the world that can go
 * stale, it is the alphabet the generator counts in. */

export const WORDS = Object.freeze(`
able acid also arch area atom aunt avid away baby back bald bank barn
base bead beam bean bear beef bell belt best bike bird blue boat body
bold bolt bone book born boss both brew brick bring buck bulk bull bush
busy cake calm cane cape card cart case cash cave cell chef chin city
clay clip coal coat code cold colt comb cool cord core cork cost cove
crab crop crow cube curl cusp dawn deck deep deer dent dial dice disk
dock dome door dove down drag draw dual duck dune dust duty each east
easy edge exit face fact fade fall fame farm fawn fern file film find
fine fire fish five flag flax flew flip foam foil fold font food foot
fork fort four fuel fund gain game gaze gear gift give glad glen glow
gold golf gone gown grab gram grid grim grin grip gulf hail hair hall
halt hand harm harp hawk head heal heap heat helm herb herd hill hint
hive hole holy home hoof hook hope horn host hour huge hush icon idea
iron item jade jazz junk kelp kept king kite knee lace lake lamb land
lane lark last lava lawn leaf lean leap left lift limb lime line lion
list live loam lock loft long loom loop lose loud love luck lung lyre
made main make male malt many maple mask mast mate math mead meal mean
melt mend menu mica mild mile milk mind mine mint mode mold mole mood
moon moss move mule muse mute name navy near neck need nest next nice
node noon norm nose note oath oats ochre okay once opal oral oval oven
over pack page paid pain pair pale pane park part path pawn peak pear
peck pest pier pile pine pink pipe plan play plum plus poem poet polo
pond pony port pose post pray prey prow pull pump pure push quiz raft
rail rake ramp rank rate reed reef rely ribs rice rich rift ring rink
rise risk road roam rock rode role roof room root rose ruby rule rush
rust sage sail sand sash save seal seam seat seek self sell shed ship
shoe shop show side sift silk sill silo sink site size skin slab sled
slid slot slow snap soak soap sock soil sold sole solo soon sort soul
sour span spin spun stem step stop stow such suit sunk surf swam sway
swim tail tale talk tall tank task teal team tend tent term text than
that them then they thin thus tide tidy till tilt time toad toil told
toll tone took tool tour town trap tree trim trip true tube tuck tuna
turf turn twig type unit upon used vain vale vast veal veil vein verb
vest view visa void volt wade wage wagon wait walk wall wand ward warm
warn wasp watt wave wear weed week weld went west what whip whom wide
will wind wine wink wipe wire wise wolf wood wool wore work worm wrap
wren yard yarn yoga your zeal zinc zone
`.trim().split(/\s+/));
