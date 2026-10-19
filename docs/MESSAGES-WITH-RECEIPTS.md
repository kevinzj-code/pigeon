# Messages With Receipts: a from-scratch redesign of Pigeon's flow

**Where this came from.** The review scores were split across two labels. The third review's scores were filed under numbered names ("3. Show Your Work" and so on). Once those are merged, the totals are:

| Design | Total |
|---|---|
| Every Pigeon Says Hello | 23 |
| Contacts With a Job | 23 |
| Just Messages | 22 |
| Show Your Work | 22 |
| Speed Dial | 18 |

I started from **Every Pigeon Says Hello** because all three reviews borrowed from it. From it I kept three ideas:
- a Pigeon is introduced by a card before anyone sends it anything;
- the download is offered at the moment it's needed;
- "joined" gets rehearsed before the first import.

I took the rest from the others:
- **Contacts With a Job:** the split between Pigeons that start fresh and Pigeons that remember, and cards built from what a Pigeon actually did.
- **Just Messages:** the texting idioms, meaning quote-attached replies, the reply bar and wake-and-retry.
- **Show Your Work:** the line under every reply and "I took this as".

**Conflicts between the designs, and how I settled them**

| Conflict | Settled as | Why |
|---|---|---|
| Suggestion chips that send (Hello) vs chips that type (today) | **Every chip types exactly the text it shows and never sends.** Chips are outlined and carry a small text glyph. Anything that acts is a filled button with a verb on it ("Try again", "Download"). | Two reviews flagged chips that send. One rule for every chip, and the two can be told apart by looking. |
| Download offered as a message from Patch vs "system events aren't in a contact's voice" | Patch says only what *he* can't do. The download offer is a centred **system card** under that reply, drawn with the app icon, with no bubble shape and no contact name. | Honest about who is speaking, and still offered when it's needed. |
| One thread per contact (Just Messages, Speed Dial) vs several chats per Pigeon (decided earlier) | **Several chats, kept.** Each chat is named from the person's first words and dated the way Messages dates rows. A Pigeon's page offers **Continue** on its latest chat. Where a writer's memory ends is shown by a line in the chat. | The brief says "like a ChatGPT or Claude project", and a project holds many chats. Names and dates make last Tuesday's chat findable. |
| "Never grey out an installed contact" vs "don't accept a Pigeon whose base model is missing" | A Pigeon that can't run is **refused or held at import**, so it never becomes an installed contact. Nothing installed is ever greyed out. | Both rules hold. |
| Soften the handoff guard (Just Messages, Show Your Work) vs keep dropping guessed figures | **Keep dropping them.** The Couldn't teaches the move that works: "Put the amounts in your message and Pen will use them." | The promise stays intact, and the reply still leads somewhere. |
| Hide the skill in Info vs "Worked out must show what Patch read" | An **"I took this as"** line inside every worked-out bubble. It shows only values the person gave or Patch asked for; defaults are written as words. Scores stay in Info, collapsed. | A wrong skill pick has to show on the answer itself, and a default must not look like an assumption. |
| Many reply labels vs a cap | **Four marks:** Worked out, Looked up, Written, Couldn't. Patch's questions pass through two states, *Waiting on you* and *Skipped*. | A web quote isn't code's work, so it can't share code's mark. Four is still small enough to learn at a glance. |
| Web consent as a chip vs a sheet | **A sheet** that shows the exact text and **both** sites it goes to. Closing it counts as no. The default is that Patch looks things up only when the person presses **Look it up…**. Every look-up is logged. | Consent must not invite a reflex tap, and must not misstate where the text goes. |
| Red "!" on the person's own bubble vs a plain sentence | A **Couldn't** reply that says what failed, then offers an action. | "Not delivered" misstates what happened. |
| Image text only in Patch chats (Hello) vs in every chat | **Every chat**, as input the person has confirmed. In one-shot chats it replaces the box text rather than being added to it. | The text read from an image is the person's own input, shown and editable before sending. The menu bar already works this way. |
| Patch asking back through the reply bar vs a field inside his bubble | **Reply bar**, plus a strict hold on the send queue. | It's a familiar idiom, and the hold rule settles the one ambiguity. |
| Passing results between Pigeons vs forwarding only the question | **Question only.** Figures don't travel either; the person copies them. | This is the project's rule, and chains of generated text were flagged as a risk. |
| A hello chat created on every join vs list clutter | **No chat is created.** The card is the Pigeon's page and sits at the top of every new chat. A new chat becomes a list row only once something is sent or typed. | There's never a question of which chat is "the real one", and no empty rows appear. |
| A fresh popover on every open vs keeping what the person was doing | **Unsent text and captures stay** until sent or removed with ×. A finished exchange folds to one line with **Copy** and stays until the next send. | Nothing typed or captured is ever lost to a click into Mail. |

---

## 1. The idea in one paragraph

Each Pigeon is a contact on the person's Mac that has a job, like a small custom GPT or a Claude project. Clicking one opens its page. The page says what it's for, what to send, what comes back and whether it remembers, and it shows a few examples of its work, credited to its maker. Below that sit the chats with that Pigeon, a row to continue the latest one, and a box to start a new one. Everything else works like Messages: a chat list, New message, To:, bubbles, tapbacks, reply, edit, and banners inside the app.

Pigeon adds one habit on top of texting: **reading the line under a reply.** That line always says who did the work:
- **Worked out**: code did it. Patch's figures are underlined, and clicking one shows how he got it.
- **Looked up · Wikipedia**: the words are the source's own, quoted, with a link.
- **Written by Pen · may be wrong**: a small model wrote it.
- **Couldn't**: nothing was produced, and the reply says why and what to do next.

The chat header says whether this Pigeon **remembers this chat** or **starts fresh each message**. The app repeats that at the one moment it matters: when someone is about to send a follow-up to a Pigeon that can't see it. Patch gets that note too.

## 2. The mental model: six things to learn

| # | Concept | Texting idiom it maps to | Where it's taught |
|---|---|---|---|
| 1 | **A Pigeon is a contact with a job.** Its page says what it does, what to send and what you get back, with examples from its maker. | A contact card; a ChatGPT GPT or Claude project page | The Pigeon's page, and the card at the top of every new chat |
| 2 | **You have chats with Pigeons.** New message, To:, send. Several chats with the same Pigeon is fine; each is named from your first words. | Messages New message; ChatGPT New chat | The chat list, and Continue on a Pigeon's page |
| 3 | **The line under a reply says who did the work.** Worked out (underlined figures you can click), Looked up (a quote with its source), Written · may be wrong, or Couldn't. | iMessage blue vs green bubbles; underlined dates you can click | Every reply; a one-time note on the first Written reply and on the first Worked out figure |
| 4 | **Some Pigeons start fresh each message; some remember the last 12 back-and-forths.** | Texting a service number vs texting a friend | Page, header subtitle, a quote on each reply, and a note before sending a follow-up, for Patch as well as one-shot Pigeons |
| 5 | **Pigeons sleep. Sending wakes them, and the first reply takes a few seconds.** | "Sending…" under your bubble | The status under your bubble, with a countdown that never hits zero |
| 6 | **Reply quotes a message into your next one, and says what the Pigeon will see.** Patch uses it for his questions. | WhatsApp and iMessage reply bar | The bar itself states what happens |

Nothing else is needed to use the app. Kinds, lanes, models, skills and scores exist, but they live in Info, Settings and the Developer menu.

---

## 3. The core flow, screen by screen

### 3.1 Launch and the chat list

**Layout.** The window has two columns, as today. The left column holds:
- a **Search** field and a compose button (tooltip "New message ⌘N");
- two tabs, **Chats** and **Pigeons**;
- the chat list.

The "This build" footer is gone.

**Chat names.** A new chat is named from the first words of the person's first message: "buying milk for Sam", "split £87.40 three ways". It can be renamed.

**Chat rows.** Each row shows an unread dot, the avatar, a bold title, a time slot and a preview.
- **The time slot** works as in Messages: "9:41" today, "Yesterday", "Tuesday" within the week, then "9 Sept".
- **Group headers:** past today, the list is split under **Today**, **Yesterday**, **Last 7 days** and **Earlier**.
- **The preview**, in this order of priority:
  - "Title Maker is writing…"
  - red **Draft:** followed by the draft text
  - "Title Maker: Milk run for Sam"
  - "You: split £87.40 three ways"

Pinned chats sit above the list as large avatars.

**Replies that land elsewhere.** When a reply lands in a chat that isn't open, the row gets an unread dot. A banner also slides down inside the window, for example "**Title Maker** · Milk run for Sam". Clicking the banner opens that chat. A chat set to **Hide Alerts** gets the dot but no banner.

**Problems.** Real problems show as a strip across the top of the list, and nowhere else:
- "Pigeon can't save chats right now · Details"
- "Downloading · 38% · about 6 min · Pause"

**Pigeons tab.** Every installed Pigeon, with its does-line. At the bottom: "Got a .pigeon file? Drop it here, or **Add a Pigeon…**"

### 3.2 New message and To:

⌘N opens a blank pane with **To:** at the top. The composer works straight away, with the placeholder "Write something, then choose who it's for".

**The To: list.** It shows **Recent** first, then everyone A–Z. There are no kind groups. Each row has:
- the avatar and name;
- the Pigeon's does-line, in the maker's words for imported Pigeons;
- a grey fact line the app writes itself, never the maker. For example:
  - Patch: "Works out sums, dates, units, money and look-ups" · *Works it out · starts fresh*
  - Pen: "Writes anything you ask" · *Writes · remembers the chat*
  - Title Maker: "Turns a short note into a title" · *Writes · starts fresh*
  - Kitchen Manual: "Answers from the Kitchen Manual it carries" · *Writes · starts fresh*
- "3 chats · last Tuesday" when the person already has chats with it;
- a number key, 1–9, on the first nine **visible** rows.

**Picking.** Arrow keys plus Enter picks a Pigeon. Typing letters filters by name. Digits pick a row only while the filter is empty; once someone has typed a letter, digits are just text. A small line under the field says so: "↑↓ to choose · Enter · 1–9 when empty".

**Writing first.** If the person typed first and presses Enter with nobody chosen, To: opens with the text kept. When Patch's word matching recognises the text, a row at the top reads "**Suggested:** Patch can work this out". That row is never shown for a transcript or anything over 60 words, because a meeting full of figures isn't a sum.

**Footer row:** "Add a Pigeon…"

**The rule.** Picking a Pigeon here always starts a new chat. It's the same for every Pigeon. Continuing happens from the chat list or the Pigeon's page.

### 3.3 A Pigeon's page (clicked from the Pigeons tab, or its name in a chat header)

The page works like a Claude project page. From top to bottom:

1. **Header.** A large avatar (Patch's perch is animated), the name, and **Made with Flight School · 12 Sept** for imported Pigeons. Hovering "Flight School" says "Pigeon's tool for making Pigeons".
2. **"From its maker"**, in one quoted block. Everything the maker's file claims lives here, so none of it can pass for something the app checked:
   - the does-line, and "Send it: a short note, like 'buying milk for Sam'";
   - **"What it did on notes it hadn't seen"**: three input → output pairs from its check ride. A drawing Pigeon shows three drawings, which Pigeon renders at import from the maker's recorded recipes.
   - "Its maker says it got 23 of 25 right on notes it hadn't seen."
3. **Facts the app states:**
   - **Writes · may be wrong** (or **Works it out** for Patch)
   - **Remembers:** "nothing, each message starts fresh" / "the last 12 back-and-forths of a chat"
   - A classifier adds **Answers with one of:** `urgent` `waiting` `later`
   - A grounded Pigeon adds **What's inside: 14 sections ›**
   - After the first wake following import, Pigeon re-runs each example input on this Mac. Replies decode the same way every time, so each pair whose output matches gets a small **Reproduced on this Mac** tag. A pair that didn't match gets no tag and no apology.
4. **Your chats with Title Maker:** a dated list, including its **Menu bar** chat if there is one.
5. **Continue and compose.**
   - A row: "**Continue:** buying milk for Sam · Tuesday", which opens that chat with its composer focused.
   - Under it, a composer with the placeholder "Start a new chat with Title Maker".
6. **Details** (collapsed): "Runs on Qwen2.5 1.5B · 38 MB", and **Remove Title Maker…**. Remove isn't offered for Patch or Pen.

### 3.4 An empty chat

The top of a new chat has three parts:
- a centred system line, "Title Maker · 9:41";
- a compact version of the card: the does-line, the Remembers line and one example pair;
- **suggestion chips** taken from the Pigeon's examples. Each is outlined, types exactly the text it shows, and never sends.

A new chat isn't a list row until something is sent or typed. Leave an untouched one and it's gone. Type anything and it stays as a **Draft:** row, because nothing typed is ever removed.

**Patch's card**, written by the app:

> **Patch** · Works it out
> Ask something with a number, a date, a unit or a sum in it. Every figure in my answer comes from code. Click one to see how I got it.
> **Remembers:** nothing, each message starts fresh. To change an answer, edit your message.
> *Nothing you send here leaves this Mac unless you say yes to a look-up.*

Once the planner reads earlier answers (engine change 8), the Remembers line becomes "nothing, each message starts fresh. To build on an answer, use Reply."

Patch's chips: "26.2 miles in km" · "days until 14 Nov" · "15% of 84.50" · "What can you do?". Each is bench-checked to be answered by word matching alone, so it works before any download.

**Pen's card:**

> **Pen** · Writes
> Ask it to draft, explain or think something through. Pen writes every word itself, and nothing it writes is checked, so it may be wrong. For figures, ask Patch.
> **Remembers:** the last 12 back-and-forths of this chat.

A voice uses its own examples as chips, and its Remembers line states whichever history shape passed its bench (see section 4). A Pigeon with no examples gets no chips, and never Pen's coding openers.

**Header subtitle.** It stays up for the life of the chat: "**Title Maker** · starts fresh each message" or "**Pen** · remembers this chat". Clicking the name opens the page.

**Composer.** The placeholder comes from the Pigeon: "Message Patch", "A short note, like 'buying milk for Sam'", "Message Pen". Every chat has a **+** button for adding an image, and **Send**. Pigeon doesn't read files from disk.

### 3.5 Sending and waiting

The person's dark bubble appears at once. Under it, where "Delivered" would go, a status line changes in place:

| Status | When |
|---|---|
| "Waiting" | Another message in this chat is ahead of it. Sends queue; they're never refused. |
| "Waiting for your answer to Patch" | Patch's question is still open (see 3.9) |
| "Waking Title Maker · about 14 s" | Counts down from the last wake measured on this Mac. It stops at "about 2 s"; if the reply still hasn't started, it reads "Taking longer than usual…" while the typing bubble keeps moving. |
| "Getting Title Maker ready · about 25 s" | A newly added Pigeon needs the models restarted. Reads "Waiting for another reply to finish, then about 25 s" when a reply in another chat is in flight. Which chat that is appears only in Info. |
| "Waiting for Pigeon's models to restart · about 25 s" | A turn that needs the models arrived during a restart |
| "Sent to DuckDuckGo and Wikipedia · 14:02" | Stays permanently, only after the person approved a web look-up |

**The typing bubble.** When work starts, a bubble in the Pigeon's colour appears with one line: Patch "working it out…" (his header avatar does the thinking animation), writers "writing…", Kitchen Manual "looking in its pages…", Icon Maker "drawing…". The header subtitle mirrors the status line.

**First wake.** The first time any wake happens, a line appears once: "Pigeons sleep when you're not using them so your Mac stays light. Sending wakes them."

**Leaving mid-reply.** The person can leave while a reply is on its way. The reply keeps going and lands in its own chat with an unread dot and a banner. If they're scrolled up when a reply lands, a **New reply ↓** pill appears.

### 3.6 The reply, and the line under it

**A. Worked out (Patch): aqua bubble**

The person typed "split £87.40 three ways".

> *I took this as* **Split a bill** · bill **£87.40** · **3** people · no tip
> £87.40 in total, no tip: <u>£29.14</u>, <u>£29.13</u> and <u>£29.13</u> each.
>
> **Worked out ›**

- **The mark has no tick.** A tick in the receipt slot reads as "delivered" or "correct". Worked out carries a small calculator glyph instead. On the first three worked-out replies the mark reads "**Worked out from what I took this as ›**", which points back at the line that can be wrong.
- **What "I took this as" shows.** Only values the person typed or gave when Patch asked. A default is written as words ("no tip", "1 person"), never as a figure that looks like Patch assumed it. Money keeps the currency the person typed.
- **Built-in data** gets a qualifier: "Worked out · table from Sept 2022 ›".
- **Correcting a value.** In a single-step answer that used no web, clicking a value in the "I took this as" line opens the reply bar ("↩ Change: 3 people"). The next send re-runs that one step with the field replaced, through the same input audit. For chains and web answers, the click opens Edit on the original message.
- **Clicking a figure** opens a small popover titled **How Patch got £29.14**:
  - "You gave: bill £87.40, 3 people"
  - "Patch used: Split a bill"
  - "Result: £29.14, £29.13, £29.13 each · £87.40 in total"
  - "Where: on this Mac, just now"
  - A collapsed **Exact input and output** section, plus **Copy £29.14**

  A skill that ships an explanation line adds it. No skill is given one it doesn't have.
- **First time only.** The very first worked-out reply someone ever sees pulses one figure once, with the note "Click an underlined figure to see how I got it."
- **Patch's salute.** He salutes when every step succeeded.

**B. Looked up (Patch, web): aqua bubble with a quote**

> *I took this as* **Look it up** · "capital of Switzerland"
> > "Bern is the de facto capital of Switzerland…"
> [link card: Switzerland · en.wikipedia.org]
>
> **Looked up · Wikipedia ›**

The words are the source's own, set as a quote. Figures inside a quote aren't underlined, because code didn't make them. The mark names the source that answered; the status under the person's bubble names every site the text went to.

**C. Written: white bubble with the dark-yellow rule**

> Here's a gentler way to say it: …
>
> **Written by Pen · may be wrong ›**

- **No underlines.** Only Patch's figures are ever underlined.
- **Cut short.** A reply that ran out of room reads "**Written by Pen · cut short**". Pen's has a **Keep going** button. Voices and one-shot Pigeons have a fixed reply length, so theirs don't.
- **First time only.** The first written reply someone ever sees gets a note: "Written replies come from a small model on your Mac. Nothing checks them, so they can be wrong, and figures are Patch's job." **[Got it]**

**D. Couldn't: grey outline, never aqua**

Nothing was produced, so the bubble isn't aqua. It always has one sentence, then the way forward. Examples are in 3.10 and section 4. The mark reads "**Couldn't · no answer ›**", or "**Couldn't · Pen didn't reply**" with a **Try again** button.

**Info.** Clicking any mark line, or ⋯ › **Info** (⌘I), opens the Message info panel (3.7).

### 3.7 Acting on a message

**Where the actions are:**
- **Newest reply:** a visible row at every window width: **Copy · Reply · ⋯**.
- **Other bubbles:** ⋯ on hover in a wide window, always visible in a narrow one. Right-click works everywhere.
- **Selecting text:** bubbles behave like Mac text. Drag to select, double-click to select a word, ⌘C to copy the selection.
- **Tapbacks:** from a small hover button, ⋯ or right-click. Double-click is left for selecting.

**What Copy puts on the clipboard.** Plain text of the answer sentence only: "£87.40 in total, no tip: £29.14, £29.13 and £29.13 each." It leaves out the "I took this as" line, the mark and all styling.

**What's in ⋯:**

| On | Menu |
|---|---|
| Your message | Copy · **Edit** · Reply · **Ask someone else…** · Info |
| A reply | Copy · **Copy with where it came from** · Reply · Try again (see below) · **Ask someone else…** · Info |
| A drawing | Copy image · **Save drawing…** · Reply · Info |

- **Copy with where it came from** adds "(worked out by Patch in Pigeon: Split a bill)", "(looked up by Patch in Pigeon, from Wikipedia)" or "(written by Pen in Pigeon, may be wrong)".
- **Copy image** puts a PNG on the clipboard. **Save drawing…** saves the SVG through the macOS save dialog.
- **Try again** is shown where the answer can come out different:
  - **Pen and voices:** always.
  - **Patch:** when that turn was answered without the models and they're now awake. It then reads **Ask again with the models**.
  - **Otherwise disabled on Patch and one-shot Pigeons**, with the reason "Same message, same answer. Edit it to get a different one."
- **Tapbacks:** six, as today. The first time someone uses one: "Pigeons don't learn from reactions. They're for you."
- **Edit** works on any of your messages, for every Pigeon. It makes a new version with **‹ 1/2 ›** arrows, and the branches below each version come back with it. The first time: "Your earlier version is still here. Use ‹ ›."
- **Ask someone else…** lists Pigeons with their does-lines. It opens a new chat with that Pigeon and puts **your question** in the composer, tagged "From your chat with Patch". The person presses Send. Replies never travel.

**Message info panel** (a side panel):
- **Top line:** "Sent 9:41 · answered 9:41 (1.2 s)".
- **How this was made**, in second person:
  - Patch: the Patch-and-Robot exchange, rewritten to talk to the person ("I think you want to split a bill…"), ending in "Nothing left this Mac."
  - A look-up: "Sent 'capital of Switzerland' to DuckDuckGo and Wikipedia at 14:02. Wikipedia answered; Patch quoted it without changing a word."
  - Pen: "Pen wrote this with a small model on your Mac. It read the last 12 back-and-forths of this chat. Nothing checked it." Where the person's message included text read from a picture: "Numbers in the text read from your picture count as yours, so Pen may repeat them."
  - Title Maker: "Title Maker got your message exactly as you typed it, and nothing else."
  - Kitchen Manual: "Pigeon found §3 Descaling and gave Kitchen Manual only that section."
  - Icon Maker: the recipe it wrote.
- **Details for developers** (collapsed, available to everyone): the plan JSON, step inputs and outputs, word-matching and category scores, timings, the model file, which other chat a reply waited on, and technical failure detail such as ports.

### 3.8 Follow-ups

**Reply** is the one follow-up gesture, and it's available everywhere. The reply bar always says what the Pigeon will see:

| Pigeon | Reply bar says |
|---|---|
| Patch, until the planner reads earlier answers | "↩ Patch: £29.14 each · **Patch won't carry these figures over yet. Type the ones you need.**" |
| Patch, once it does (engine change 8) | "↩ Patch: £29.14 each · **Patch can see this answer's inputs:** £87.40, 3 people". His next answer shows "↩ using £87.40 from before" above its "I took this as" line **only when** the plan really used an earlier value. |
| Pen, voices | "↩ Pen: Here's a gentler way… · Pen sees the last 12 back-and-forths". The quote is shown to you; it isn't added to what Pen is sent, because Pen already has that reply. If the quoted message is above the memory line: "· **Pen can't see this one any more**". |
| One-shot Pigeon | "↩ Title Maker: Milk run for Sam · **Title Maker only sees what you type below, not this quote.**" with an **[Edit "buying milk for Sam"]** button |

**The note before a follow-up to Patch.** Patch starts fresh, so he gets the same soft note as one-shot Pigeons. No model is involved. It shows above the composer when the last message in the chat is a Worked out reply and the new message is short (six words or fewer) and either opens like a follow-up ("what about", "and", "how about", "same but", "in euros") or has no number:

> Patch doesn't carry figures from earlier messages, so "what about 4 of us?" will be read on its own.
> **[Change your last message] [Send anyway]**

Once the planner reads earlier answers, the first button becomes **[Reply to the last answer]**, which attaches the reply bar and keeps the text. As with every note, it never blocks, never touches the text, and stops showing in a chat after two **Send anyway**s.

**Memory edge (Pen and voices).** Once a chat is longer than what Pen can see, a centred line sits where memory starts: "**Pen can't see above this line · everything is still saved**". Nothing is dimmed. The line is drawn from the same 12 back-and-forths Pen is sent, on the version of the chat currently shown, and it moves down as the chat grows. Starting a new chat is the way to start fresh, as in ChatGPT.

### 3.9 Patch asks back

The person typed "split it 4 ways with a 15% tip". An aqua bubble:

> I'm ready to **split a bill**. I have **4 people** and a **15% tip**. How much was the bill?
> *You didn't say, so I'm asking rather than guessing.*
> **Waiting on you**

The composer gets a reply bar automatically: "↩ **Answering Patch:** How much was the bill? ×".

**Answer chips.** When the field type allows it, likely answers appear as chips that type into the box. If the person typed a value for this field earlier in the same chat, it comes first: "**£87.40** · from your message at 9:41". Only the person's own typed values qualify, never a figure from a reply.

**The rules:**
- **Answering.** Only a message sent **while that bar is attached** answers the question. The turn then becomes the worked-out reply.
- **Skipping.** × detaches the bar. The question folds to "**Skipped**", and the next message is a new question.
- **Queued messages never answer.** Messages sent before the question arrived wait, with the status "Waiting for your answer to Patch", until it's answered or skipped.

### 3.10 Patch can't

The reply depends on the cause, and never shows a score, a threshold or a function name.

- **Nothing fits:**
  > I can't work that out. I do sums, dates, units, money and look-ups.
  > Skills that share words with your question, none a close match:

  Chips, each typing exactly what it shows: **"split 100 between 3 of us"** · **"15% tip on 62"**. They're examples to edit, not a skill forced onto the person's question.
  Then buttons: **[Ask Pen]**, which opens a Pen chat with the person's question in the box, and **[Try the web…]** unless Settings says Never. Try the web looks for a web skill for this one question and, if one fits, opens the sheet.
- **Models asleep:** Patch declines at once, as he does today, with a button: **[Try with the models · about 14 s]**. He wakes the models by himself only when word matching found a skill it could act on but couldn't fill in without them.
- **Models restarting** (a Pigeon was just added): Patch answers what he can without the models. A turn that needs them waits with "Waiting for Pigeon's models to restart · about 25 s" and then runs.
- **Not downloaded:**
  > Without Pigeon's download I can only match short questions to a skill, and this one didn't match.

  Under it, a centred system card with the app icon: "Download 2.3 GB so Patch can follow whole sentences and Pen, a Pigeon that writes, can join. Kept on this Mac." **[Download 2.3 GB] [Not now]**

  When the download finishes, every one of these replies in every chat gains **[Ask again now]**. It sends the same text again as a new, visible message.
- **Needs the web** (the planner chose a web skill): "That needs a look-up on the web." **[Look it up…]** turns the web on for this one question and opens the sheet (5, exception 7). If Settings says Never: "That needs the web, and Pigeon is set never to use it (Settings › Privacy)."
- **Only a picture was sent:** a Couldn't in reply to text read from an image, with nothing typed, adds **[Copy the text]**, since that's often what the person wanted.
- **"What can you do?"** gets a centred system card, not a Patch reply and not a mark. It lists Patch's areas (Money, Dates & time, Units, Numbers, Text, Lists, Look-ups), each with two example chips. The page builds it from the skills that are loaded; no model writes it.

### 3.11 Coming back later

- **Chat list:** unread dots show what finished while the person was away. Rows carry their day ("Tuesday", "9 Sept") under **Last 7 days** and **Earlier**.
- **Search:** matches weekday and date words as well as text. "tuesday title" finds Tuesday's Title Maker chats. A hit on a hidden version switches to it and says "Showing version 2 of 2".
- **Drafts:** each chat's draft is still there, as today. Nothing the person typed is ever removed.
- **Waking:** the first send after an idle unload says "Waking Pen · about 14 s".
- **Patch's skills changed:** his next new chat opens with a system line: "Patch learned 6 new things since you were last here · See what's new". That opens the "What can you do?" card with the new entries marked.
- **A Pigeon re-imported with a newer version:** its chats get a system line, "Title Maker was updated · 13 Sept".

---

## 4. How each kind of Pigeon fits

### Patch (worked out; starts fresh, with Reply as the bridge)
- **Input:** text, plus text read from images and pasted transcripts, once the person has confirmed it.
- **Each message is its own request.** The note before a follow-up says so. Until the planner reads earlier answers, Edit is the way to change one. After that, Reply carries a previous answer's inputs, and the bar says which.
- **Replies:** Worked out (the aqua bubble with "I took this as" and underlined figures), Looked up, Waiting on you → Skipped, or Couldn't.
- **Try again** only when the models have arrived since he answered without them. Otherwise the same plan gives the same answer, and Edit is how to change it.
- **Web:** only Patch uses it, only after a button press, and only through the sheet.
- **Personality stays:** perch on his page and empty chats, thinking avatar, salute on a clean answer, pokes. None of it appears on other Pigeons' replies.

### Pen (the base model, renamed from "Chat")
- **Multi-turn.** Pen remembers the last 12 back-and-forths, with the memory edge line.
- **Replies:** white bubble with the warm rule, marked "Written by Pen · may be wrong".
- **Try again** gives a new version (‹ 1/2 ›).
- **Keep going** continues a reply that was cut short. It's an ordinary next turn: a fixed "Continue" message that goes into the chat's history. The guard checks the joined reply, not just the new part.

### Voices (persona Pigeons)
- **History shape is measured before it's promised.** A voice was trained on a single message in its own template, not on a 12-turn chat. Two shapes get benched per voice before voice cards ship:
  - **A:** the template wraps only the newest message, with earlier turns sent as they are;
  - **B:** no history.

  The voice's Remembers line, and the header, state whichever shape passed. Until a voice has been measured, it runs as Lane B does today and its card shows the does-line and maker examples only, with no "Talks like".
- **Replies:** the same white bubble and mark as Pen. **Try again** gives a new version. Cut-short replies have no Keep going, because a voice's reply length is fixed by its maker.

### The handoff guard (Pen and voices)
A reply that states a figure the person never gave, to a question that wants a number, is **still dropped**. In its place:

> **Couldn't** · Pen's reply had a figure you didn't give it, so it isn't shown. Put the amounts in your message and Pen will use them.
> **[Write it without the amounts]** · **[Ask Patch]**

- **Write it without the amounts** is Pen only. It re-asks with an instruction to answer in words. Voices get only the sentence and **Ask Patch**, since no voice was trained with that instruction.
- **Ask Patch** appears when Patch's word matching, run in the page, finds a skill it can act on. Patch may still ask for a missing value or decline. The button promises a try, not an answer.
- **Figures in a message are licensed only by what the person typed** (and text they confirmed from a picture). A quoted reply isn't part of what's sent, so an old reply can't license its own number.

### One-shot jobs (classifier, extractor, freeform)
- **Input:** text, one at a time, sent exactly as typed. No history. Text read from an image replaces the box text rather than being added under it.
- **How the chat looks.** Every reply is drawn attached to the message it answered, with a quote strip on its top edge ("↳ buying milk for Sam") and the output below. The header says "starts fresh each message".
- **What a follow-up means.** Someone who wants a different result has three moves:
  1. **Edit the message.** Its reply is re-run, and ‹ 1/2 › keeps both versions.
  2. **Send something new.**
  3. **Take the idea to a Pigeon that talks.**
- **The note before sending.** No model is involved. The page checks what was typed and shows a strip above the composer when:
  - it contains a follow-up word ("shorter", "another", "snappier", "no, the second one", "thanks", "hi"); or
  - it's well below the Pigeon's usual input length and shares no word with the previous message.

  > Title Maker doesn't see earlier messages. "shorter please" would get a title of its own.
  > **[Edit "buying milk for Sam"] [Ask Pen for a shorter title] [Send anyway]**

  Other versions:
  - Long input: "This is longer than anything Title Maker was tested on (up to 12 words), so it may answer oddly." **[Send anyway]**
  - Greeting: '"hi" would get a title of its own.' **[Show what it does] [Send anyway]**

  The note never edits or deletes the text and never blocks. After two **Send anyway**s in one chat, it stops showing in that chat.
- **Ask Pen for a shorter title** opens a Pen chat with an app-written frame around **only the person's own words**: "Give me a shorter title for: buying milk for Sam". The frame is ordinary editable text. A one-line strip says "Pigeon wrote the first few words; the rest is yours." It takes its noun ("title") from the Pigeon's card and falls back to "answer". No generated text travels.
- **Classifier replies.** The chosen label is filled in among its labels. An answer outside them reads "Written by Mood Tagger · not one of its labels · may be wrong".
- **Cut short:** "Written by Title Maker · cut short, this isn't the whole answer". There's no Keep going, because a one-shot Pigeon can't continue.

### Grounded (one-shot, answers from packed material)
- **Page:** shows **What's inside** (the section titles) before any question is asked.
- **Reply:** prose with footnote chips **[§3]**; clicking one opens that section's text. A footer reads "Given: §3 Descaling". The mark is "Written by Kitchen Manual · from §3 · may be wrong".
- **Unsupported citation:** the chip is struck through, with "§5 wasn't in what it was given".
- **Not in its pages** is an answer, decided before any model wakes:
  > **Couldn't** · That isn't in the Kitchen Manual. It covers:

  Section chips follow: "What does it say about Descaling?", "What does it say about Warranty?". Each types what it shows. Last comes **[Ask Pen]**.
- **Follow-ups:** the same as jobs.

### Drawing Pigeons (a skill: the model writes a recipe, Pigeon draws it)
- **Page:** three sample drawings in the maker's block, rendered at import from recorded example recipes.
- **Reply:** a picture bubble, drawn only through `<img>`, like a photo in Messages. The mark is "Written by Icon Maker · drawn from its recipe · may be wrong". Available actions are Copy image (PNG) and Save drawing… (SVG); the recipe lives in Info.
- **Bad recipe:** reported, never repaired:
  > **Couldn't** · Icon Maker's recipe asked for a part it doesn't have ("wing-9"), so nothing was drawn. Try describing it another way.

  with **[Edit your description]**.
- **Follow-ups:** edit the description.

### Imported Pigeons in general
- **Where the card comes from.** New optional fields written by Flight School. Older files get a card built from what the file already holds (kind, labels, section titles, skill name), marked "This Pigeon came without a card", with no examples.
- **Once added, always sendable.** Even while the models sleep; loading is folded into the first send's countdown. A Pigeon can't be added before the download, so this holds from the moment it's added (see 6).
- **A model server Pigeon didn't start.** Pigeon can't restart it to load a new Pigeon. The first send gets "**Couldn't** · Pigeon didn't start the model server that's running, so it can't load Title Maker. Restart that server where it was started." The port is in Info.
- **Removed Pigeons.** Their chats stay readable. The composer is replaced by "Title Maker was removed from this Mac. **[Add it again…]**", and the avatar shows "?".

---

## 5. The exceptions: where Pigeon deliberately isn't a texting app

1. **Every reply carries a line saying who did the work.** Only Patch's figures are underlined, and clicking one shows how.
   - *Why:* this is the product. A number from code, a number quoted from the web and a number from a 2B model look identical otherwise.
   - *How it teaches itself:* it sits where "Delivered" sits, where texters already look, in plain verbs and without a tick. The first Written reply and the first Worked out figure each get one note. The first three Worked out marks point at "I took this as". Clicking the line always explains it.

2. **Some Pigeons start fresh each message.**
   - *Why:* Patch plans each message on its own. Jobs, grounded and drawing Pigeons were trained on one input with no history, and decode deterministically. History would make them worse.
   - *How it teaches itself:* the same words appear in four places. They're on the page ("Remembers: nothing"), in the header subtitle, on each reply's quote strip, and in the note that appears only when someone types a follow-up, to Patch or to a job.

3. **Pen and voices forget beyond a point.**
   - *Why:* Pen sees the last 12 back-and-forths.
   - *How it teaches itself:* the line "Pen can't see above this line · everything is still saved" sits exactly where memory ends, and the reply bar says when a quote is above it.

4. **Patch's question is answered only through the reply bar.**
   - *Why:* he asks rather than guessing, in about a third of successful turns, and a new topic must never be swallowed as the missing value.
   - *How it teaches itself:* the bar is WhatsApp's, it fills in by itself, × skips, and "Skipped" shows the question went unanswered.

5. **Pigeons sleep, and the first reply waits.**
   - *Why:* small local models unload when idle.
   - *How it teaches itself:* a countdown under your bubble that turns into "Taking longer than usual…" rather than reaching zero, a one-time line of explanation, and nothing to press first.

6. **A written reply never shows a figure the person didn't give.**
   - *Why:* a guessed number looks exactly like a real one.
   - *How it teaches itself:* the Couldn't says why in one sentence, tells the person the move that works (put the amounts in the message), and offers buttons.

7. **Nothing leaves the Mac without a button press and a sheet, and "Ask someone else" carries only your question.**
   - *Why:* offline is the promise, and generated text must never reach Patch as if it were your input.
   - *How it teaches itself:*
     - Patch never looks anything up unprompted. The person presses **Look it up…** or **Try the web…** inside a Couldn't.
     - The sheet reads "**Send this to DuckDuckGo and Wikipedia?**" with the exact text quoted: "capital of Switzerland". Below it: "This is the only thing that will leave your Mac. Nothing has been sent yet." Buttons: **[Don't send] [Send once]**. Send is never focused by default, and closing the sheet counts as no.
     - Afterwards, "Sent to DuckDuckGo and Wikipedia · 14:02" sits under your bubble, and **Settings › Privacy › What left this Mac** lists every look-up.
     - "Ask someone else…" is named for what it does. Your own words appear in the other composer, and you press Send.

---

## 6. First run and importing a new Pigeon

### First run, minute by minute (clean Mac, no download)

- **0:00.** No sheet. The window opens on an empty chat with Patch. It isn't in the list yet and disappears if nothing is sent. At the top, a system card with the app icon reads "Pigeon keeps a few helpers on this Mac. Patch works things out, with no download." Below it are his animated perch, his card and four chips. A strip across the top of the list reads "Pigeon works with no download. A 2.3 GB download lets Patch follow whole sentences and adds Pen, a Pigeon that writes. **Download** · Later". The fit line ("This Mac has 16 GB, it fits · Apache 2.0") sits in a Details disclosure.
- **0:20.** The person clicks "26.2 miles in km", which types into the box, and presses Enter. The chat becomes a row named "26.2 miles in km". Within 20 ms an aqua reply arrives: *I took this as* **Convert units** · **26.2 miles** → km / "26.2 miles is <u>42.16 km</u>." / **Worked out from what I took this as ›**. The figure pulses once with its hint, and Patch salutes. Clicking the figure opens **How Patch got 42.16 km**, which ends "on this Mac, just now".
- **1:30.** They type "if I run a marathon at 5:30 per km how long will it take". Patch replies "**Couldn't** · Without Pigeon's download I can only match short questions to a skill, and this one didn't match." The download card sits under it. Now the download means something, and they click **Download 2.3 GB**. The list strip becomes "Downloading · 12% · about 7 min · Pause". Patch keeps answering short questions meanwhile.
- **3:00.** They click "What can you do?" and get the system card with example chips.
- **~6:00.** The download finishes. The strip reads "Download ready · checked it arrived intact". The marathon Couldn't now has **[Ask again now]**. They click it, the question goes again as a new message, and Patch works it out. A banner reads "**Pen joined** · Message", and Pen appears in To: and on the Pigeons tab. They click the banner, send "help me decline a wedding invite nicely", and see "Waking Pen · about 14 s", then a warm-ruled reply marked **Written by Pen · may be wrong** with the one-time note.

By then the person has seen three of the four marks, a countdown, a download offered when needed and a join, without a tab, a pill or a technical word.

### Importing a Pigeon

1. **Ways in:**
   - double-click a `.pigeon` in Finder;
   - drop one on the window;
   - choose **Add a Pigeon…** in To:, on the Pigeons tab or in the File menu.

   An unsigned build may not have registered the file type, and then macOS offers Open With. Dropping and the menu item always work, which is why the Pigeons tab says so. Imports reach the window live even if it was hidden.
2. **"Meet Title Maker" sheet**, before anything is installed. Rust checks the file and holds it under an opaque id; the page never sees a path.
   - **The sheet shows:** the maker's block (does-line, examples, the pass count it claims), the app's facts, "Made with Flight School, Pigeon's tool for making Pigeons · 12 Sept", and a line the app states: "A Pigeon like this can't use the web, open your files or run programs. It turns your text into text or a drawing." A Patch skill pack shows who sealed it instead of that line.
   - **Details** (collapsed): "Runs on Qwen2.5 1.5B · already on this Mac · 38 MB".
   - **Buttons:** **[Not now] [Add Title Maker]**.
   - **No download yet:** "Title Maker needs Pigeon's download (2.3 GB) before it can be added." **[Download, then add] [Not now]**. The Pigeon is added when the download lands, with the usual banner.
   - **Wrong base:** "Title Maker was made for a different writing model from the one Pigeon uses, so it can't run here. Its maker can make a copy for Pigeon." **[Copy details for its maker] [OK]**. The model names are in the copied details and under Details. Nothing is installed.
   - **Same model, different build of it:** "Title Maker was made on a slightly different build of Pigeon's writing model. It should work, but its examples may not reproduce exactly." **[Not now] [Add anyway]**
   - **A nest:** one sheet, "Add 4 Pigeons from Writing Kit", with a checkbox for each and one refusal line for any member that can't be used.
   - **Already installed, newer revision:** "Update Title Maker?" **[Update]**.
3. **After Add:** the banner "**Title Maker joined** · Message", and its page opens with the composer focused.
   - **Models awake:** Pigeon restarts them in the background as soon as no reply is in flight in any chat. During the restart Patch answers what he can without the models (3.10).
   - **Models asleep:** Title Maker loads on the next wake.
   - **First send:** shows whichever is true: nothing (ready), "Getting Title Maker ready · about 25 s", or "Waiting for another reply to finish, then about 25 s". The person never sees "not loaded", "Restart the models" or a port number.
   - **First wake after import:** Pigeon re-runs the example inputs and tags the ones that reproduce.

---

## 7. Secondary surfaces

**Menu bar popover** (380×430):
- **Opening it:**
  - **Something unsent** (text or a capture): it's back exactly as it was left, with the same To:.
  - **Nothing unsent:** To: is set to **Patch** and the box is empty. The last finished exchange folds to one line at the top, "**Last:** £29.14 each · Copy · Open", until the next send.
- **Buttons:** **Screenshot**, **+**, **Open Pigeon ⌘↩**.
- **Picking another Pigeon:** the To: button uses the same list and rows as the window.
- **Replies:** the same bubbles and marks as the window, including drawings, footnote chips, "cut short" and the guard's Couldn't.
- **No web.** A look-up reads "That needs a web look-up. **Open in Pigeon**", which opens the exchange in the window where the sheet can ask.
- **Saving:**
  - Each sent exchange goes into a chat named **Menu bar** with that Pigeon, created on first use.
  - Before the first send, a line under the box says so: "What you send here is saved to a Menu bar chat with Patch · Settings". After sending, the footer names it: "Saved to your Menu bar chat with Patch · Open ⌘↩".
  - **Settings › Privacy › Save menu bar exchanges** turns saving off. Unsent captures are never saved.
  - The popover never writes the chats file itself. It hands each finished exchange to the main window, which files it, even while hidden.
- **No global shortcut** until the app is signed.

**Capture, paste and drop, in the window and the popover, for every Pigeon:**
- **The first screenshot.** Before macOS asks, a short sheet: "To read text on your screen, macOS needs to let Pigeon see it. macOS will ask you next." **[Continue] [Cancel]**.
  - **If permission isn't on:** "Pigeon can't see the screen yet. Turn Pigeon on in System Settings, then quit and reopen Pigeon." **[Open System Settings] [Quit and reopen Pigeon]**
  - **If the switch is on but macOS still gives nothing:** "macOS has the switch on for an older copy of Pigeon. Remove Pigeon from that list with –, then try again." **[Open System Settings]**
  - **Both sheets end:** "Or press ⌃⇧⌘4, drag over the text, then paste here." A pasted image becomes text the same way.
- **Screenshot:** the popover hides, captures, and shows "Drag over the part you meant · Read all of it · Cancel".
- **The chip:** every image becomes a **Text from screenshot · 142 words · Check text · Copy text** chip.
  - **Copy text** copies the text read from the image. When a capture is the only thing in the box, **Copy text** is the main button and Send comes second.
  - **Check text** opens the text for editing, with **Copy text** inside.
- **Tidying:** if a model tidied the text, the chip says "**Tidied by a model** · changes highlighted" with **Use original** and **Use tidied**. The changed words are highlighted in the text; there are no counts. Choosing either, or editing in Check text, marks the text as the person's own.
- **Transcripts:** a pasted transcript offers the same chip: "Looks like a meeting transcript · **Remove timestamps and fix punctuation**". Afterwards, Check text offers **[Copy tidied text]** and **[Ask Pen for notes]**. The second opens Pen with the app-written frame "Write notes and actions from this meeting:" above the tidied text.
- **Too long for Pen.** Before sending to Pen or a voice, the page estimates the length. Over what Pen can read at once:
  > Pen can read about 4,000 words at once, and this is about 9,000.
  > **[Send the first part]**

  The first part is sent, visibly. The rest stays in the box.
- **No pixels on disk.** After a relaunch the chip shows an icon and "Picture not kept, text kept".

**Share-out:** Copy (the answer sentence as plain text), Copy with where it came from, Copy image (PNG), and Save drawing… (SVG only, user-initiated, through a native save dialog that writes only the drawing Pigeon rendered for that reply). No share sheet, export, drag-out file or file reading in this version.

**Search:** across Pigeons, chat titles, message text, and day and date words ("Tuesday", "9 Sept", "last week"). A hit jumps to the message and flashes it, switching versions if needed.

**Settings (⌘,)**, a standard window. It sends each change to the main window, which saves it.

| Tab | Contents |
|---|---|
| **General** | Appearance: Light / Dark / Match Mac (turns the dark tokens on); banners on/off |
| **Models** | "Asleep · they wake when you send (about 14 s)" or "Awake · 2.9 GB in use"; **Wake the models** / **Put the models to sleep**; "Put models to sleep after: 10 minutes / 1 hour / Never" (default 10 minutes); Download; **This build** rows with green/amber/grey dots under **Details** |
| **Pigeons** | Every installed Pigeon with its does-line, "Made with Flight School", size, Update and Remove… |
| **Privacy** | "Web look-ups for Patch: **Only when I press Look it up** (default) / Also try the web when nothing else fits / Never"; **What left this Mac** (a dated, text-only list of every look-up, with both sites, and every download); "Save menu bar exchanges"; "Chats are saved on this Mac" |
| **Advanced** | "Show Developer menu" (on by default in dev builds, off in release) |

**Developer menu** in the macOS menu bar: **Skills**, **Run a Plan**, **Reality vs. Aspiration** (the Ledger). Each opens in the main window's pane, where Patch's skills already load. Raw plan JSON and scores are also in every Message info panel under "Details for developers".

**Tray right-click menu:** Open Pigeon · Wake the models · Put the models to sleep · Quit Pigeon. The same words are used in the popover and Settings.

---

## 8. What I'd cut or hide, and what I'd keep

**Cut:**
- **Kind labels.** The pills Verified, Voice, Job, Base weights and Pigeon, and the To: groups Verified / Voices / Jobs / On this Mac / Base model. Replaced by does-lines plus two app-written facts ("Works it out / Writes", "starts fresh / remembers the chat").
- **"Chat" as a contact name**, renamed **Pen**.
- **The "GENERATED · NOT COMPUTED" badge** inside bubbles, and the composer hint "nothing here is computed". Replaced by the mark line under the reply.
- **Delivered / Read receipts**, and any tick in that slot. Replaced by true states.
- **The Show plan pill and the provenance line** with camelCase chains and milliseconds. The mark line opens Info.
- **Decline internals in the bubble:** the "NO SKILL · ROUTER DECLINED" box, score chips, thresholds.
- **The composer web globe and "WEB ON".**
- **The "This build" footer** and the sheet one click from the list.
- **Greyed "not loaded" rows,** "Restart the models", and port or lsof text in bubbles and toasts.
- **The "Wait for this reply to finish" refusal.**
- **The disabled composer** and "Choose who this is for first".
- **Ask again on Patch replies** that would only repeat themselves.
- **Coding starters on voices.**
- **The first-run modal** that asks about "Planner" and "Category" models.
- **Hover-only message tools** that vanish in narrow windows.
- **The raw recipe under drawings** and transcript counts in the composer.
- **The "Patch is still replying" tooltip** in every chat, and "Ask Pigeon something checkable…".
- **Defaulted zero values in Patch's sentences** ("with a 0% tip").

**Hidden** (still there, one click away):
- Router and category scores, plan JSON, model file names, timings and failure detail: Info › Details for developers.
- Skills, Run a Plan and Ledger: Developer menu.
- Model roles, licences and fit: Settings › Models › Details.
- Model names on a Meet sheet: Details.

**Kept as built:**
- The two-column list and pane; pins, search, drafts per chat.
- Chats bound to one Pigeon for life, several per Pigeon, renameable.
- To: with keyboard picking.
- Tapbacks, Edit with ‹ 1/2 ›, the right-click menus.
- Clickable figures with provenance.
- Aqua for Patch, the dark-yellow rule for written text, never pale text on pale ground.
- Patch's personality.
- ASK_USER's "ready to run / already read / asking rather than guessing".
- Grounded sections and flagged citations; drawings through `<img>` only.
- The lane-B import lint and the wall that keeps written text out of the figure renderer.
- Instant router-only declines.
- Wake on send; replies that land in their own chat; the New reply pill.
- Resumable, hash-checked downloads; router-only answers during download.
- "Pigeon closed before this was answered" with **Try again**.
- The popover's drag-select capture; no image pixels on disk; the screen-recording prompt raised only when someone uses capture.
- Import from Finder and `.nest` files.
- The read-only session when a newer Pigeon wrote the chats file.

---

## 9. Prior decisions this reverses, and ones it keeps

### Reversed (flagged)

1. **Delivered → Read receipts → status words in the same slot.**
   - *Argument:* "Read" was redefined to mean "Pigeon started working", which no texter would guess. The slot is better spent on what's true and useful: Waiting, Waking · about 14 s, Getting ready, and Sent to DuckDuckGo and Wikipedia.
2. **The Patch-only web switch in the composer → a Look it up button inside Patch's Couldn't reply, with Settings "Only when I press / Also try when nothing fits / Never".**
   - *Argument:* the protection that mattered was always the per-request sheet, and that stays, now naming both sites. The default does what today's off switch does: Patch never tries the web by himself, so routing and the offline benchmark are unchanged. What goes is an unlabelled globe that reset on every launch and whose failures showed NETWORK_OFF. **Never** gives a hard air gap, and the new "What left this Mac" log adds a record.
3. **The permanent in-bubble "Generated · not computed" badge (spec wording) → a permanent "Written by <Name> · may be wrong" line under every model-produced reply**, including jobs, grounded answers and drawings.
   - *Argument:* the disclosure stays on every bubble, in words people understand, where they already look. "Computed" was jargon that read as a warning with nothing to do, and "not checked" left people asking who was meant to check.
4. **"Chat" → "Pen", and the Verified / Voice / Job / Base weights pills → does-lines.**
   - *Argument:* "New chat with Chat" can't be read. "Verified" overclaims when Patch picks the wrong skill. People choose a contact by what it does.
5. **Image text and transcript tidy only in Patch chats → every chat.**
   - *Argument:* the text is the person's own input, shown and editable before sending, and the menu bar already sends it to any Pigeon. An attachment silently swallowed by every contact but one is the least texting-like thing in today's app. The tidy step's number guard still protects Patch, and in Pen chats the numbers read from a picture count as the person's, which Info says.
6. **Forward asks immediately in a new chat → your question lands in the other Pigeon's composer and you press Send.** Question-only stays.
   - *Argument:* this is what every mail and messaging Forward does, and it lets the person reword for a Pigeon that expects a different input.
7. **One question at a time per chat → a queue.** (A code behaviour, not a stated decision.)
   - *Argument:* texters send twice. The ASK_USER hold rule removes the only real ambiguity.
8. **Ask again on Patch → Edit.** Try again stays where the answer can differ, including a Patch turn first answered without the models.
   - *Argument:* on Patch it only ever produced the same answer, with a toast saying so.
9. **The first-run download sheet at launch → a system card offered in Patch's chat, and again when a question needs the download.** The download flow itself is kept.
   - *Argument:* a 2.3 GB decision at second zero, framed as model roles, asks people to choose before they know what the app does. Router-only is a supported state, so the first answer shouldn't wait on a download.
10. **Imported Pigeons unpickable until the models restart → always sendable,** with the restart folded into the first send's countdown. Missing-base refusals are kept, and a Pigeon that arrives before the download waits for it at the Meet sheet.
    - *Argument:* a contact you just added and can't message is the worst first impression a messaging app can make.
11. **The composer disabled until To: is chosen → write first.**
    - *Argument:* iMessage allows it, and the text itself helps suggest the right Pigeon.
12. **Clicking a Pigeon opens a profile → clicking a Pigeon opens its page, which includes its chats, Continue and a composer.**
    - *Argument:* this is the Claude project idiom the spec names. It's the place to learn what the Pigeon is for, and one click from either a new message or the last chat.

### Considered and kept (against at least one design)

- **Several renameable chats per Pigeon.** Kept against the one-thread designs, because a "project" holds many chats and a new chat is the familiar way to start fresh. Named, dated rows and the Continue row do the job one thread would have done for finding things.
- **Edit any question, with ‹ 1/2 ›, for every kind.** Kept against "Edited" labels and against arrows for some kinds but new pairs for others. One rule everywhere.
- **Suggestion chips never send.** Kept against Hello.
- **Menu-bar questions saved to a "Menu bar" chat.** Kept, extended to whichever Pigeon was picked, announced before the first send, and switchable in Settings.
- **The menu bar opens on Patch.** Kept, now only when nothing is unsent.
- **Forward carries only the question.** Kept against Pass to.
- **The handoff guard drops the figure.** Kept against partial hiding and dotted underlines.
- **Also kept:**
  - wake on send with "about 14 s" (now under the bubble and in the header);
  - instant declines when the models are asleep;
  - in-app banners only, now actually firing;
  - replies keep going when you leave;
  - reply-to on a Patch answer passes its inputs (announced only once the planner reads them);
  - Patch's personality;
  - Message info with steps, scores (collapsed) and "Nothing ran";
  - "X joined" for Pen and imports;
  - This build in Settings, and the Developer menu, now opening in the main pane;
  - never deleting typed text;
  - no image pixels on disk;
  - never pale text on pale ground;
  - offline by default;
  - dark tokens (now reachable).

---

## 10. Engine changes this needs, and risks and open questions

### Engine changes

**`.pigeon` format and import**
1. **Card fields in the `.pigeon` manifest.** All optional and written by Flight School:
   - `does` (≤ 60 characters)
   - `input_hint` (≤ 40 characters)
   - `output_noun` ("title", "label"), used by the app-written frames
   - `examples[]` of `{input, output}`, sampled from its check ride
   - `input_stats` (p50/p95 words and lines of training inputs)
   - `check` `{passed, total}`
   - `revision`
   - `talks_like` plus one sample exchange, for personas only

   `Manifest` (src-tauri/src/pigeon.rs:89-105) doesn't reject unknown fields, so adding them is safe. Plain `.pigeon` files aren't sealed, so every one of these is shown as the maker's claim. `PersonaInfo` (weights.rs:345-363) passes them to the page. For older files, a derived card is built from kind, `labels.txt`, section titles and the skill name.
2. **Example reproduction.** On the first wake after import, run each example input through `pigeon_run`, which is deterministic (temperature 0, seed 11, pigeon.rs:954-973). Store a per-example match flag for the **Reproduced on this Mac** tag.
3. **`pigeon_inspect` and `pigeon_add(id)`.**
   - `pigeon_inspect` validates a file without installing it. It returns the card, the base result (including the same-base, other-build warning and `NoBaseInstalled`, pigeon.rs:394-398) and an opaque pending id. The page never holds a path.
   - `pigeon_add(id)` installs the held file. **Download, then add** keeps the id for the session and adds when the download lands.
   - Import results go out as events to both windows, fixing the silent install while the window is hidden.
4. **Same-id newer `revision` replaces the Pigeon in place** after in-flight replies land, and posts the "was updated" line.

**Loading and waking**

5. **Installed vs loaded.** `personas_list` reads what's on disk and returns every installed Pigeon with a `ready` state.
   - **Wake on send** also covers "restart the server to load this adapter". It waits for in-flight replies in all chats, and its ETA comes from the measured wake and restart time. The saved `settings.lastWakeMs` is written but never read today. No hot-loading is assumed.
   - **During a restart**, Patch runs router-only in every chat. Turns that need the planner or category adapter are held and run afterwards.
   - **An adopted server** is never killed (engine.rs:368-381); its `RESTART_NEEDED` becomes the plain Couldn't in section 4.
6. **Patch and sleep** (turn.js). A router-only decline returns at once with **Try with the models**. Auto-wake-and-retry runs only when the router had an actionable candidate above the fallback floor that it couldn't fill. A turn answered router-only is flagged, so that **Ask again with the models** and **Ask again now** can offer themselves once the models are up.
7. **Grounded "not in its pages" is decided before waking.** Call `pigeon_run` before the wake-first step (app.js:2756); Rust can already answer `no_material` while asleep. Expose section titles through a small `pigeon_contents(id)` command.

**Sending and replies**

8. **Planner reads `prev`** on an explicit Reply (planner.js:226-238 ignores it today), and the turn reports which `$prev` references the executed plan actually resolved.
   - **Until this passes the bench:** the Reply bar says "Patch won't carry these figures over yet", Patch's card says "edit your message", and the follow-up note offers **Change your last message**.
   - **After:** "Patch can see this answer's inputs", "use Reply", and **Reply to the last answer**. "↩ using … from before" is shown only for references that resolved.
9. **Per-chat send queue** in the page. A pending ASK_USER holds the queue until the reply bar is used or ×'d. Queued turns survive quit like interrupted ones.
10. **"I took this as"** needs the chosen skill and its post-audit arguments on every computed reply, each tagged `given`, `asked` or `default`. Clicking a value is limited to single-step, offline plans: re-run that step with the field replaced, through validation and the input audit. Anything else opens Edit.
11. **Skills: labels, currency and defaults.**
    - **Labels:** skill `title` and field `label` for the 308 skills. The fallback is a humanised name ("splitBill" becomes "Split bill") and a labelled inputs → outputs popover.
    - **Currency:** money fields keep the symbol the extractor already matches and then drops (extractor.js:87), and reply templates print it.
    - **Defaults:** templates leave out defaulted fields or word them. splitBill's "with a {{tipPercent}}% tip" (skills/split-bill.js:13) becomes "no tip" when the value is a default of 0.
    - **Explanation lines** in the figure popover appear only where a skill ships one.
12. **"What can you do?" is built in the page** from the loaded registry and drawn as a system card, with no pack change. Also:
    - a bench-checked list of starters that word matching alone answers, re-run whenever skills change;
    - a page-side diff of skill ids between pack versions for "learned 6 new things".
13. **`CONSENT_WEB` executor state**, alongside ASK_USER.
    - It carries the exact query and **both** hosts, since `web_search` asks DuckDuckGo and Wikipedia at once (lib.rs:436-460), and records which one answered.
    - It replaces NETWORK_OFF and resumes only on **Send once**.
    - **Look it up…** and **Try the web…** set `webEnabled` for that one turn only. The second look (turn.js:384-385) runs by itself only under "Also try the web", which needs its own bench before it could ever become the default.
    - **Looked up** is its own reply kind, not a Worked out qualifier.
    - Add an outbound log: text only, dated, covering look-ups and downloads.
14. **Handoff guard.**
    - The drop behaviour is unchanged.
    - A Reply quote is display-only for Lane B and never enters `asked` (chat.js:115, handoff.js:186-199).
    - Add a Pen-only "without amounts" variant of the chat prompt.
    - Gate **Ask Patch** on the router having an actionable candidate, computed in the page rather than from lane-b, so the import lint still holds.
    - Any change to the "wants a number" detector needs a bench run first.
15. **Structural gate.** Turn inputs carry a `source`: `typed` (including app-written frames the person can see and edit), `person-confirmed` (image or transcript text after Use original, Use tidied or an edit in Check text), `reply` or `generated`. `runTurn` accepts only the first two. This is a lint-style rule, not a greyed-out menu item.

**Writers and one-shot Pigeons**

16. **Voices worn as trained, benched first.** Before `chat_complete` applies a persona's `system_prompt.txt` and `prompt_template` (both ignored today: chat.js:48-60, chat.rs:108-119), bench shape A (template on the newest message, earlier turns sent as they are) against shape B (no history) for each voice. The one that passes sets the voice's Remembers line. This is a Flight School contract question as much as a Pigeon one.
    - **Keep going** ships as an ordinary "Continue" turn with no prefill. The guard runs over the joined reply, and the button is hidden wherever the contract sets `max_tokens`.
    - Lane-B history marks the memory edge from `history.slice(-12)` on the visible branch.
17. **The notes before sending** run in the page with no model:
    - one-shot Pigeons: follow-up words, short inputs that share no word with the last message, long inputs, greetings;
    - Patch: follow-up openers after a Worked out reply;
    - Pen and voices: the length estimate with **Send the first part**.

    Only the length check changes what's sent, and it leaves the rest in the box.
18. **Drawing Pigeons.**
    - Render example recipes to SVG at import through the existing Rust concat path.
    - **Save drawing…** is a Rust command in the style of `pigeon_add_pick`: it takes a turn id and writes only the SVG Rust rendered for that turn, through a native dialog.
    - **Copy image** rasterises to PNG.

**Chats, menu bar and settings**

19. **Images and transcripts in every chat.**
    - Remove the Patch-only gates (app.js:848-849, 1274, 1286), and fix the invisible-attachment draft bug (app.js:2234-2240).
    - In one-shot chats, image text replaces the box text.
    - Suppress the Suggested row for transcript-shaped input.
    - Return capture's `NO_PERMISSION` and `REFUSED` (capture.rs:86-95) as codes the page turns into the two sheets.
    - Drop "text from a file".
20. **Chat list.**
    - `landReply` sets unread and raises a banner unless Hide Alerts is on.
    - Name chats from the first message.
    - Show the day in the time slot, with list headers.
    - Search matches day and date words and switches versions on a hit.
21. **Popover.**
    - It never calls `save_state`; the main window is the only writer of state.json (store.js:338-345 writes a full blob, so two writers would overwrite each other). The popover emits each finished exchange as an event, and the main window files it into the Menu bar chat, even while hidden.
    - It keeps unsent text and captures across opens, and resets To: only when nothing is unsent.
    - Also: stop flipping the pick mid-wake (popover.js:585), and render drawings, sections and cut-off with the shared bubble code.
22. **Settings window and Developer views.**
    - Settings gets one reviewed window label that doesn't load the pack or the pigeon-pack scheme and sends changes to the main window rather than saving.
    - Skills, Run a Plan and the Ledger open in the main pane, so no new label needs the pack worker.
    - Read `theme`, `bannersOff`, the web policy and the idle-sleep setting, all of which are saved but unread today.
    - Fix the stale idle-unload comment in engine.rs.

### Risks

- **"Worked out" can still be read as "correct."** A confident sum on a misread question is the most damaging failure. Removing the tick, pointing the first marks at "I took this as" and showing only given values all help. It still works only if people read the line. That's the first thing a usability test should check.
- **Card quality depends on Flight School.** Older files get thin cards, and a maker can write anything in the claims block. The Reproduced tag is the only check Pigeon can make, and on another build of the model a genuine example may not reproduce.
- **Voices may lose their memory.** If shape B is the only one that holds a voice, voices become start-fresh Pigeons, and the card has to say so.
- **Restart-in-wake latency.** A first send to a new Pigeon can take 25–40 s. During it, Patch runs router-only in every chat. ETAs are measured only on an M1 Pro with 16 GB.
- **False alarms in the notes before sending.** "no parking Tuesday" is a real note, and "and in euros?" to Patch may be a fine new question. The notes have to stay soft, stop after two dismissals, and never touch the text.
- **App-written frames blur authorship slightly.** "Give me a shorter title for:" is Pigeon's words in the person's box. The strip names it, and it's editable, but a test should check people notice.
- **Queue, ASK_USER, branching and resume-after-quit** combine into edge cases: editing a question that has queued messages behind it, quitting with an ask open. Each needs a test before the queue ships.
- **Copy-paste bypasses the question-only rule.** Someone can paste Pen's text into Patch. The structural gate stops tagged forwards, not pastes. That's accepted, since pasted text is the person's own act.
- **The two-base blocker stays.** Pigeons made on another base are refused at import. If Flight School trains on several bases, this becomes the biggest import failure.
- **Vocabulary rename:** Pen, Worked out, Looked up, Written · may be wrong and Couldn't touch spec wording (SPEC-SHEET 361-362), string-matching tests and lints, the earlier mockup and notes. Every surface has to switch at once, or the words will split.
- **`state.json` is unbounded,** and queues, "What left this Mac" and "Menu bar" chats all add to it.
- **Capture reliability** depends on signing; screen-recording permission can attach to the wrong copy of the app (capture.rs REFUSED). The pre-prompt sheet and the ⌃⇧⌘4 fallback reduce the damage without removing it.
- **No one outside has used Pigeon** (noted in the state record, kept outside this repo). The first five minutes in section 6 are the test script: someone who texts but has never seen Pigeon, no help. Every claim of familiarity here is a hypothesis until that has run.

### Open questions

- **Several chats per Pigeon may still clutter the list** for one-shot Pigeons someone uses daily. Do dated rows and Continue make that fine, or do people want a pinned chat per job? The rule stays uniform until evidence says otherwise.
- **No "Put Patch's figures in your message" button on the guard's Couldn't:** it would pass Patch's results into a Pen chat, which is exactly what the question-only rule forbids. The sentence teaches the move, and Copy £29.14 is one click away.
- **The popover still opens on Patch with an empty box when nothing is unsent, not only after a send:** something reached for in two seconds opens on the Pigeon whose answers can be checked. The real loss was unsent work, and that is now kept.
- **First run still opens on a Patch chat, not an empty window:** a first answer in 20 ms with no download is the whole pitch. The chat just isn't a list row until something is sent.
- **Restarts don't hold Patch turns in every chat:** making every chat wait 25 s to load a Pigeon one chat asked for punishes chats that didn't ask. Router-only answers in the meantime are true to what Patch can do.
- **The one-shot note doesn't look for missing nouns:** the page has no tagger, and "short, and shares no word with the last message" catches the same cases with no model.
- **"may be wrong" rather than "double-check it":** a mark should state a fact about the reply, not give the person a chore.

---

## What changed after stress-testing

- **Nothing captured or typed in the popover is lost any more.** Unsent text and captures survive a click away, every image chip has **Copy text**, the Menu bar chat is announced before the first send, and first-time Screen Recording has a designed path with a ⌃⇧⌘4 fallback.
- **Patch's receipts only show what's true.** "I took this as" shows only given or asked values, with defaults as words. The examples no longer show a tip nobody typed. Currency is kept. Copy is the plain sentence. The tick is gone, and web answers get their own **Looked up** mark.
- **Consent names every site.** The sheet and status say "DuckDuckGo and Wikipedia". Patch never looks anything up unless the person presses a button, which keeps today's offline behaviour and benchmark.
- **Follow-ups to start-fresh Pigeons are caught for Patch too**, with honest interim copy until the planner reads earlier answers. One-shot notes use the person's own words, and **Ask Pen for a shorter title** carries an app-written frame.
- **The guard's licence is closed and its dead end opened.** Reply quotes no longer license figures. The Couldn't says "put the amounts in your message". Ask Patch promises a try, not an answer.
- **Maker claims are shown as maker claims.** Examples and pass counts sit in the maker's block, and Pigeon tags only the examples it reproduced on this Mac.
- **Engine promises were cut to size.** The voice history shape gets benched before voice cards ship. Keep going is an ordinary turn. Router-only declines stay instant. "What can you do" is built in the page. Correcting a value is limited to single-step offline plans. The main window is the only writer of state.json.
- **Import and first run cover the clean Mac.** The Meet sheet has a no-download branch held by an opaque id, a plain wrong-base message with **Copy details for its maker**, and a safety line. Model names moved to Details. An untouched first chat disappears.