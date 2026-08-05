# Brain Visualizer (`brain-3d`) — Design Notes

Living design doc for the 3D brain visualizer that ships interactive
neuro-anatomical figures for the *After the Book* project. Written so a fresh
Claude session can resume the work without re-deriving architecture decisions
from scratch. Mirrors the convention used by `scripts/dashboard/DESIGN.md`.

## Update (2026-08-05j) — every cited source read in full

Pritchett arrived and the Zatorre & Belin container was identified, closing the
last two gaps. **All 24 papers the view cites are now `PRIMARY-FULL`, and all
nine networks sit at `read`.** A new test, `cites nothing that has not been read
in full`, guards this: adding an abstract-only or reference-list citation fails
the suite, which is the moment to either read it or accept the tier dropping.

Pritchett corrected the motor copy twice over:
- The angular gyrus exception is **observation only, in one experiment of four**,
  and does not appear for imitation anywhere. The copy had claimed "watching or
  imitating"; the imitation half was wrong.
- "Leaves nearly every language region quiet" was also wrong. In that same
  experiment *every* language region showed small but reliable above-baseline
  responses. The honest framing is that the response never exceeds the nonword
  control and stays far below sentences — not silence.
- The paper keeps speech-articulation cortex, speech-perception cortex and the
  high-level language network as three separate systems, and warns against
  collapsing them. It also treats the angular gyrus's language-network membership
  as contested, which the overlap copy now says.

`zatorre-belin-chapter` resolved via Crossref: *Plasticity and Signal
Representation in the Auditory System*, Springer US, pp. 277-290,
`10.1007/0-387-23181-1_26`, ISBN 9780387231549. The page range matches the PDF
exactly. Crossref carries no year for the chapter, so that field stays null with
a note; supply it before print use. The "do not cite" caution is lifted.

**Still unassessed, and now the obvious next target:** the nine papers behind the
older `/brain/compare` views (Parsons 2001, Lipkin 2022, Yeo 2011, Cohen 2002,
Dehaene 2005, Menon 2011, Hasson 2016, and the two Blank paper-view entries).
None have been read or tagged. Four are already in the vault. `/brain/compare` is
the canonical published figure, so it currently holds the weaker provenance of
the two. Three orphaned `SECONDARY-ONLY` entries (Shain 2023, Buckner 2019,
Hassabis 2007) are cited by no view and could be dropped or read.

## Update (2026-08-05i) — six papers read; eight of nine networks at `read`

Saxe, Dufour, Deen, Jouravlev, Chen and Norman-Haignere all read in full. Every
one changed something, which is now the pattern rather than the exception.

**Region sets that were wrong:**
- Theory of Mind grew from six parcels to nine. Dufour defines **three** medial
  prefrontal bands (dorsal, middle, ventral) and the figure had only two; it also
  lists a **right anterior STS** that both Dufour and Saxe report and the figure
  omitted. Added `cn.mMPFC` and `cn.aSTS-R`.
- Dufour treats dorsal MPFC and precuneus as **single midline ROIs**, not
  left/right pairs. The figure draws them as pairs because DK splits the midline
  by hemisphere. Noted on the parcels rather than restructured.

**Claims that were wrong:**
- Right TPJ was described as "the most belief-selective region in the mentalising
  network". Saxe makes no such claim, and its actual laterality finding points the
  other way: left and right did not differ on the belief contrast, and the right
  is if anything the *broader* of the pair.
- The language/music copy said language regions "respond to music less than to
  animal sounds". Chen's abstract says responses "never exceed" those to animal
  sounds — a different and weaker claim. The actual test is p=0.056. **This one
  was a misreading of an abstract I had already quoted correctly**, which is the
  cleanest illustration of why abstract-level verification isn't enough.
- The music/prosody copy implied Norman-Haignere's lateral component maps onto
  prosody. It is **speech**-selective (phonemes and syllables); the word prosody
  never appears in that paper. The spatial contrast is real, the label was mine.

**Scope limits now recorded on the papers themselves:** Norman-Haignere reports
no coordinates of any kind and its maps are smoothed group averages rather than
parcels, so three spheres imply more consistency than it claims; Chen carries
three small non-null results its headline glosses, including a significant
*reversed*-direction effect; Jouravlev masked out every face in its stimuli.

Only `motor` remains below `read`, held by the paywalled Pritchett 2018.

**Process note:** a regex used to swap `note` fields briefly left `papers.json`
invalid, which surfaced as 500s in the dev server and a silent drop from 241 to
215 passing tests (the view's test file failed to import). Prefer `json.load` /
`json.dump` round-trips over regex on this file.

## Update (2026-08-05h) — Music network added; Broca's conflation fixed

**Ninth network: `music`.** Norman-Haignere 2015 located music-selective cortex
in planum polare bilaterally plus left planum temporale — both on the
supratemporal plane, which Desikan-Killiany folds into `superiortemporal` with
no separate label. Recovered with a superior slice (lifting off the lateral
surface) plus a **medial** x slice. Note the x fractions are mirrored between
hemispheres: fraction 0 is most lateral on the left and most medial on the
right, because the axis runs the other way.

The separation rule bit twice here. Left planum polare first landed 0.135 from
`cn.AntTemp-L` against a 0.16 radius sum, and right planum polare 0.128 from
`cn.STG-R` against 0.14. The medial slice cleared the right; the left needed its
superior slice tightened to z ∈ [0.72, 1] before it cleared at 0.220. Music sits
in the most crowded neighbourhood on the figure, so **re-run the collision check
before touching any temporal parcel.**

This is the figure's cleanest dissociation and worth keeping prominent: Chen 2023
found language regions respond to music *below their own resting baseline* and
below their response to animal sounds, cannot distinguish intact from scrambled
music, and that people with aphasia who fail sentence-grammaticality judgements
still pass melody well-formedness judgements.

**Broca's conflation corrected.** Fedorenko's accessible research statement is
blunt: Broca's and Wernicke's "are not actually 'language areas', they are
'speech areas'." `cn.IFG-L` was labelled "IFG / Broca's (L)" with a note calling
it "Broca's territory" and attributing halting speech to damage there — the exact
error the figure exists to undo, sitting inside the figure. Label is now plain
"IFG (L)", and the language panel names the distinction outright. `cn.artic-L`
already carried the speech-motor reading correctly; the others now defer to it.

Both new papers are `PRIMARY-PARTIAL`: Chen 2023 abstract-only (green OA at
escholarship if a full read is wanted), Norman-Haignere queried via PMC for the
anatomy rather than read end to end. It reports **no coordinates at all**, only
anatomical terms, so there is no `mniPeak` to record.

## Update (2026-08-05g) — card stripped to prose + citations

Four removals and one addition, all in the `network-info` card:

- **`whatLightsUp` no longer rendered.** The glowing mesh beside the panel
  already answers "where"; saying it again in words was the longest block on
  the card. Field kept in the content file.
- **Evidence line removed from the card.** The tier still rides on the chip,
  with its wording in the chip `title`. Repeating it above the citations made
  the reader pass a provenance sentence before reaching the sources.
- **`displayNum` badge suppressed** (LANG, EPI, …) — but only when
  `isNetworkInfo`. `/brain/compare` still renders 1/2/3/4 and CEN/DMN/SN, where
  the abbreviations disambiguate three stacked view groups.
- **Sources are now full citations**, resolved per network from `net.paperIds`
  against the papers registry: authors, year, title, italic venue, and a `doi`
  link. Rendered as a numbered list, replacing the compressed `net.source`
  string. `net.source` is still carried by the loader and used for the chip
  tooltip.

The card is now heading, tag line, two paragraphs, citations. Nothing else.

## Update (2026-08-05f) — panel copy rewritten for a general reader

The panels had drifted into methods-section prose: paper names in almost every
sentence, four or five paragraphs per network, and a card that needed scrolling
before the reader learned what the network was for. Rewritten so each network
answers one question — **what does this do?** — in at most two short paragraphs,
in plain language, with no citations in the running text.

- Anatomy in `whatLightsUp` is now described in body terms ("a long stretch
  above and behind the ear") rather than by gyrus name.
- Citations moved entirely to a **SOURCES** list under each card, rendered from
  the view config's `source` string.
- The `checkable` localiser line is **no longer rendered**. It answered "how
  cleanly is this defined?", a methods question, and competed with the one the
  panel exists to answer. The field is retained in the content file rather than
  deleted, so it can come back behind a toggle if a scientist-facing mode is
  ever wanted.
- Overlap copy rewritten the same way — same claims, no paper names.

The evidence dot and its label stay. They are a badge rather than prose, and
they carry the provenance work rather than describing the science.

Nothing about the underlying claims changed in this pass; the corrections from
updates (d) and (e) are all still stated, just in fewer words and without the
citation scaffolding. If a claim needs a source to be intelligible, that is a
signal the sentence is making a methods point and should probably be cut.

## Update (2026-08-05e) — full texts read; one file was the wrong paper

Four PDFs were supplied to clear the `PRIMARY-PARTIAL` tags. Three checked out.

**`belin 2000 - auditory cortex.pdf` is not Belin et al. 2000.** It is a Zatorre
& Belin book chapter, "Auditory cortex processing streams: where are they and
what do they do?", pp. 277-290, which cites the Nature paper separately in its
own reference list. The PDF has no title page, so volume, publisher and year
could not be established (internal citations to *J Neurosci* vol 24 put it at
2004 or later). It is registered as `zatorre-belin-chapter` with an explicit
`caution` field and **must not be cited in writing until the container is
identified**. `belin-2000` stays `PRIMARY-PARTIAL` — abstract only. Always check
the first page against the filename; the filename is not evidence.

**Sammler 2015 and Seeley 2007 upgraded to `PRIMARY-FULL`**, and both changed
the figure:

- Sammler's Table 1 supplied real MNI peaks, and revealed a node the prosody
  network was missing entirely: **right premotor cortex** (MNI 45, 5, 40, BA6,
  the "larynx representation"). Inhibiting it with rTMS degraded prosody
  categorisation, making it one of the few nodes here implicated *causally*.
  Added as `cn.PMC-R` (`rh.caudalmiddlefrontal`), which clears `cn.M1-R` by
  0.232 against a 0.20 radius sum — it passes the separation rule that killed
  MD's opercular IFG. Sammler does **not** implicate Heschl's gyrus; `cn.HG-R`
  is held by Fedorenko 2024 and by Zatorre & Belin's right-biased spectral
  sensitivity instead.
- Seeley confirmed the "dorsal anterior cingulate and orbital frontoinsular
  cortices" wording verbatim, so that label was right. But it also showed the
  three-sphere drawing **understates the network**: the paper's own Discussion
  says most of its nodes are subcortical (extended amygdala, ventral
  striatopallidum, dorsomedial thalamus, hypothalamus, periaqueductal grey,
  substantia nigra), none of which a cortical surface can show. The salience
  panel now says so outright rather than implying three regions are the network.

Published MNI peaks from both papers are recorded as `mniPeak` /
`mniPeakSource` on the relevant parcels, each labelled with exactly which
cluster it came from. They remain reference metadata and never drive placement.

**Kanwisher 1997 upgraded to `PRIMARY-FULL`, and three of the four claims sourced
to it were wrong.** This is the clearest evidence yet that verifying a citation
and verifying a claim are different jobs — the citation had been confirmed two
passes earlier, and the prose was still inaccurate.

- "Responds about twice as strongly to faces" — wrong in the paper's own
  numbers. Its five specificity tests give ratios of 2.8x (objects), 3.2x
  (scrambled faces), 4.0x and 4.5x (hands), and 6.6x (houses). Corrected to
  "three to six times". The paper also reports these for the FFA generally, not
  for right FFA specifically.
- "Among the most reproducible contrasts in the field" — a field-wide
  superlative the paper never attempts. Replaced with what it does show: high
  test-retest reliability within a subject across six months.
- **`cn.OFA-R` dropped.** Kanwisher never mentions an occipital face area; the
  OFA-as-early-stage model is later work (Gauthier 2000, Pitcher/Duchaine). The
  parcel is now referenced by no view, like `cn.EntC-*` and `cn.sgACC`.
- Left-FFA laterality claim survived and gained numbers: right fusiform response
  in every right-handed subject who showed the effect, left in only 5 of 10, at
  half the volume.
- The STS node is weaker than the figure implied — 7 of 15 subjects, and the
  paper explicitly flags its selectivity as needing replication. The panel's
  localiser line now says so.

**Kanwisher reports Talairach, not MNI.** New registry fields `talairachPeak` /
`talairachPeakSource`, deliberately separate from `mniPeak` — the two spaces
differ by more than a centimetre in places. A test forbids storing one in the
other's field or carrying both on a parcel.

**Belin 2000 arrived separately and corrected a claim the abstract had let
stand.** The abstract says voice-selective regions are found "bilaterally" and
stops there, so the panel had asserted that the rightward asymmetry lived in
the prosody streams and *not* in voice selectivity. The full text says
otherwise: voice selectivity was stronger on the right in experiments 1 and 2,
but not in experiment 3, and the authors conclude voice perception "might be
less clearly lateralized than in the case of speech perception." The panel now
carries that hedge instead of a clean bilateral claim. Belin also reports three
voice-selective clusters running front to back along the STS, the middle one
near the anterior extension of Heschl's gyrus, and cites Kanwisher directly
when proposing voice areas as the auditory counterpart of face areas — so that
link between the two chips is the authors' own, not an editorial flourish.

Belin's Table 1 is Talairach and was **not** added to the parcels: `cn.STS-R`
and `cn.STG-R` already carry Sammler's MNI peaks, and the coordinate-space test
forbids one parcel holding both spaces. Belin's cluster structure lives in prose
instead. That test is doing its job; don't relax it to fit a second citation in.

**Craig 2009 read in full and folded into `salience`**, which it had no place in
before — it was left over from the dropped emotion network and cited by nothing.
It earns a place for three reasons: it gives a mechanism for why anterior insula
and anterior cingulate pair up at all (complementary limbic sensory and motor
regions, standing to each other as somatosensory does to motor cortex); it
independently corroborates the "mostly subcortical" caveat by describing the
salience network as including amygdala and hypothalamus; and it corroborates the
"don't treat the anterior insula as one node" caution from a peer-reviewed source
rather than only from the Parvizi preprint, noting that location within the AIC
tracks which body part is involved. Read as the author manuscript, not the typeset
NRN version — flagged in its registry entry, so page-level citation needs checking.

Tier movement: `salience`, `prosody` and `episodic` are now `read` alongside
`language` and `md`. `face` stays `partial` (unread Deen 2015, Jouravlev 2019),
`tom` stays `partial` (unread Dufour 2013), `motor` stays `partial` (unread
Pritchett 2018). No `PRIMARY-PARTIAL` entries remain in this view — every paper it cites has
now been read in full or is a `SECONDARY-ONLY` reference-list harvest.

## Update (2026-08-05d) — source verification pass; emotion network dropped

Every citation that had been recalled from model background knowledge was checked
against the publisher or PubMed record. **All six matched exactly** — authors,
title, venue, volume, pages and DOI. That is the less important half: verifying a
citation proves the paper exists, not that it supports the claim hung on it. Two
claims did not survive that second test.

- **`emotion` network removed.** Its citations verified, but nothing tested the
  amygdala + anterior insula + vmPFC + subgenual ACC grouping as a unit. Chiong
  2013 shows those regions co-degenerating in frontotemporal dementia, which is
  tissue loss in disease rather than a circuit in health, and no source consulted
  mentions subgenual ACC at all. The **amygdala moved to `episodic`**, where
  Phelps & LeDoux 2005 (read in full) does support it — its "Emotional Modulation
  of Memory" section is about amygdala modulation of hippocampal consolidation.
- **`episodic` corrected.** Rugg & Vilberg 2013 and Andrews-Hanna 2014 (both read
  in full, both already in the vault) put neither entorhinal cortex nor precuneus
  in this network — entorhinal is tied to *familiarity* rather than recollection,
  and Andrews-Hanna treats PCC as a cross-subsystem hub with precuneus merely
  adjacent. Both papers include angular gyrus and vmPFC, which were missing.
  Dropping entorhinal and adding those two makes the angular gyrus shared between
  language and episodic memory — a real three-way crowding with ToM's TPJ nearby.

**The evidence tier is now computed, not declared.** `weakestEvidence()` in
`view-loader.js` derives it from the `access` tags of the papers each network
lists in `paperIds`, and takes the **weakest** link. The old hand-declared field
had exactly the hole this closes: `face` showed a mid tier while citing an
`UNVERIFIED` Kanwisher. Do not reintroduce a declared `evidence` — a test asserts
none exists. Tier names changed (`cited` → `partial`) and an untagged or unknown
paper counts as `background`, so a missing tag can never inflate a badge.

Access tags now include **`PRIMARY-PARTIAL`**: citation confirmed against the
publisher record and abstract read, full text paywalled. Belin 2000, Sammler
2015, Kanwisher 1997, Craig 2009 and Seeley 2007 sit there. No network is at
`background` any more, which was the point of the pass.

Substantive corrections the sources forced: Belin says voice-selective cortex is
**bilateral** (the rightward asymmetry Sammler found is in the prosody *streams*,
not voice selectivity), and frames voice areas as the auditory counterpart of the
face areas. Sammler's dual right-hemisphere streams justify the existing prosody
parcels almost exactly, and add a motor link — inhibiting right premotor cortex
degrades prosody judgements. Seeley's own abstract does say "dorsal anterior
cingulate," so that label was right. Parvizi 2026 is cited only as a caution: an
unreviewed preprint that splits the anterior insula into two functionally
distinct zones and prefers "action mode network" to "salience network."

`cn.EntC-L`, `cn.EntC-R` and `cn.sgACC` are now referenced by no view. Kept in
the registry — the geometry is derived and correct, only the grouping was
unsupported.

Still outstanding: full texts for the five `PRIMARY-PARTIAL` papers, and
`Saxe2003_TheoryOfMindTPJ.pdf` sits unread in the vault (reading it would not
change ToM's tier, which is held at `partial` by the unread Dufour 2013).

## Update (2026-08-05c) — `network-info` layout

`BrainViz3D` gained a `layout` prop: `'glossary'` (default, unchanged) or
`'network-info'`. `/brain/networks` uses the new one; its title is now
"The neural architecture of language".

In `network-info` the two side columns swap jobs. Left becomes the network
selector — chips stacked vertically under a NETWORKS heading, with Compare /
All / Reset in their own row beneath a rule. Right becomes a prose panel that
explains whichever networks are lit: name, tag line, what it does, where it
lights up, the localiser line, then evidence tier and sources. In compare mode
the cards stack in `networkOrder` and the panel appends a **Where they meet**
box carrying `content.overlap(active)` — so lighting two chips explains both
systems and their shared territory. The sourcing legend box is gone; each card
now carries its own evidence dot and label, which is what replaced it.

The region glossary and its lookahead search are not rendered in this layout,
so leader lines don't draw here either. Three guards make that safe rather than
crashy, and they matter if you add another layout:

- the glossary build loops over `glossaryRoot ? GROUP_ORDER : []`
- the search listeners are wrapped in `if (searchInput && searchList)` — every
  search call site is inside a listener, so guarding attachment is sufficient
- aux buttons go to `[data-bind="chip-actions"]` when present, else trail the
  chips as before

Per-paper views (`/brain/papers/<slug>`) are explicitly excluded
(`isNetworkInfo = !isPaperView && layout === 'network-info'`) and keep the
glossary, search, and their own drawer. Verified unchanged after this work.

## Update (2026-08-05b) — Fedorenko 2024 pass; Multiple Demand added

Adding Fedorenko, Piantadosi & Gibson 2024 (*Nature* 630:575–586,
`10.1038/s41586-024-07522-w`, peer-reviewed, read in full) changed four things.

- **The view's thesis is now sourced.** The paper's line is that tasks which
  don't recruit the language network engage areas non-overlapping with it that
  nonetheless "sometimes lie in close proximity." Proximity without overlap is
  what the figure draws, so subtitle and language panel now say that outright.
- **Box 2 grounds the two weakest parcels.** It separates the high-level
  language network from Broca's *articulatory planning* area, Wernicke's
  *speech perception* area, sensorimotor cortex and primary auditory cortex —
  the last two engaged during speech "but not selectively," and all four
  sensitive to surface form rather than meaning. `cn.artic-L` and `cn.HG-R`
  previously leaned on Pritchett 2018 and an `UNVERIFIED` Belin 2000; both now
  cite Box 2, and their notes say why they sit on this figure at all.
- **Ninth network: Multiple Demand** (`md`, `read` tier, 6 own parcels + shared
  `cn.SMA` and `cn.dACC`). It is the system Kean 2026 found does the inductive
  and matrix reasoning, and the one most often conflated with language.
- **Episodic copy softened.** The paper calls the default network's function
  debated (episodic projection vs. spatial cognition); the panel now says the
  chip follows one reading rather than stating it flat.

**Why MD has only three parcel pairs.** Mineroff 2018 lists nine AAL masks per
hemisphere. MD's opercular IFG, precentral and insular nodes were deliberately
dropped: derived from DK they land inside labels already claimed by the
language, motor and salience networks — MD IFGop came out **0.07** from
`cn.IFG-L`, well inside both radii. Two spheres closer than the sum of their
radii read as one blob, which asserts the opposite of the figure's thesis. The
MD/language dissociation is functional and interleaved at a finer scale than
any DK-derived figure can resolve; that is precisely why group-averaged data
conflates them. `separates the MD network from its language neighbours by more
than a radius` in the test file enforces this — it caught `cn.MD-InfPar` merging
with the ToM TPJ (0.171 apart, 0.22 radii sum) and forced a tighter slice.
**Apply that check before adding any parcel near an existing one.**

Palette was rebuilt for nine networks: the core triad now matches Fedorenko's
own Fig 1b (language red, MD blue, ToM green), motor took the freed violet, and
episodic went desaturated sepia — nine saturated hues do not separate on a dark
background under additive blending.

## Update (2026-08-05a) — `cortical-networks` view; mesh-derived centroids

New route `/brain/networks` (`BrainViz3D` + `data/views/cortical-networks.json`)
maps eight systems — language, Theory of Mind, prosody, face/gesture, motor,
salience, episodic memory, emotional circuits — built around Kean 2026's claim
that formal reasoning runs outside the language network. 42 new `cn.*` parcels
(48 after the Fedorenko 2024 pass above).

**Three things here are different from every earlier view, and they matter:**

1. **Centroids are derived from the mesh, not hand-tuned.** Every `cn.*` parcel
   is the vertex centroid of a declared subset of the fsaverage DK pial labels
   already sitting in `public/brain-mesh/pial-dk-lo/`, computed by
   `scripts/derive-parcel-centroids.mjs`. The spec supports slicing a label
   along a RAS axis by extent fraction (posterior 25% of superior+middle
   temporal, and so on), so sub-gyral fROIs get real positions. Each parcel
   carries a `derivation` string recording exactly how it was obtained.
   New provenance values: `dk-derived` and `dk-anchored`.

2. **Do not project MNI coordinates onto this mesh.** The OBJ vertices are in
   FreeSurfer tkrRAS, not MNI. Landmark checks put the z offset near +16mm but
   the y offset is inconsistent across the brain, so there is no clean affine
   without the real fsaverage `c_ras`. Projecting published peaks misplaces
   regions by a centimetre or more. Fedorenko 2010's Table 1 peaks are stored
   as `mniPeak` / `mniPeakSource` reference metadata for the glossary and never
   drive placement. Hippocampus and amygdala have no DK surface label at all,
   so they are `dk-anchored`: a neighbouring label's centroid plus a declared
   offset, flagged approximate in provenance, derivation, note and UI.

3. **Networks declare an `evidence` tier.** `read` | `cited` | `background`,
   surfaced as a shape-coded dot on each chip plus a key in the rightcol. This
   exists because the source situation is uneven and would otherwise be
   invisible: Kean 2026 only studies language, MD, and a deduction-sensitive
   region. Prosody, salience and emotion are **not** discussed by any paper on
   disk, Fedorenko 2024 included — they are background knowledge with nominal
   citations, tagged `UNVERIFIED` in `papers.json`. `language`, `md` and `tom`
   are `read`.
   Papers now carry an `access` field (`PRIMARY-FULL` / `SECONDARY-ONLY` /
   `UNVERIFIED`) per the Source Transparency Protocol.

Anti-drift: `test/brain-viz/cortical-networks.test.js` re-runs the derivation
script and fails if any committed centroid disagrees, and asserts ~20 relative
anatomical facts (amygdala anterior to hippocampus, M1 anterior to S1, insula
deeper than the STG above it, every lateralised parcel in its own hemisphere).
Re-run the script after editing any spec and paste the numbers back.

Shared plumbing touched: `view-loader` now passes `displayNum`, `source` and
`evidence` through — **`displayNum` was already read by both shells but never
supplied, so every chip badge on `/brain/compare` had been rendering empty**;
that page now shows its 1/2/3/4, CEN/DMN/SN and VWFA badges. `parcel-registry`
passes through `derivation`, `mniPeak`, `mniPeakSource`. Both shells gained the
`cingulate-anterior` and `subcortical` glossary groups.

Known rough edge: with all eight networks active the additive blending
saturates to white where many overlap (temporo-parietal junction especially).
The √N tapering in `emissive.js` was tuned for three networks. Left alone
rather than retuned, since it would change every existing view.

Caveat on copy: all `note` / `layCue` strings on `cn.*` parcels and all of
`data/content/cortical-networks.json` were drafted by Claude and are unreviewed.

## Update (2026-06-14) — glossary groups collapse by default

The left glossary column listed all 26 parcels with every anatomical group
expanded, which overflowed the fixed-height column and threw a scrollbar.
Filtering couldn't help — all 26 registry parcels are in-view across the three
compare views, so there are no faded entries to drop. Fix is layout-only: the
group `<details>` now render **collapsed** in both shells (`details.open = false`),
so the column shows ~8 group headers + the search box and fits without scrolling.
The search box is the fast path to any term; clicking a header browses.

One dependency: leader lines only draw for *visible* glossary entries
(`drawLeaderLines` skips `offsetParent === null`). So `syncGlossary()` in both
shells now auto-opens a group whenever one of its parcels is inspected — this
keeps leader lines working for every inspect path (glossary click, search-graph,
per-paper inline refs, section "Highlight all"). The render loop redraws each
frame, so no manual redraw is needed. No CSS change (the group caret already
rotates for the closed state).

## Update (2026-06-13) — area lookahead search

Both shells (`BrainCompare3D`, `BrainViz3D`) now have a search box at the top of
the left glossary column. Typing the first characters of an area name shows a
ranked autocomplete; picking a match **graphs** it — inspects the parcel (leader
line), pulses the mesh, expands its glossary group, and scrolls + flashes its
glossary entry. The corpus is exactly the graphable parcels (those with a mesh:
`compare.parcels` / `view.parcels`), never an area the renderer can't draw.
Ranking logic is a new pure module `src/lib/brain-viz/parcel-search.js`
(`searchParcels`, 10 tests); DOM/keyboard wiring (combobox a11y, arrow/Enter/Esc)
lives in each shell; styles are shared in `brain-3d.css` (`.brain-3d__search*`,
`brain-3d-entry-flash`). Compare pulses amber; per-paper pulses the parcel's
network color to match the existing inline-ref pulse.

## Update (2026-05-14) — per-paper views

Commit `30fcd11` adds an author-only PDF upload flow (admin Papers tab → Claude
extraction → editable JSON → Save) that turns a paper into a per-paper
`/brain/papers/<slug>` route. The shell is `BrainViz3D` extended with new
`paperMeta` / `paperContent` / `glossaryMode` props: the right column becomes a
slide-out drawer with paper metadata + an accordion of body sections, inline
parcel refs styled as buttons that inspect + pulse the corresponding mesh
region in the containing network's color. New plumbing: `paper-content.js`
(pure loader + sanitizer with 7 tests), `pulseParcel()` on the renderer,
`allowZero` option on `view-state` so per-paper chips behave as pure toggles
(curated views keep the always-one-active guard). First real paper is
`blank-2026` ("Video games as stimuli in neuroimaging studies"). Partially
resolves Known issues #2 and #3 below — single-view-shaped pages exist again
under `/brain/papers/<slug>`, so `BrainViz3D` is no longer orphaned and the
chip-group anchors in the compare shell have a sensible target. The "Adding a
new view" recipe below is still accurate for curated views; the per-paper
upload flow is a separate path documented in the commit message.

## Current state (snapshot)

- **Canonical route:** `/brain/compare` — the only working brain page. Composes
  three paper-derived view configs into a single Three.js scene with cross-paper
  toggle semantics.
- **Renderer:** real fsaverage Desikan-Killiany pial mesh (70 OBJ files, 35 L +
  35 R), pre-decimated to 15% retention. Network-agnostic; consumes resolved
  views and view-state and knows nothing about specific networks.
- **Three view configs:**
  - `four-modes` — Parsons & Osherson 2001 (M1/M2), Paunov 2022 + Lipkin 2022
    atlas (M3), Paunov 2022 + Hasson 2016 + Yeo 2011 (M4).
  - `triple-network` — Menon 2011 / Seeley 2007 / Yeo 2011 (CEN, DMN, SN).
  - `vwfa` — Cohen 2002 single-ROI view (visual word form area).
- **Tests:** ~1,300 LOC unit tests across nine pure-JS lib modules. Renderer is
  visual-integration only (verified in browser, not unit tested).

## Code layout

```
src/components/brain-3d/
  BrainViz3D.astro             # single-view shell (chips + glossary + canvas)
  BrainCompare3D.astro         # cross-paper compare shell — used by /brain/compare
  BrainHeader.astro            # shared title + nav slot
  renderer.js                  # Three.js renderer; network-agnostic
  data/
    registry/
      parcels.json             # master parcel atlas (id → label, centroid, group, …)
      papers.json              # citation registry (id → authors, year, title, …)
    views/
      four-modes.json          # paper-derived view config
      triple-network.json
      vwfa.json
    content/
      four-modes.json          # text content for the view (intro, captions)
      triple-network.json
      vwfa.json

src/lib/brain-viz/             # pure JS, no DOM, fully unit-tested
  parcel-registry.js           # validates + indexes parcels.json
  view-loader.js               # single view → renderer-shaped resolved view
  compare-loader.js            # multi-view → same shape with composite IDs
  view-state.js                # single-view chip state (sequential / compare)
  cross-paper-state.js         # multi-view chip state (compare-only)
  glossary-state.js            # inspected-parcel set, drives leader lines
  parcel-search.js             # ranked lookahead matching for the area search box
  content.js                   # view text content loader
  emissive.js                  # color helpers (hex→rgb, contrast text, blending)
  label-visibility.js          # visible-label computation

src/pages/
  brain.astro                  # redirect (currently broken — see Known issues)
  brain/compare.astro          # /brain/compare page

src/styles/brain-3d.css        # shared base styles for both shells

public/brain-mesh/pial-dk-lo/  # pre-decimated fsaverage DK pial OBJs + manifest.txt

scripts/decimate-brain-mesh.mjs  # one-shot: pial-dk → pial-dk-lo at 15% retention

test/brain-viz/                # nine .test.js files, one per lib module
```

## Architecture

### Layered separation

The renderer never touches data files or DOM events. The lib modules never touch
Three.js or the DOM. The Astro shells own DOM wiring and pass two things into
`createBrainRenderer`: a **view** (resolved, renderer-shaped) and a **state**
(provides `activeNetworks()` and `subscribe()`). This is what lets the same
renderer drive both single-view and compare shells without modification.

```
  data/views/*.json                          data/registry/*.json
       │                                            │
       ▼                                            ▼
  view-loader  ──┐                          parcel-registry
                 ├──► resolved view ──┐
  compare-loader ┘                    │
                                      ├──► createBrainRenderer({ canvas, view, viewState })
  view-state    ──┐                   │       (Three.js, network-agnostic)
                  ├──► activeNetworks ┘
  cross-paper-st ─┘                              ▲
                                                 │  onAfterRender
  glossary-state ──► inspectedParcels ───────────┘  drawLeaderLines()
```

### Data shape

**Parcel** (in `data/registry/parcels.json`):
- `id` — stable string ID (e.g. `lang.LanA-IFGorb-L`, `dk.lh-frontal-coarse`)
- `label` — human display name
- `centroid` — `[x, y, z]` in mesh space
- `radius` — defaults to `0.10`
- `hemisphere` — `"L"`, `"R"`, or `null`
- `group` — anatomical group for glossary sectioning (e.g. `frontal`, `parietal-medial`)
- `provenance` — `"hand-tuned"` or atlas-grounded label; `view-loader` aggregates
  per-network and per-view provenance flags
- `note` — glossary tooltip body (optional)
- `atlas` — source atlas (optional)

**View** (in `data/views/*.json`):
- `slug` — view identifier (`four-modes`, `triple-network`, `vwfa`)
- `name`, `subtitle`
- `papers` — array of paper IDs referenced in `data/registry/papers.json`
- `networks` — `{ networkId: { displayNum, label, color, source, parcels: [parcelId, …] } }`
- `networkOrder` — explicit display order
- `defaultNetwork` — initial active network for the single-view shell
- `uiMode` — currently always `chips-with-compare`

**Compare** (the shape returned by `compare-loader`):
- Network IDs are namespaced as `viewSlug:networkId` so collisions across views
  are impossible by construction. The renderer keeps treating IDs as opaque
  strings — same code path as a single-view load. `views` and `viewOrder`
  fields carry per-view metadata so the UI can group chips by paper.

### State semantics

- **`view-state`** (single view): `sequential` (one active network, `select(id)`
  replaces) or `compare` (toggle on/off, auto-exits when set drops to one).
  Always at least one active network.
- **`cross-paper-state`** (compare): toggle-only over composite keys; active
  set may be empty (means nothing glows). No sequential mode.
- **`glossary-state`**: independent inspected-parcel set; the renderer composes
  it with the active-networks channel to draw leader lines from glossary
  entries to parcel centroids on the mesh.

### Rendering details

- Cortex is real fsaverage DK pial, loaded from `public/brain-mesh/pial-dk-lo/`
  via the manifest. Stencil-masked wireframe at 25% opacity, MeshBasicMaterial.
- Lighting: three-point with slightly warm key, cool fill, low ambient.
- Parcel emissive uses additive blending across active networks with √N intensity
  tapering (`computeParcelEmissive` in `emissive.js`). Lets shared parcels
  visibly blend (e.g. M04 ↔ DMN shows red+purple).
- Anatomical direction labels (RIGHT / LEFT / SUPERIOR / etc) are projected each
  frame from fixed 3D anchors at ±1.2; rendered as SVG overlay alongside leader
  lines so they follow camera rotation.
- Tooltip is a single floating element reused across hovers; clamped to root
  bounds.

## Conventions

- **No new dependencies.** Three.js is in already; the lib modules are pure JS
  using only Node-built / browser-built primitives. The renderer also uses two
  Three.js addons (`OBJLoader`, `OBJExporter` + `SimplifyModifier` in the
  decimator).
- **Pure-JS lib modules.** No DOM access, no Three.js imports. Anything testable
  goes in `src/lib/brain-viz/`. Anything Three.js-shaped goes in
  `src/components/brain-3d/renderer.js`. DOM glue goes in the Astro shells.
- **Network-agnostic renderer.** No hardcoded "modes" or "networks" — networks
  are arbitrary string IDs supplied by the view config.
- **Composite ID namespacing.** Compare loader uses `viewSlug:networkId` as the
  composite key. Both `compare-loader` and `cross-paper-state` import
  `compositeKey()` from `cross-paper-state` so the format has one source of truth.
- **Provenance.** Parcels declare `"hand-tuned"` vs. atlas-grounded so disclaimers
  in the UI stay honest. `view-loader` rolls these up into per-network and
  per-view flags (`handTunedNetworks`, `allHandTuned`).
- **Mesh decimation is one-shot.** `scripts/decimate-brain-mesh.mjs` reads
  `public/brain-mesh/pial-dk/`, writes `public/brain-mesh/pial-dk-lo/`. Run once;
  the renderer loads the pre-decimated dir at runtime and never simplifies on
  the fly. (The full-resolution `pial-dk` source is deliberately not committed
  if it isn't already.)
- **Parcels.json supports `_comment_*` keys.** `parcel-registry` skips them.
  Use them for inline documentation of atlas decisions inside the data file.

## Phases shipped

- **Initial** (`cce5b85`) — Brain modes 3D figure for the four cognitive modes.
- **Phase A** (`5f6f8c5`) — View-agnostic architecture refactor; glossary panel;
  leader lines from glossary entries to mesh.
- **Phase B** (`f173fe1`) — Triple Network view (CEN/DMN/SN); per-view config
  driving the same shell.
- **Phase C** (`7cf68fa`) — VWFA single-ROI view (Cohen 2002); N=1 networks
  render as static label chip (no Compare/All controls).
- **Phase D** (`deb4de4`) — Cross-paper compare; 7-color palette; anatomical
  direction labels. **Single-view routes deleted** — `/brain/compare` became
  the canonical figure.
- **Polish** (`b6bd2bf`) — Glossary tooltips on hover/focus; chip styling.
- **Cleanup** (`6cd6967`) — Removed `data/compare-presets.json` (contrast-pair
  presets were retired in favor of free-form chip toggling).

## Known issues / loose ends

_None at the moment. The Phase D loose ends listed here previously
(`brain.astro` redirect to a deleted route; chip-group headers anchoring to
deleted per-view pages; `BrainViz3D` orphaned) were resolved on 2026-05-22:
the redirect now points at `/brain/compare`; the chip-group headers were
changed from anchors to plain labels (no per-view deep link); and `BrainViz3D`
is actively used by `/brain/papers/<slug>` so the "orphaned" claim was stale._

## Adding a new view

Rough recipe (verify against current code before relying on it):

1. **Add parcels** to `data/registry/parcels.json` if the view references regions
   that aren't already in the registry. Each entry needs `label`, `centroid`,
   `group`, and `provenance` at minimum. Use `_comment_*` keys to document
   atlas decisions.
2. **Add papers** to `data/registry/papers.json` for any new citations.
3. **Create `data/views/<slug>.json`** following the View shape above. Pick
   network colors that contrast well with the existing palette so the compare
   page reads cleanly when the new view's chips are toggled alongside the
   others.
4. **Create `data/content/<slug>.json`** with the text content for the view
   (intro, captions). Schema lives in `src/lib/brain-viz/content.js` — keep it
   minimal until the shell needs more.
5. **Add the view config to `src/pages/brain/compare.astro`** — append to
   `viewConfigs` and decide whether to update `initialActive`.
6. **Add tests** in `test/brain-viz/` if you touched any lib module. Existing
   tests validate parcel resolution, network ordering, and provenance rollups.
7. **No mesh changes** are needed unless the new view references parcels
   outside the DK atlas — in which case extend `pial-dk-lo` and the manifest.

## Pointers

- Live URL: `/brain/compare` (canonical).
- Source paper attributions live in each view's `data/views/*.json` `papers`
  field and in `data/registry/papers.json`.
- For project-level context, see `PROJECT_STATUS.md` and `.planning/PROJECT.md`.
- For the dashboard sub-project's design notes (parallel pattern), see
  `scripts/dashboard/DESIGN.md`.
