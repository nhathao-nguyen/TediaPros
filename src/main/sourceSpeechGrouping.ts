import { extractSpeaker, isSentenceTerminal } from './semanticGrouping'

/** Versioned source-only identity, assigned before translation/batch filtering. */
export const SOURCE_SPEECH_GROUP_PREFIX = 'source-speech-v1:'

interface TimedSourceCue {
  id: string
  text: string
  start: number
  end: number
}

/**
 * Subtitle rows are fragments, not sentence boundaries. Close a source run
 * AFTER its terminal punctuation, speaker change or pause, never before a
 * question mark and never using punctuation/length invented by translation.
 * Unpunctuated runs use bounded partitions; these are not semantic proof.
 */
export function groupSourceSpeechCues<T extends TimedSourceCue>(cues: readonly T[]): Array<{ id: string; cues: T[] }> {
  const runs: T[][] = []
  for (const cue of cues) {
    const current = runs.at(-1)
    const previous = current?.at(-1)
    const speaker = extractSpeaker(cue.text)
    const previousSpeaker = previous ? extractSpeaker(previous.text) : null
    const boundary = !previous || isSentenceTerminal(previous.text)
      || (speaker !== previousSpeaker && (speaker !== null || previousSpeaker !== null))
      || cue.start - previous.end >= 0.6 - 1e-9
    if (boundary) runs.push([cue])
    else current!.push(cue)
  }
  return runs.flatMap((run) => {
    // Balance an entire run so a max-count cut does not strand a tiny tail.
    // Source text alone determines partitions, identically for every locale.
    const costs = Array<number>(run.length + 1).fill(Infinity)
    const ends = Array<number>(run.length)
    costs[run.length] = 0
    for (let first = run.length - 1; first >= 0; first--) {
      let chars = 0
      for (let last = first; last < Math.min(run.length, first + 6); last++) {
        chars += run[last].text.length + (last > first ? 1 : 0)
        if (last > first && (chars > 300 || run[last].end - run[first].start > 15)) break
        const available = Math.max(0.05, run[last].end - run[first].start - 0.5)
        const cost = costs[last + 1] + 1 + Math.pow(chars / (25 * available), 2)
          + Math.max(0, 1.2 - available) * 20
        if (cost < costs[first]) { costs[first] = cost; ends[first] = last + 1 }
      }
    }
    const groups: Array<{ id: string; cues: T[] }> = []
    for (let first = 0; first < run.length; first = ends[first]) {
      groups.push({ id: `${SOURCE_SPEECH_GROUP_PREFIX}${run[first].id}`, cues: run.slice(first, ends[first]) })
    }
    return groups
  })
}
