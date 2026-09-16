/**
 * Dragging a pattern out of jamin and into the arrangement.
 *
 * **Not an HTML5 drag.** `dragstart` is the obvious way and it does not work
 * here: the web view begins its own drag on that event, and JUCE then refuses
 * to begin one -- *"cannot start a new drag, a previous drag has not
 * finished"*. So the gesture is watched directly. Mouse down on a row, then the
 * pointer leaves the row with the button still held: that is what dragging
 * something out of a window is, and it is the point at which the plugin can
 * take over.
 *
 * What crosses over is a real MIDI file. A DAW has no idea what a jamin phrase
 * is and every idea what a `.mid` is, so the pattern is written out, dropped in
 * the temporary directory under a name somebody will recognise on a track, and
 * handed to the host. @see midiWrite.js, native/plugin/PluginEditor.cpp
 *
 * In a browser there is no host to hand it to, so the same gesture saves the
 * file instead -- which is what a browser can do and a plugin cannot.
 */

import { callHost, hosted } from './host.js'
import { writeMidiFile, midiFileName } from './midiWrite.js'
import { toBase64 } from './crdt.js'

/** How far the pointer has to travel before it counts as a drag rather than a
    click that wandered. Small: leaving the row is already the signal. */
const SLOP = 6

/**
 * Make an element draggable into the DAW.
 *
 * `describe()` is called at the moment the drag begins, not when this is set
 * up, so a row whose pattern changes underneath it drags whatever it is showing
 * now. It returns what @see writeMidiFile needs, or null for "nothing to drag".
 *
 * Returns a function that undoes it.
 */
export function draggableAsMidi(element, describe) {
  if (!element || typeof describe !== 'function') return () => {}

  let from = null            // where the button went down
  let started = false

  const down = (event) => {
    // The left button only. A right-click is a menu and a middle-click is
    // something else entirely.
    if (event.button !== 0) return

    /*
     * Stop the browser starting a text selection.
     *
     * Without this, pulling a row sideways selects its label instead of
     * dragging anything -- and the selection takes the pointer with it, so the
     * mouseleave this is waiting for never arrives. The row has no text worth
     * selecting and every reason to be dragged.
     *
     * Not preventDefault on anything inside it: a field in a row is still a
     * field, and somebody typing in one expects to be able to select what they
     * typed.
     */
    if (!isTyping(event.target)) event.preventDefault()

    from = { x: event.clientX, y: event.clientY }
    started = false
  }

  const give = async () => {
    if (started || !from) return
    started = true

    let asked = null
    try {
      // Awaited: a groove from a library the plugin points at has to be read
      // off disk before there are any notes to write. @see notesFor
      asked = await describe()
    } catch {
      asked = null
    }
    if (!asked || !asked.notes || !asked.notes.length) return

    const bytes = writeMidiFile(asked)
    const name = midiFileName(asked.name)

    if (hosted()) {
      await callHost('jaminDragMidi', name, toBase64(bytes)).catch(() => false)
      return
    }

    // A browser cannot hand a file to a DAW, but it can hand one to the person
    // using it, which is the nearest thing that works.
    saveFile(name, bytes)
  }

  const leave = () => { if (from) give() }

  const move = (event) => {
    if (!from || started) return
    // A drag that leaves through a corner may never fire mouseleave, so travel
    // counts too.
    const far = Math.abs(event.clientX - from.x) > SLOP * 4
      || Math.abs(event.clientY - from.y) > SLOP * 4
    if (far && event.buttons === 1) give()
  }

  const up = () => { from = null; started = false }

  element.addEventListener('mousedown', down)
  element.addEventListener('mouseleave', leave)
  element.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)

  return () => {
    element.removeEventListener('mousedown', down)
    element.removeEventListener('mouseleave', leave)
    element.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
}

/** Somewhere text really is meant to be selected. */
function isTyping(node) {
  for (let at = node; at && at.tagName; at = at.parentElement) {
    const tag = at.tagName.toLowerCase()
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
    if (at.isContentEditable) return true
  }
  return false
}

/** The browser's version: hand the file to whoever is looking at the page. */
function saveFile(name, bytes) {
  try {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/midi' }))
    const link = document.createElement('a')
    link.href = url
    link.download = name
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch {
    /* a browser that will not save a file is not worth interrupting anybody over */
  }
}

/**
 * The same, as something a row can declare.
 *
 * `v-drag-midi="() => midiForGroove(groove)"` on a list item. The function is
 * kept rather than its result, and called when the drag starts, so a row whose
 * pattern changed underneath it drags what it is showing now.
 */
export const vDragMidi = {
  mounted(el, binding) {
    el.__jaminDescribe = binding.value
    el.__jaminUndrag = draggableAsMidi(el, () => el.__jaminDescribe && el.__jaminDescribe())
    el.style.cursor = 'grab'
    // Belt as well as braces: preventDefault stops a selection beginning, this
    // stops one being drawn if anything else starts one.
    el.style.userSelect = 'none'
    el.style.webkitUserSelect = 'none'
  },
  updated(el, binding) {
    el.__jaminDescribe = binding.value
  },
  unmounted(el) {
    if (el.__jaminUndrag) el.__jaminUndrag()
    el.__jaminUndrag = null
    el.__jaminDescribe = null
  },
}
