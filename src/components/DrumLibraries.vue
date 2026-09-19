<script setup>
/**
 * Where drum libraries are pointed at, listed and thrown away.
 *
 * This lived in the drum book, which was four tabs of which one was a
 * catalogue. Pointing jamin at a folder is a thing somebody does once a month
 * and never while choosing a groove, so it sat in the way of the only tab
 * anybody opens the book for -- and it has no place at all in the graph the
 * catalogue is becoming. It is a setting, and it is in Settings.
 */
import { computed, ref, watch } from 'vue'
import {
  state,
  toast,
  refreshDrumSets,
  importDrumFolder,
  importDrumFolderByReference,
  cancelDrumImport,
  forgetDrumSet,
  forgetEveryDrumSet,
  prepareDrumFilters,
  setDrumSetKit,
  countEachDrumSet,
  kitMapFor,
  inboundFor,
  buildIndexes,
  indexesAreCurrent,
} from '../store.js'
import { DRUM_KITS, DEFAULT_KIT, kitById, mapDrumNote } from '../core/drumKits.js'
import DrumLibraryNotes from './DrumLibraryNotes.vue'
import InfoTip from './InfoTip.vue'

const settings = computed(() => state.settings.drums)

/** What a library written before kits were always named falls back to. */
const defaultKitId = DEFAULT_KIT

const folderInput = ref(null)

/**
 * Which library is being taught its own notes, by id.
 *
 * A dialog rather than a row that grows: the table is one line per library
 * and this is forty lines of questions, and a table that expands to forty
 * times its height is a table nobody can find their place in again.
 */
const teaching = ref('')
const beingTaught = computed(() => state.drumSets.find((set) => set.id === teaching.value))

/** Bytes, as somebody would say them. */
function inGigabytes(bytes) {
  const mb = (bytes || 0) / 1024 / 1024
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`
}

/** Everything the sampling found, minus the note tallies, which are machinery
    rather than something to read. */
function setFacts(set) {
  const { pitches, pitchUse, ...rest } = set.facts || {}
  return rest
}

/**
 * How much of a library the kit it is set to cannot play.
 *
 * A pack written for one sampler and played through another loses notes in
 * silence: nothing errors, the pattern is simply thinner than it should be. The
 * pitches the sampling saw are kept for exactly this, so the number is live
 * against whichever kit the library is set to.
 *
 * Both halves of the journey, in the right order, which is the whole of what
 * was wrong with it: the library's own numbering reads the note *in* to a
 * voice, and the drum instrument on the track writes that voice *out* to a
 * note. It had the library's outbound map standing in for the instrument's,
 * and no inbound map at all -- so `mapDrumNote` fell back on its default,
 * which is the twenty pads of a TD-11. Every library read as "106 of 128
 * sounds have nowhere to go" no matter which map was picked, because the map
 * being picked was not the one being consulted.
 *
 * @see core/drumKits.js mapDrumNote, store.js inboundMapFor / kitMapFor --
 * which is what playing a groove really does, and what this now mirrors.
 */
function unplayable(set) {
  const pitches = (set.facts && set.facts.pitches) || []
  if (!pitches.length) return null

  const inbound = inboundFor(set)
  const out = kitMapFor()
  const lost = pitches.filter((pitch) => mapDrumNote(pitch, out, inbound) === null)

  /*
   * How much of the *playing* is lost, not how much of the list.
   *
   * These are wildly different numbers and only one of them is worth showing.
   * A sampled library reaches a hundred and twenty-eight distinct notes
   * because it hangs a dozen rare articulations off the far ends of the
   * keyboard; counting those equally with the kick says "seventy-nine of your
   * hundred and twenty-eight sounds have nowhere to go", which sounds like a
   * broken library and sent somebody off to change a map that was correct.
   * Weighted by how often each note is actually struck the same library loses
   * eight per cent, which is the truth and is worth a footnote rather than a
   * warning.
   *
   * Libraries imported before the tallies were kept have the list and not the
   * counts; those fall back to the old reading, which is the only one their
   * record can support.
   */
  const uses = (set.facts && set.facts.pitchUse) || null
  const struck = uses ? Object.values(uses).reduce((sum, n) => sum + n, 0) : 0
  const missed = uses
    ? lost.reduce((sum, pitch) => sum + (uses[pitch] || 0), 0)
    : 0

  return {
    lost: lost.length,
    total: pitches.length,
    weighed: Boolean(struck),
    percent: struck ? Math.round(100 * missed / struck)
                    : Math.round(100 * lost.length / pitches.length),
  }
}

function pickFolder() {
  if (folderInput.value) folderInput.value.click()
}

async function onFolderPicked(event) {
  const files = event.target.files
  if (!files || !files.length) return
  // The folder's own name, from the first file's path -- a directory picker
  // gives no other way to know what was chosen.
  const first = files[0].webkitRelativePath || files[0].name
  await importDrumFolder(files, first.split('/')[0] || 'library')
  event.target.value = ''
}

/**
 * What is really in there, counted rather than recalled.
 *
 * The number on a library's row is what the import counted as it went. That is
 * a record of what happened, not a reading of what is there.
 */
function reallyHolds(set) {
  const held = state.drumCounts[set.id]
  return held === undefined ? null : held
}

/**
 * Erasing the lot, confirmed by a second press rather than by a dialog.
 *
 * A plugin web view has no dialog to confirm with -- `window.confirm` answers
 * false the instant it is asked -- so the button asks by changing what it says
 * and waiting.
 */
const eraseArmed = ref(false)
let eraseTimer = null

function eraseEverything() {
  if (!eraseArmed.value) {
    eraseArmed.value = true
    toast('Press again to erase every imported library')
    clearTimeout(eraseTimer)
    eraseTimer = setTimeout(() => { eraseArmed.value = false }, 6000)
    return
  }
  clearTimeout(eraseTimer)
  eraseArmed.value = false
  forgetEveryDrumSet()
}

/*
 * A catalogue imported before the paired indexes existed.
 *
 * It works without them -- the facets fall back to a walk of the library, which
 * is correct and slow -- so this is an offer rather than a warning.
 */
const indexesOld = ref(false)

watch(() => [state.ui.settings, state.ui.settingsTab, state.drumSets.length],
      async ([open, tab]) => {
        if (!open || tab !== 'libraries') return
        indexesOld.value = !(await indexesAreCurrent())
        countEachDrumSet()
      }, { immediate: false })

async function bringIndexesUpToDate() {
  state.drumImport.preparing = true
  state.drumImport.name = 'Preparing the catalogue'
  await buildIndexes()
  state.drumImport.preparing = false
  indexesOld.value = false
  await refreshDrumSets()
  toast('The catalogue is indexed')
}
</script>

<template>
  <div class="text-caption text-medium-emphasis mb-3">
    <span v-if="state.host.active">
      Point jamin at a folder of drum MIDI. The files stay where they are and play from
      there.
    </span>
    <span v-else>Add a folder of drum MIDI and it reads what is in it.</span>
    <InfoTip>
      <span v-if="state.host.active">
        Point at one pack and it becomes one library. Point at a folder with fifty
        packs in it and each becomes its own library, because that is the level a
        vendor's name is at, and a note map belongs to a vendor rather than to a
        collection. Everything below a pack is its shelves.
        <br /><br />
        Stopping leaves what has been read where it is; starting again carries on from
        the pack it stopped in rather than beginning over.
        <br /><br />
        A plugin can reach the filesystem, so a library is pointed at rather than
        swallowed: what is kept here is an index — what each pattern is called, how long
        it is, what shelf it sits on — and the notes stay in the file, read at the moment
        something needs to play them. Half a gigabyte of MIDI becomes a few tens of
        megabytes of index, and what plays is the original rather than a copy of it.
        <br /><br />
        Move or rename the folder and the patterns stop playing, which is the price of
        not copying it.
        <br /><br />
      </span>
      Nothing imported is ever redistributed: it is read from where it already is on
      this machine, kept in this browser's own database, and never leaves. The bundled
      corpus is the only one that can legally travel with the program — a library you
      bought is yours to use and not ours to ship.
      <br /><br />
      Files are read whole. A pattern is whatever the file is, because a library of
      authored loops is already a whole number of bars and cutting it up would only
      make it worse.
    </InfoTip>
  </div>

  <div class="d-flex align-center flex-wrap mb-4" style="gap: 8px">
    <!-- Inside a plugin the filesystem is right there, so the library
         is pointed at rather than swallowed: the database keeps an
         index and the notes stay in the files. A web page has no path
         to point at and has to take a copy. -->
    <v-btn v-if="state.host.active" size="small" variant="tonal"
           prepend-icon="mdi-folder-open-outline"
           :disabled="state.drumImport.running" @click="importDrumFolderByReference">
      Point at a folder
    </v-btn>
    <v-btn v-else size="small" variant="tonal" prepend-icon="mdi-folder-open-outline"
           :disabled="state.drumImport.running" @click="pickFolder">
      Add a folder
    </v-btn>
    <input ref="folderInput" type="file" webkitdirectory directory multiple
           style="display: none" @change="onFolderPicked" />

    <!-- Building the indexes, which happens once at the start of an
         import and never on its own. There is no progress to be had
         from inside an upgrade transaction, so what it says is what
         there is: what it is doing, why, and that it is once. -->
    <template v-if="state.drumImport.preparing">
      <v-progress-circular indeterminate size="18" width="2" color="primary" />
      <span class="text-caption">
        Preparing the catalogue — building the filter indexes over the patterns
        already imported. This happens once and may take up to a minute on a
        large collection.
      </span>
    </template>

    <template v-else-if="state.drumImport.running">
      <!-- Packs, because that is the only count known before the
           work starts. The tree below each is walked while it is read
           rather than measured first, so folders and files are
           reported as they are found rather than as a fraction. -->
      <v-progress-circular
        v-if="!state.drumImport.packs" indeterminate size="18" width="2" />
      <v-progress-circular
        v-else size="18" width="2"
        :model-value="100 * state.drumImport.packsDone / state.drumImport.packs"
      />
      <span class="text-caption">
        <template v-if="state.drumImport.packs > 1">
          {{ state.drumImport.pack || state.drumImport.name }} —
          library {{ state.drumImport.packsDone + 1 }} of
          {{ state.drumImport.packs }} ·
          {{ state.drumImport.shelvesDone.toLocaleString() }} folders ·
          {{ state.drumImport.read.toLocaleString() }} read
        </template>
        <template v-else>
          {{ state.drumImport.name }} —
          {{ state.drumImport.read.toLocaleString() }}<template
            v-if="state.drumImport.total"> of
            {{ state.drumImport.total.toLocaleString() }}</template>
        </template>
        <span v-if="state.drumImport.skipped">
          · {{ state.drumImport.skipped.toLocaleString() }} skipped
        </span>
        <span v-if="state.drumImport.packsKept">
          · {{ state.drumImport.packsKept.toLocaleString() }} already here
        </span>
      </span>
      <v-btn size="x-small" variant="text" @click="cancelDrumImport">Stop</v-btn>
    </template>
  </div>

  <!-- Taking a library out is minutes of work for a large one, and
       a window that has not changed looks like a window that has
       hung. -->
  <div v-if="state.drumRemoval.running" class="mb-3">
    <div class="d-flex align-center mb-1" style="gap: 8px">
      <v-progress-circular indeterminate size="16" width="2" color="error" />
      <span class="text-caption">
        Removing {{ state.drumRemoval.name }} —
        {{ state.drumRemoval.done.toLocaleString() }}<span v-if="state.drumRemoval.total">
          of {{ state.drumRemoval.total.toLocaleString() }}</span> patterns
      </span>
    </div>
    <v-progress-linear
      v-if="state.drumRemoval.total"
      :model-value="100 * state.drumRemoval.done / state.drumRemoval.total"
      color="error" height="4" rounded
    />
  </div>

  <v-table v-if="state.drumSets.length" density="compact">
    <thead>
      <tr>
        <th class="text-caption">Library</th>
        <th class="text-caption">Patterns</th>
        <th class="text-caption">Kit its notes were written for</th>
        <th class="text-caption">What it says about itself</th>
        <th />
      </tr>
    </thead>
    <tbody>
      <tr v-for="set in state.drumSets" :key="set.id">
        <td class="text-body-2">
          {{ set.name }}
          <div v-if="set.byReference || set.partial"
               class="text-caption text-medium-emphasis" :title="set.root">
            <span v-if="set.byReference">played from disk</span>
            <span v-if="set.byReference && set.partial"> · </span>
            <span v-if="set.partial">stopped part way</span>
          </div>
        </td>
        <!-- What the import counted, and what the database actually
             holds when the two disagree. The recorded number is a
             record of what happened rather than a reading of what is
             there, and it is the one that lies. -->
        <td class="text-caption">
          {{ (set.count || 0).toLocaleString() }}
          <div v-if="reallyHolds(set) !== null && reallyHolds(set) !== (set.count || 0)"
               class="text-warning">
            {{ reallyHolds(set).toLocaleString() }} in the database
          </div>
        </td>
        <td style="min-width: 190px">
          <!-- No "whatever the Kit tab says". Which numbering a
               library's files are written in is a fact about the
               files; it does not change because somebody picked a
               different drum instrument for the track. -->
          <v-select
            :model-value="set.kit || defaultKitId"
            :items="DRUM_KITS.map((k) => ({ title: k.name, value: k.id }))"
            density="compact" hide-details variant="plain"
            @update:model-value="setDrumSetKit(set.id, $event)"
          />
        </td>
        <td class="text-caption text-medium-emphasis">
          <!-- The number that says whether the kit above is right.
               A library played through the wrong map loses notes in
               silence; nothing else would tell you.

               Said as a share of the playing, because that is the
               question somebody is asking. The count of sounds is
               kept beside it in the tooltip for anybody who wants to
               go looking, but it is not the headline: it was, and it
               read 106 of 128 on a library that played fine. -->
          <div v-if="unplayable(set) && unplayable(set).lost" class="mb-1">
            <span :class="unplayable(set).percent > 10 ? 'text-warning' : ''"
                  :title="`${unplayable(set).lost} of ${unplayable(set).total} distinct `
                    + `notes in this library have no voice in jamin's vocabulary`">
              <template v-if="unplayable(set).weighed">
                {{ unplayable(set).percent }}% of this library’s notes have
                nowhere to go on this kit
              </template>
              <template v-else>
                {{ unplayable(set).lost }} of {{ unplayable(set).total }} sounds
                have nowhere to go on this kit
              </template>
            </span>
            <!-- The way out of it, next to the number that says it is
                 needed. Another map is the answer when the library is
                 written in somebody's numbering; when it is written in
                 its own, no map is, and this is. -->
            <v-btn size="x-small" variant="text" class="text-none ml-1 px-1"
                   @click="teaching = set.id">Tell jamin what they are</v-btn>
          </div>
          <!-- Why, when the classifier gave up. A pack of chromatic
               runs is how a sample library indexes itself and is not a
               kit; an empty box does not say that. -->
          <div v-if="set.kitReason" class="mb-1 text-medium-emphasis">
            No map could be worked out — {{ set.kitReason }}
          </div>
          <!-- What the classifier made of the shelves inside. A pack
               disagrees with itself often enough that this is worth
               showing rather than hiding behind one setting. -->
          <div v-if="set.folders" class="mb-1">
            {{ set.folders.toLocaleString() }} shelves<span
              v-if="Object.keys(set.folderKits || {}).length">,
              {{ Object.keys(set.folderKits).length.toLocaleString() }} with a map of
              their own</span>
          </div>
          <span v-for="(value, key) in setFacts(set)" :key="key" class="mr-2">
            <strong>{{ key }}</strong> {{ value }}
          </span>
        </td>
        <td class="text-right">
          <v-btn icon size="x-small" variant="text" color="error"
                 :disabled="state.drumRemoval.running"
                 :aria-label="`Remove ${set.name}`" @click="forgetDrumSet(set.id)">
            <v-icon size="16">mdi-delete-outline</v-icon>
          </v-btn>
        </td>
      </tr>
    </tbody>
  </v-table>

  <div v-if="state.drumSets.length && state.drumStorage.quota"
       class="text-caption text-medium-emphasis mt-2">
    The catalogue is using {{ inGigabytes(state.drumStorage.usage) }} of the
    {{ inGigabytes(state.drumStorage.quota) }} this machine will give it.
  </div>

  <div v-else-if="!state.drumSets.length" class="text-caption text-medium-emphasis pa-4">
    No libraries yet. The bundled corpus is on the Grooves tab and works without any.
  </div>

  <!-- Imported before this version knew how to index them. It works
       either way; without the indexes a library's own filters are a
       walk of its rows, which on a large one is a wait every time. -->
  <div v-if="indexesOld && state.drumSets.length && !state.drumImport.preparing"
       class="d-flex align-center mt-4" style="gap: 8px">
    <v-btn size="small" variant="tonal" color="primary"
           prepend-icon="mdi-database-refresh-outline"
           @click="bringIndexesUpToDate">
      Index the catalogue
    </v-btn>
    <span class="text-caption text-medium-emphasis">
      These libraries were imported before the filter indexes existed. Filtering
      works without them by reading each library, which on a large one is a wait
      every time you choose it. Building them takes up to a minute, once — it
      happens on its own at the start of your next import.
    </span>
  </div>

  <!--
    Count the dropdowns for a catalogue imported before they were counted at
    import.

    Offered here rather than done on the first open: on a large collection it
    is minutes, and doing minutes of work because somebody opened a menu is
    the thing this exists to stop. Everything imported from now on is tallied
    as it arrives and never needs it. @see store.js prepareDrumFilters
  -->
  <div v-if="state.drumSets.length" class="d-flex align-center mt-4" style="gap: 8px">
    <v-btn size="small" variant="tonal"
           prepend-icon="mdi-filter-check-outline"
           :loading="state.drumPreparing.running"
           :disabled="state.drumPreparing.running || state.drumRemoval.running"
           @click="prepareDrumFilters">
      Count the filter lists
    </v-btn>
    <span class="text-caption text-medium-emphasis">
      <template v-if="state.drumPreparing.running">
        {{ state.drumPreparing.name }} — {{ state.drumPreparing.done + 1 }} of
        {{ state.drumPreparing.of }}<span v-if="state.drumPreparing.rows">,
        {{ state.drumPreparing.rows.toLocaleString() }} read</span>
      </template>
      <template v-else>
        Once, for libraries imported before jamin counted them on the way in.
        Afterwards, choosing a library is instant.
      </template>
    </span>
  </div>

  <!-- Start again. One library at a time is fifty confirmations when
       what somebody means is "clear it out", which after a run of
       broken imports is a thing they mean often. -->
  <div v-if="state.drumSets.length" class="d-flex align-center mt-4" style="gap: 8px">
    <v-btn size="small" variant="tonal" color="error"
           prepend-icon="mdi-delete-sweep-outline"
           :disabled="state.drumRemoval.running"
           @click="eraseEverything">
      {{ eraseArmed ? 'Press again to erase them' : `Erase all ${state.drumSets.length} imported libraries` }}
    </v-btn>
    <span class="text-caption text-medium-emphasis">
      The MIDI files are not touched — these are pointers into folders that stay
      where they are.
    </span>
  </div>

  <!-- What this library's own notes mean, when no standard says. -->
  <v-dialog :model-value="Boolean(beingTaught)" max-width="1100" scrollable
            @update:model-value="teaching = ''">
    <v-card v-if="beingTaught">
      <v-card-title class="text-body-1">Notes with no drum</v-card-title>
      <v-card-text>
        <DrumLibraryNotes :set="beingTaught" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn class="text-none" @click="teaching = ''">Done</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

<!-- Kit: where the drums actually are -------------------------- -->
</template>
